/**
 * scheduler/ScheduleStore.ts — 调度持久化（SQLite）
 *
 * 严格镜像 packages/events/src/EventStore.ts 的模式：
 *   - 构造：mkdirSync parent + tmp fallback + try/catch open with corrupt-recovery
 *   - WAL + synchronous = NORMAL
 *   - _initializeSchema() 私有，构造函数末尾调用
 *   - close() 必须 wal_checkpoint(TRUNCATE)（Windows fs.rmSync 必备）
 *   - 所有 CREATE IF NOT EXISTS（无版本化迁移系统，与 events 包对齐）
 *
 * Schema 完全按 design-doc §3，column 名 snake_case，TS 接口 camelCase，
 * 映射在 _mapRow 内显式做。
 *
 * 主要方法：
 *   create / get / list / update / setState / delete
 *   claimDue(now)            - tick 用的原子认领
 *   recordRunStart           - 写一条 schedule_runs 行（status=running）
 *   recordRunEnd             - 更新 schedule_runs 行的 status / error / output / duration
 *   recordOutcome            - 把 schedule.last_* / next_run_at / fail_count 一起更新
 *   listRuns                 - history 子操作
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createLogger } from '@promptx/logger'
import { nextRunFor } from './CronParser.js'
import {
  DEFAULT_RETRY_BACKOFF_SECONDS,
  DEFAULT_TIMEZONE,
  MAX_RETRY_LIMIT,
  SCHEDULES_DB_PATH_ENV,
  type NewSchedule,
  type RetryPolicy,
  type Schedule,
  type ScheduleListFilter,
  type ScheduleRun,
  type ScheduleRunHistoryFilter,
  type ScheduleState,
  type RunStatus,
} from './types.js'

const logger = createLogger()

// 物理 schema 版本号；events 包约定 schema_version 默认值 = 1
const SCHEMA_VERSION = 1

/** 解析默认 db 路径；环境变量优先 */
function defaultDbPath(): string {
  const fromEnv = process.env[SCHEDULES_DB_PATH_ENV]
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv
  const home = os.homedir()
  return path.join(home, '.perseng', 'schedules', 'schedules.db')
}

/** 序列化 tool_args JSON */
function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data ?? null)
  } catch {
    return '"[unserializable]"'
  }
}

/** 反序列化 tool_args */
function safeParse(raw: string | null): Record<string, unknown> {
  if (raw == null) return {}
  try {
    const v = JSON.parse(raw)
    if (v && typeof v === 'object') return v as Record<string, unknown>
    return {}
  } catch {
    return {}
  }
}

export class ScheduleStore {
  private readonly db: Database.Database
  private readonly dbPath: string
  private stmts!: {
    insertSchedule: Database.Statement
    selectSchedule: Database.Statement
    selectSchedules: Database.Statement
    updateSchedule: Database.Statement
    setState: Database.Statement
    markClaimed: Database.Statement
    updateLastRun: Database.Statement
    softDelete: Database.Statement
    insertRun: Database.Statement
    updateRunEnd: Database.Statement
  }
  /**
   * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): next_attempt_at 列是否已迁移。
   * 首次启动时检测一次，避免每次 insertRun 都试 ALTER TABLE。
   */
  private _nextAttemptAtColumnReady = false

