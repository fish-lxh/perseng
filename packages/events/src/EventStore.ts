/**
 * EventStore — append-only SQLite 事件库
 *
 * Schema v2：比 legacy EventLog 的 events 表多
 * - ingested_at（落库时间，与 envelope.ts 区分）
 * - producer / producer_version（多 producer 区分）
 * - causation_id / correlation_id（事件追踪）
 * - schema_version（后续字段加列时向上兼容）
 * - tenant_id / owner_id（multi-tenant 安全）
 *
 * 行为：
 * - append: env flag 控制；disable 时直接 resolve；写失败仅 warn 不抛（fire-and-forget）
 * - query: keyset 分页，默认 desc by (ts,id)，上限 500
 * - count / clear: 与 EventLog 对齐
 * - getStatistics: 总数 + byType + byProducer + first/last ts（ops dashboard）
 *
 * 路径：默认 `~/.perseng/events/events.db`，env `PERSENG_EVENTS_DB_PATH` 覆盖。
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createLogger } from '@promptx/logger'

import {
  EVENTS_DB_PATH_ENV,
  type ClearFilter,
  type EventEnvelope,
  type EventRole,
  type EventStatistics,
  type EventStoreFilter,
  type EventStoreQueryOptions,
  type EventStoreRow,
  isEventsEnabled,
} from './types.js'

const logger = createLogger()

/** 物理 schema 版本号；老事件 store 升级时自动迁移 */
const SCHEMA_VERSION = 1

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data ?? null)
  } catch {
    return '"[unserializable]"'
  }
}

/** 解析默认 db 路径；环境变量优先。 */
function defaultDbPath(): string {
  const fromEnv = process.env[EVENTS_DB_PATH_ENV]
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv
  const home = os.homedir()
  return path.join(home, '.perseng', 'events', 'events.db')
}

export class EventStore {
  private readonly db: Database.Database
  private readonly dbPath: string
  private readonly enabled: boolean
  private stmts!: {
    insert: Database.Statement
    countAll: Database.Statement
    clearAll: Database.Statement
    clearBySession: Database.Statement
    clearByAgent: Database.Statement
    clearByImage: Database.Statement
    clearByProducer: Database.Statement
    countByType: Database.Statement
    countByProducer: Database.Statement
    firstTs: Database.Statement
    lastTs: Database.Statement
  }