  /**
   * @param dbPath   可选覆盖；缺省走 defaultDbPath()
   * @param options.silent  true 时不输出日志（测试用）
   */
  constructor(dbPath?: string, options: { silent?: boolean } = {}) {
    this.dbPath = dbPath ?? defaultDbPath()
    const silent = options.silent === true

    // 确保目录存在；失败降级 tmp
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    } catch (err) {
      if (!silent) {
        logger.warn(
          `[ScheduleStore] mkdir failed, falling back to tmp dir: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const fallback = path.join(
        process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp',
        'perseng-schedules',
      )
      fs.mkdirSync(fallback, { recursive: true })
      ;(this as unknown as { dbPath: string }).dbPath = path.join(fallback, 'schedules.db')
    }

    try {
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this._initializeSchema()
      if (!silent) logger.debug(`[ScheduleStore] opened dbPath=${this.dbPath}`)
    } catch (err) {
      if (!silent) {
        logger.warn(
          `[ScheduleStore] open failed, recreating dbPath=${this.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      try {
        if (fs.existsSync(this.dbPath)) fs.unlinkSync(this.dbPath)
      } catch {
        /* ignore */
      }
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this._initializeSchema()
    }
  }

  // ============================================================================
  // Schema
  // ============================================================================

  private _initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        description        TEXT,
        cron_expr          TEXT NOT NULL,
        timezone           TEXT NOT NULL DEFAULT '${DEFAULT_TIMEZONE}',
        tool_name          TEXT NOT NULL,
        tool_args          TEXT NOT NULL,
        state              TEXT NOT NULL DEFAULT 'pending',
        max_retries        INTEGER NOT NULL DEFAULT 0,
        timeout_ms         INTEGER NOT NULL DEFAULT 60000,
        notify_on_success  INTEGER NOT NULL DEFAULT 0,
        notify_on_failure  INTEGER NOT NULL DEFAULT 1,
        created_by         TEXT,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        approved_at        INTEGER,
        last_run_at        INTEGER,
        next_run_at        INTEGER,
        last_status        TEXT,
        last_error         TEXT,
        fail_count         INTEGER NOT NULL DEFAULT 0,
        schema_version     INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION}
      );

      CREATE INDEX IF NOT EXISTS idx_schedules_state     ON schedules(state);
      CREATE INDEX IF NOT EXISTS idx_schedules_next_run  ON schedules(next_run_at) WHERE state = 'active';
      CREATE INDEX IF NOT EXISTS idx_schedules_tool      ON schedules(tool_name);

      CREATE TABLE IF NOT EXISTS schedule_runs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        scheduled_at  INTEGER NOT NULL,
        started_at    INTEGER,
        finished_at   INTEGER,
        status        TEXT NOT NULL,
        attempt       INTEGER NOT NULL DEFAULT 1,
        error         TEXT,
        output        TEXT,
        duration_ms   INTEGER,
        next_attempt_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_runs_schedule_time
        ON schedule_runs(schedule_id, started_at DESC);
    `)
    this._prepareStatements()
    this._migrateNextAttemptAt()
  }

  /**
   * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): 老库（无 next_attempt_at 列）的迁移。
   * - 幂等：try/catch 吞 "duplicate column name" 错误
   * - 失败也不致命：recordRunStart 会跳过写 next_attempt_at
   */
  private _migrateNextAttemptAt(): void {
    try {
      this.db.exec(`ALTER TABLE schedule_runs ADD COLUMN next_attempt_at INTEGER`)
      this._nextAttemptAtColumnReady = true
    } catch {
      // 列已存在 → 视为已迁移
      this._nextAttemptAtColumnReady = true
    }
  }

  private _prepareStatements(): void {
    this.stmts = {
      insertSchedule: this.db.prepare(`
        INSERT INTO schedules (
          id, name, description, cron_expr, timezone, tool_name, tool_args,
          state, max_retries, timeout_ms, notify_on_success, notify_on_failure,
          created_by, created_at, updated_at, approved_at, last_run_at,
          next_run_at, last_status, last_error, fail_count, schema_version
        ) VALUES (
          @id, @name, @description, @cronExpr, @timezone, @toolName, @toolArgs,
          @state, @maxRetries, @timeoutMs, @notifyOnSuccess, @notifyOnFailure,
          @createdBy, @createdAt, @updatedAt, @approvedAt, @lastRunAt,
          @nextRunAt, @lastStatus, @lastError, @failCount, @schemaVersion
        )
      `),
      selectSchedule: this.db.prepare(`SELECT * FROM schedules WHERE id = ?`),
      selectSchedules: this.db.prepare(this._buildListQuery()),
      updateSchedule: this.db.prepare(`
        UPDATE schedules SET
          name = @name,
          description = @description,
          cron_expr = @cronExpr,
          timezone = @timezone,
          tool_name = @toolName,
          tool_args = @toolArgs,
          max_retries = @maxRetries,
          timeout_ms = @timeoutMs,
          notify_on_success = @notifyOnSuccess,
          notify_on_failure = @notifyOnFailure,
          updated_at = @updatedAt,
          next_run_at = @nextRunAt
        WHERE id = @id
      `),
      setState: this.db.prepare(`
        UPDATE schedules SET state = ?, updated_at = ? WHERE id = ?
      `),
      markClaimed: this.db.prepare(`
        UPDATE schedules
        SET next_run_at = NULL, last_run_at = ?, updated_at = ?
        WHERE id = ? AND state = 'active' AND next_run_at IS NOT NULL
      `),
      updateLastRun: this.db.prepare(`
        UPDATE schedules SET
          last_status = @lastStatus,
          last_error = @lastError,
          fail_count = @failCount,
          next_run_at = @nextRunAt,
          updated_at = @updatedAt
        WHERE id = @id
      `),
      softDelete: this.db.prepare(`
        UPDATE schedules SET state = 'deleted', updated_at = ? WHERE id = ?
      `),
      insertRun: this.db.prepare(`
        INSERT INTO schedule_runs (schedule_id, scheduled_at, status, attempt, next_attempt_at)
        VALUES (?, ?, ?, ?, ?)
      `),
      updateRunEnd: this.db.prepare(`
        UPDATE schedule_runs SET
          finished_at = ?, status = ?, error = ?, output = ?, duration_ms = ?
        WHERE id = ?
      `),
    }
  }

  private _buildListQuery(): string {
    return `SELECT * FROM schedules WHERE 1=1 ORDER BY created_at DESC LIMIT ?`
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 新建一条 schedule。
   * 自动算 next_run_at（按 cron + timezone），state 默认 'pending'。
   */
  create(input: NewSchedule): Schedule {
    const now = Date.now()
    const state = input.state ?? 'pending'
    const next = nextRunFor(input.cronExpr, input.timezone ?? DEFAULT_TIMEZONE)
    const row = {
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      cronExpr: input.cronExpr,
      timezone: input.timezone ?? DEFAULT_TIMEZONE,
      toolName: input.toolName,
      toolArgs: safeStringify(input.toolArgs),
      state,
      maxRetries: input.maxRetries ?? 0,
      timeoutMs: input.timeoutMs ?? 60_000,
      notifyOnSuccess: input.notifyOnSuccess ? 1 : 0,
      notifyOnFailure: input.notifyOnFailure === false ? 0 : 1,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
      approvedAt: input.approvedAt ?? null,
      lastRunAt: null,
      nextRunAt: next ? next.getTime() : null,
      lastStatus: null,
      lastError: null,
      failCount: 0,
      schemaVersion: SCHEMA_VERSION,
    }
    this.stmts.insertSchedule.run(row)
    return this.get(input.id)!
  }

  get(id: string): Schedule | null {
    const r = this.stmts.selectSchedule.get(id) as Record<string, unknown> | undefined
    return r ? this._mapScheduleRow(r) : null
  }

  /**
   * 按 filter 列 schedule。state 默认全部；tool_name 可选。
   * limit 默认 100，上限 500（参考 EventStore 的 keyset 分页设计）。
   */
  list(filter: ScheduleListFilter = {}): Schedule[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
    const wheres: string[] = []
    const params: unknown[] = []
    if (filter.state) {
      wheres.push('AND state = ?')
      params.push(filter.state)
    } else {
      wheres.push("AND state != 'deleted'") // 默认不显示已删除
    }
    if (filter.toolName) {
      wheres.push('AND tool_name = ?')
      params.push(filter.toolName)
    }
    const sql = `SELECT * FROM schedules WHERE 1=1 ${wheres.join('\n')} ORDER BY created_at DESC LIMIT ?`
    const rows = this.db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>
    return rows.map((r) => this._mapScheduleRow(r))
  }

  /** 通用更新 — 改字段不重算 next_run_at（除非 cron/timezone 变了） */
  update(
    id: string,
    patch: Partial<
      Pick<
        Schedule,
        | 'name'
        | 'description'
        | 'cronExpr'
        | 'timezone'
        | 'toolName'
        | 'toolArgs'
        | 'maxRetries'
        | 'timeoutMs'
        | 'notifyOnSuccess'
        | 'notifyOnFailure'
      >
    >,
  ): Schedule | null {
    const cur = this.get(id)
    if (!cur) return null
    const merged = { ...cur, ...patch }
    const next = nextRunFor(merged.cronExpr, merged.timezone)
    this.stmts.updateSchedule.run({
      id,
      name: merged.name,
      description: merged.description,
      cronExpr: merged.cronExpr,
      timezone: merged.timezone,
      toolName: merged.toolName,
      toolArgs: safeStringify(merged.toolArgs),
      maxRetries: merged.maxRetries,
      timeoutMs: merged.timeoutMs,
      notifyOnSuccess: merged.notifyOnSuccess ? 1 : 0,
      notifyOnFailure: merged.notifyOnFailure ? 1 : 0,
      updatedAt: Date.now(),
      nextRunAt: next ? next.getTime() : null,
    })
    return this.get(id)
  }

  /** 改状态 — 工具/引擎都调这个 */
  setState(id: string, state: ScheduleState): boolean {
    const info = this.stmts.setState.run(state, Date.now(), id)
    return info.changes > 0
  }

  /**
   * tick 用 — 把一条 active 且到期的 schedule 标记为"已认领"。
   * 返回行变更数（用于互斥：0 = 已经被别人 claim 了）。
   * 不会改 state，只清 next_run_at（认领期间）。
   */
  claimDue(scheduleId: string, now: number = Date.now()): boolean {
    const info = this.stmts.markClaimed.run(now, now, scheduleId)
    return info.changes > 0
  }

  /**
   * 写一条 schedule_runs 行（status=running），返回 run id。
   *
   * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7):
   *   - `nextAttemptAt` 可选；失败重试场景下指向下次重试时间
   *   - 若列未就绪（迁移失败）则安全忽略
   */
  recordRunStart(
    scheduleId: string,
    scheduledAt: number,
    attempt: number = 1,
    nextAttemptAt?: number | null,
  ): number {
    const next = this._nextAttemptAtColumnReady ? (nextAttemptAt ?? null) : null
    const info = this.stmts.insertRun.run(scheduleId, scheduledAt, 'running', attempt, next)
    return Number(info.lastInsertRowid)
  }

  /** 更新 schedule_runs 行的 status / error / output / duration */
  recordRunEnd(
    runId: number,
    status: RunStatus,
    error?: string | null,
    output?: string | null,
    durationMs?: number | null,
  ): void {
    this.stmts.updateRunEnd.run(
      Date.now(),
      status,
      error ?? null,
      output ?? null,
      durationMs ?? null,
      runId,
    )
  }

  /**
   * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7):
   *   从 schedule.maxRetries 派生 RetryPolicy（设计稿 §5.3）。
   *   - maxRetries=0 → 不重试（maxAttempts=1）
   *   - maxRetries>=1 → backoff 数组按 maxRetries 截取默认 DEFAULT_RETRY_BACKOFF_SECONDS，
   *     超出默认 3 段的部分按 [480, 1440, 2880, ...] 几何递增（×3）
   *   - 上限 MAX_RETRY_LIMIT（防止恶意/手滑 config）
   */
  getRetryPolicy(schedule: Schedule): RetryPolicy {
    const limited = Math.min(Math.max(schedule.maxRetries ?? 0, 0), MAX_RETRY_LIMIT)
    const maxAttempts = limited + 1
    const backoffSeconds: number[] = []
    for (let i = 0; i < limited; i++) {
      if (i < DEFAULT_RETRY_BACKOFF_SECONDS.length) {
        backoffSeconds.push(DEFAULT_RETRY_BACKOFF_SECONDS[i]!)
      } else {
        // 超出默认 3 段后按 ×3 递增（[480, 1440, 4320, ...]）
        const prev = backoffSeconds[i - 1] ?? 480
        backoffSeconds.push(prev * 3)
      }
    }
    return { maxAttempts, backoffSeconds }
  }

  /**
   * 把一次执行结果汇总到 schedule 行（last_* / fail_count / next_run_at）。
   * 如果 fail_count 跨过阈值，**不**在这里改 state — 让调用方决定（L2 决策）。
   */
  recordOutcome(
    id: string,
    outcome: {
      status: RunStatus
      error?: string | null
      failCount: number
      nextRunAt: number | null
    },
  ): Schedule | null {
    this.stmts.updateLastRun.run({
      id,
      lastStatus: outcome.status,
      lastError: outcome.error ?? null,
      failCount: outcome.failCount,
      nextRunAt: outcome.nextRunAt,
      updatedAt: Date.now(),
    })
    return this.get(id)
  }

  /** 软删除 — state='deleted' */
  delete(id: string): boolean {
    const info = this.stmts.softDelete.run(Date.now(), id)
    return info.changes > 0
  }

  /** history 子操作 */
  listRuns(filter: ScheduleRunHistoryFilter): ScheduleRun[] {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
    const conds: string[] = []
    const params: unknown[] = [filter.scheduleId]
    if (filter.since !== undefined) {
      conds.push('AND started_at >= ?')
      params.push(filter.since)
    }
    const sql =
      `SELECT * FROM schedule_runs WHERE schedule_id = ? ${conds.join('\n')} ` +
      `ORDER BY started_at DESC, id DESC LIMIT ?`
    const rows = this.db.prepare(sql).all(...params, limit) as Array<Record<string, unknown>>
    return rows.map((r) => this._mapRunRow(r))
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * 关闭 db 连接 — Windows 上 WAL + SHM 文件可能持续存在；先 TRUNCATE
   * checkpoint 把 WAL 落回主 db，再 close，避免清理目录时 EBUSY。
   * 与 EventStore.close() 严格对齐。
   */
  async close(): Promise<void> {
    try {
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)')
      } catch {
        /* best-effort */
      }
      this.db.close()
    } catch (err) {
      logger.warn(`[ScheduleStore] close failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================================================
  // 行映射
  // ============================================================================