  /**
   * @param dbPath  可选覆盖；缺省走 defaultDbPath()
   *                tests 里常用 `:memory:` 或 tmp 下临时路径
   * @param options.enabled 可显式覆盖 env flag（一般不传）
   */
  constructor(dbPath?: string, options: { enabled?: boolean } = {}) {
    this.dbPath = dbPath ?? defaultDbPath()
    this.enabled = options.enabled ?? isEventsEnabled()

    // 确保目录存在；失败降级 tmp
    try {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    } catch (err) {
      logger.warn(
        `[EventStore] mkdir failed, falling back to tmp dir: ${err instanceof Error ? err.message : String(err)}`,
      )
      const fallback = path.join(
        process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp',
        'perseng-events',
      )
      fs.mkdirSync(fallback, { recursive: true })
      ;(this as unknown as { dbPath: string }).dbPath = path.join(fallback, 'events.db')
    }

    try {
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this._initializeSchema()
      logger.debug(`[EventStore] opened dbPath=${this.dbPath}`)
    } catch (err) {
      // 打开失败时尝试重建（处理坏文件）；与 EventLog 行为对齐
      logger.warn(
        `[EventStore] open failed, recreating dbPath=${this.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
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
      CREATE TABLE IF NOT EXISTS events_v2 (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ts              INTEGER NOT NULL,
        ingested_at     INTEGER NOT NULL,
        session_id      TEXT,
        container_id    TEXT,
        agent_id        TEXT,
        image_id        TEXT,
        type            TEXT NOT NULL,
        role            TEXT NOT NULL,
        producer        TEXT NOT NULL,
        producer_version TEXT NOT NULL,
        schema_version  INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION},
        causation_id    INTEGER,
        correlation_id  TEXT,
        tenant_id       TEXT,
        owner_id        TEXT,
        payload         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v2_ts       ON events_v2(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_v2_session  ON events_v2(session_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_v2_agent    ON events_v2(agent_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_v2_image    ON events_v2(image_id, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_v2_type     ON events_v2(type, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_v2_producer ON events_v2(producer, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_v2_corr     ON events_v2(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_v2_cause    ON events_v2(causation_id);
    `)
    this._prepareStatements()
  }

  private _prepareStatements(): void {
    this.stmts = {
      insert: this.db.prepare(`
        INSERT INTO events_v2 (
          ts, ingested_at, session_id, container_id, agent_id, image_id,
          type, role, producer, producer_version, schema_version,
          causation_id, correlation_id, tenant_id, owner_id, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      countAll: this.db.prepare(`SELECT COUNT(*) AS total FROM events_v2`),
      clearAll: this.db.prepare(`DELETE FROM events_v2`),
      clearBySession: this.db.prepare(`DELETE FROM events_v2 WHERE session_id = ?`),
      clearByAgent: this.db.prepare(`DELETE FROM events_v2 WHERE agent_id = ?`),
      clearByImage: this.db.prepare(`DELETE FROM events_v2 WHERE image_id = ?`),
      clearByProducer: this.db.prepare(`DELETE FROM events_v2 WHERE producer = ?`),
      countByType: this.db.prepare(
        `SELECT type, COUNT(*) AS total FROM events_v2 GROUP BY type`,
      ),
      countByProducer: this.db.prepare(
        `SELECT producer, COUNT(*) AS total FROM events_v2 GROUP BY producer`,
      ),
      firstTs: this.db.prepare(`SELECT MIN(ts) AS first_ts FROM events_v2`),
      lastTs: this.db.prepare(`SELECT MAX(ts) AS last_ts FROM events_v2`),
    }
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /** 用于 instance.ts 单例 + 测试断言的路径回读 */
  getDbPath(): string {
    return this.dbPath
  }

  /** env flag 状态 — 测试 / UI 显示用 */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 写入一条事件。
   *
   * 行为：
   * - env flag OFF → 直接 resolve（不写）
   * - 写入失败 → 仅 warn，不抛（与 EventLog.append 一致；调用方负责 try/catch）
   *
   * 上下文字段（sessionId/agentId/imageId/containerId）：top-level 优先，
   * 否则读 `envelope.context?.x`。
   */
  async append(envelope: EventEnvelope): Promise<void> {
    if (!this.enabled) return
    try {
      const ctx = envelope.context ?? null
      // top-level 写起来方便；context 字段兜底
      const sessionId = envelope.sessionId ?? ctx?.sessionId ?? null
      const agentId = envelope.agentId ?? ctx?.agentId ?? null
      const imageId = envelope.imageId ?? ctx?.imageId ?? null
      const containerId = envelope.containerId ?? ctx?.containerId ?? null
      const causation = envelope.causation ?? null
      this.stmts.insert.run(
        envelope.ts,
        Date.now(),
        sessionId,
        containerId,
        agentId,
        imageId,
        envelope.type,
        envelope.role ?? 'system',
        envelope.producer,
        envelope.producerVersion,
        envelope.schemaVersion ?? SCHEMA_VERSION,
        causation?.causationId ?? null,
        causation?.correlationId ?? null,
        envelope.tenantId ?? null,
        envelope.ownerId ?? null,
        safeStringify(envelope.payload),
      )
    } catch (err) {
      logger.warn(
        `[EventStore] append failed type=${envelope.type}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * keyset 分页查询；默认 desc by (ts, id)
   *
   * filter 维度：type / types[] / producer / correlationId / sessionId / agentId /
   *            imageId / tenantId / ownerId / sinceTs / untilTs
   */
  async query(options: EventStoreQueryOptions = {}): Promise<EventStoreRow[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
    const order = options.order ?? 'desc'
    const cursorMode = order === 'asc' ? 'gt' : 'lt'

    const { where, params } = this._buildWhere(options, {
      cursor: options.cursor,
      cursorMode,
    })
    const orderClause = order === 'asc' ? 'ts ASC, id ASC' : 'ts DESC, id DESC'
    const sql = `
      SELECT * FROM events_v2
      WHERE 1=1
        ${where}
      ORDER BY ${orderClause}
      LIMIT ?
    `
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    return rows.map(this._mapRow)
  }

  /** 同 filter 下的总数（不含 cursor/limit/order） */
  async count(filter: EventStoreFilter = {}): Promise<number> {
    const { where, params } = this._buildWhere(filter, { cursorMode: 'lt' })
    const sql = `SELECT COUNT(*) AS total FROM events_v2 WHERE 1=1 ${where}`
    const r = this.db.prepare(sql).get(...params) as { total: number }
    return r.total
  }

  /** 按 scope 清空；filter 优先 */
  async clear(filter: ClearFilter = {}): Promise<{ deleted: number }> {
    if (filter.filter) {
      // 高级用法：直接按 filter 删（不带 cursor/limit/order）
      const { where, params } = this._buildWhere(filter.filter, { cursorMode: 'lt' })
      const sql = `DELETE FROM events_v2 WHERE 1=1 ${where}`
      const info = this.db.prepare(sql).run(...params)
      logger.info(`[EventStore] cleared by filter, deleted=${info.changes}`)
      return { deleted: info.changes }
    }
    const scope = filter.scope ?? 'all'
    let info: Database.RunResult
    switch (scope) {
      case 'all':
        info = this.stmts.clearAll.run()
        break
      case 'session':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=session')
        info = this.stmts.clearBySession.run(filter.targetId)
        break
      case 'agent':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=agent')
        info = this.stmts.clearByAgent.run(filter.targetId)
        break
      case 'image':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=image')
        info = this.stmts.clearByImage.run(filter.targetId)
        break
      case 'producer':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=producer')
        info = this.stmts.clearByProducer.run(filter.targetId)
        break
      default:
        throw new Error(`clear: unknown scope ${scope}`)
    }
    logger.info(`[EventStore] cleared scope=${scope} deleted=${info.changes}`)
    return { deleted: info.changes }
  }

  /** ops dashboard / Renderer statistics 面板 */
  async getStatistics(): Promise<EventStatistics> {
    const total = (this.stmts.countAll.get() as { total: number }).total
    const byType = Object.fromEntries(
      (this.stmts.countByType.all() as Array<{ type: string; total: number }>).map(
        (r) => [r.type, r.total] as const,
      ),
    )
    const byProducer = Object.fromEntries(
      (this.stmts.countByProducer.all() as Array<{ producer: string; total: number }>).map(
        (r) => [r.producer, r.total] as const,
      ),
    )
    const firstTs = (this.stmts.firstTs.get() as { first_ts: number | null }).first_ts
    const lastTs = (this.stmts.lastTs.get() as { last_ts: number | null }).last_ts
    return {
      totalEvents: total,
      byType,
      byProducer,
      firstTs,
      lastTs,
      dbPath: this.dbPath,
    }
  }

  /**
   * M2 用：replay 时按时间区间扫描（ASC by ts,id），不绑 cursor/limit。
   *
   * 这里抽象成显式 helper 而非 query 变体：保证 M2 的 sql 模板独立，
   * 也能在 index 演进时单独优化 prepared statement。
   */
  async queryRange(
    from: number,
    to: number,
    filter: EventStoreFilter = {},
  ): Promise<EventStoreRow[]> {
    const { where, params } = this._buildWhere(
      { ...filter, sinceTs: from, untilTs: to },
      { cursorMode: 'lt' },
    )
    // replay 强制 ASC by (ts, id)
    const sql = `
      SELECT * FROM events_v2
      WHERE 1=1
        ${where}
      ORDER BY ts ASC, id ASC
    `
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    return rows.map(this._mapRow)
  }

  /** 关闭 db 连接。
   *
   * Windows 下 WAL + SHM 文件可能持续存在；先做 TRUNCATE checkpoint
   * 把 WAL 落回主 db，再 close，避免清理目录时 EBUSY。
   */
  async close(): Promise<void> {
    try {
      try {
        // PASSIVE 模式不等待 reader；TRUNCATE 把所有内容写回主 db
        this.db.pragma('wal_checkpoint(TRUNCATE)')
      } catch {
        /* 不是必须，best-effort */
      }
      this.db.close()
    } catch (err) {
      logger.warn(`[EventStore] close failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  /**
   * 动态 WHERE 构造器。
   *
   * `where` 是 `AND ...` 串接字符串（不含第一个 AND），`params` 是绑定值数组。
   *
   * 关于 limit：query 时由调用方 append LIMIT ?；count / queryRange 不需要。
   * 关于 cursor：id 比较符走 cursorMode（keyset pagination）。
   */
  private _buildWhere(
    filter: EventStoreFilter,
    opts: { cursor?: number; cursorMode: 'gt' | 'lt' },
  ): { where: string; params: unknown[] } {
    const parts: string[] = []
    const params: unknown[] = []
    if (filter.sessionId) {
      parts.push('AND session_id = ?')
      params.push(filter.sessionId)
    }
    if (filter.agentId) {
      parts.push('AND agent_id = ?')
      params.push(filter.agentId)
    }
    if (filter.imageId) {
      parts.push('AND image_id = ?')
      params.push(filter.imageId)
    }
    if (filter.producer) {
      parts.push('AND producer = ?')
      params.push(filter.producer)
    }
    if (filter.correlationId) {
      parts.push('AND correlation_id = ?')
      params.push(filter.correlationId)
    }
    if (filter.tenantId) {
      parts.push('AND tenant_id = ?')
      params.push(filter.tenantId)
    }
    if (filter.ownerId) {
      parts.push('AND owner_id = ?')
      params.push(filter.ownerId)
    }
    if (filter.sinceTs !== undefined) {
      parts.push('AND ts >= ?')
      params.push(filter.sinceTs)
    }
    if (filter.untilTs !== undefined) {
      parts.push('AND ts <= ?')
      params.push(filter.untilTs)
    }
    if (filter.type) {
      parts.push('AND type = ?')
      params.push(filter.type)
    }
    if (filter.types && filter.types.length > 0) {
      parts.push('AND type IN (SELECT value FROM json_each(?))')
      params.push(JSON.stringify(filter.types))
    }
    if (opts.cursor !== undefined) {
      parts.push(opts.cursorMode === 'gt' ? 'AND id >  ?' : 'AND id <  ?')
      params.push(opts.cursor)
    }
    return { where: parts.join('\n          '), params }
  }

  /**
   * 把物理 row (snake_case) 映射到 EventStoreRow (camelCase + 拍平 context)
   * SQLite 返回字段名按 CREATE TABLE 顺序 — 与 map 严格对应。
   */
  private _mapRow = (r: Record<string, unknown>): EventStoreRow => ({
    id: r['id'] as number,
    ts: r['ts'] as number,
    ingestedAt: r['ingested_at'] as number,
    sessionId: (r['session_id'] as string | null) ?? null,
    containerId: (r['container_id'] as string | null) ?? null,
    agentId: (r['agent_id'] as string | null) ?? null,
    imageId: (r['image_id'] as string | null) ?? null,
    type: r['type'] as string,
    role: r['role'] as EventRole,
    producer: r['producer'] as string,
    producerVersion: r['producer_version'] as string,
    schemaVersion: (r['schema_version'] as number | undefined) ?? SCHEMA_VERSION,
    causation:
      r['causation_id'] != null || r['correlation_id'] != null
        ? {
            causationId: (r['causation_id'] as number | null) ?? null,
            correlationId: (r['correlation_id'] as string | null) ?? null,
          }
        : undefined,
    tenantId: (r['tenant_id'] as string | null) ?? null,
    ownerId: (r['owner_id'] as string | null) ?? null,
    payload: this._parsePayload(r['payload']),
  })

  private _parsePayload(raw: unknown): unknown {
    if (typeof raw !== 'string') return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
}