  /** snake_case → camelCase + JSON 字段反序列化 */
  private _mapScheduleRow(r: Record<string, unknown>): Schedule {
    return {
      id: r['id'] as string,
      name: r['name'] as string,
      description: (r['description'] as string | null) ?? null,
      cronExpr: r['cron_expr'] as string,
      timezone: r['timezone'] as string,
      toolName: r['tool_name'] as string,
      toolArgs: safeParse((r['tool_args'] as string | null) ?? null),
      state: r['state'] as ScheduleState,
      maxRetries: r['max_retries'] as number,
      timeoutMs: r['timeout_ms'] as number,
      notifyOnSuccess: (r['notify_on_success'] as number) === 1,
      notifyOnFailure: (r['notify_on_failure'] as number) === 1,
      createdBy: (r['created_by'] as string | null) ?? null,
      createdAt: r['created_at'] as number,
      updatedAt: r['updated_at'] as number,
      approvedAt: (r['approved_at'] as number | null) ?? null,
      lastRunAt: (r['last_run_at'] as number | null) ?? null,
      nextRunAt: (r['next_run_at'] as number | null) ?? null,
      lastStatus: (r['last_status'] as RunStatus | null) ?? null,
      lastError: (r['last_error'] as string | null) ?? null,
      failCount: r['fail_count'] as number,
    }
  }

  private _mapRunRow(r: Record<string, unknown>): ScheduleRun {
    return {
      id: r['id'] as number,
      scheduleId: r['schedule_id'] as string,
      scheduledAt: r['scheduled_at'] as number,
      startedAt: (r['started_at'] as number | null) ?? null,
      finishedAt: (r['finished_at'] as number | null) ?? null,
      status: r['status'] as RunStatus,
      attempt: r['attempt'] as number,
      error: (r['error'] as string | null) ?? null,
      output: (r['output'] as string | null) ?? null,
      durationMs: (r['duration_ms'] as number | null) ?? null,
      // KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): 重试时间戳
      nextAttemptAt: (r['next_attempt_at'] as number | null) ?? null,
    }
  }
}
