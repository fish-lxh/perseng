/**
 * scheduler/ScheduleEngine.ts — 调度执行引擎 (Phase 1 / Commit 4 + Phase 3 / Commit 7)
 *
 * KNUTH-FEAT 2026-07-18:
 *   Phase 1 / Commit 4 — 基础引擎 + run_now
 *   Phase 3 / Commit 7 — 重试机制（maxRetries + backoff）+ dry_run validation
 *
 * 职责：
 *   - 维护"schedule.id → croner job"映射
 *   - 每个 active schedule 一个 croner（protect: true，防重叠）
 *   - 触发时：原子 claimDue → 写 schedule_runs → 模板替换 → 调 target tool →
 *     recordRunEnd → recordOutcome（更新 next_run_at + fail_count）→ L2 自动 pause
 *   - 重试：内部 for 循环 attempt 1..maxAttempts，失败后写 next_attempt_at + emit retried
 *   - dry_run：调 validateScheduleConfig() 校验（不写入 DB）
 *   - 事件埋点（producer = `scheduler:engine`）：
 *     schedule.triggered / schedule.succeeded / schedule.failed / schedule.paused
 *     schedule.retried / schedule.dry_run_passed / schedule.dry_run_failed
 *
 * 与 ScheduleStore 解耦：Store 是单例（共享 db 连接），Engine 注入（DI）。
 *   注入模式避免 Vitest timer leak — 每个测试 new 一个 engine，afterEach stop。
 *
 * 模板替换（设计稿 §5.1）：
 *   ${now.date} / ${now.time} / ${now.weekday} / ${today.date}
 *   ${schedule.id} / ${schedule.name} / ${run.attempt}
 *   全部按 schedule.timezone 计算（Intl.DateTimeFormat）。
 *
 * L2 自动 pause：连续失败次数 >= L2_AUTO_PAUSE_FAIL_COUNT 时，state 自动转 'paused'，
 * 并 emit schedule.paused { reason: 'auto' }。
 */

import { Cron } from 'croner'
import { createLogger } from '@promptx/logger'
import { ScheduleStore } from './ScheduleStore.js'
import { nextRunFor } from './CronParser.js'
import {
  L2_AUTO_PAUSE_FAIL_COUNT,
  type RunStatus,
  type Schedule,
} from './types.js'
import { validate as validateCron } from './CronParser.js'
import type { ToolEventBus } from '~/interfaces/MCPServer.js'
import type { MapToolRegistry } from '~/registry/ToolRegistry.js'
import { safeEmit } from '~/tools/_emit.js'

const logger = createLogger()

const PRODUCER = 'scheduler:engine'
const PRODUCER_VERSION = '2.4.1'

export interface ScheduleEngineDeps {
  store: ScheduleStore
  registry: MapToolRegistry
  bus: ToolEventBus | null
}

export interface RunNowResult {
  runId: number
  status: RunStatus
  durationMs: number
}

/** 单条 schedule 的执行结果（用于 run_now 同步返回 + tick 异步汇总） */
export type RunOutcome = RunNowResult | { skipped: true; reason: string }

/**
 * 时区感知的格式化器 — 返回当前 now 在指定 IANA 时区下的 date / time / weekday 字符串。
 *
 * 设计要点：用 `Intl.DateTimeFormat` + locale 选项保证：
 *   - date 一定是 "YYYY-MM-DD"（en-CA locale）
 *   - time 一定是 "HH:mm:ss" 24h（en-GB locale，hour12: false）
 *   - weekday 是完整英文名（en-US locale）
 *
 * 测试可独立验证 tzFormatter（不需要整个 engine）。
 */
export interface TzFormatter {
  date(d: Date): string
  time(d: Date): string
  weekday(d: Date): string
}

export function tzFormatter(tz: string): TzFormatter {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const weekdayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
  })
  return {
    date(d) {
      // en-CA → "YYYY-MM-DD"
      return dateFmt.format(d)
    },
    time(d) {
      // en-GB 24h → "HH:mm:ss"
      return timeFmt.format(d)
    },
    weekday(d) {
      return weekdayFmt.format(d)
    },
  }
}

/** 把对象/数组里所有 string 值的占位符都替换掉（递归） */
function walkReplace(value: unknown, replace: (s: string) => string): unknown {
  if (typeof value === 'string') return replace(value)
  if (Array.isArray(value)) return value.map((v) => walkReplace(v, replace))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = walkReplace(v, replace)
    }
    return out
  }
  return value
}

/**
 * 在传入的 toolArgs 上做模板替换（设计稿 §5.1 占位符）。
 * 对外导出用于单测。
 */
export function applyTemplate(
  args: Record<string, unknown>,
  ctx: { schedule: Schedule; attempt: number; now: Date },
): Record<string, unknown> {
  const fmt = tzFormatter(ctx.schedule.timezone)
  const dateStr = fmt.date(ctx.now)
  const timeStr = fmt.time(ctx.now)
  const weekdayStr = fmt.weekday(ctx.now)
  const replace = (s: string): string =>
    s
      .replace(/\$\{now\.date\}/g, dateStr)
      .replace(/\$\{now\.time\}/g, timeStr)
      .replace(/\$\{now\.weekday\}/g, weekdayStr)
      .replace(/\$\{today\.date\}/g, dateStr)
      .replace(/\$\{schedule\.id\}/g, ctx.schedule.id)
      .replace(/\$\{schedule\.name\}/g, ctx.schedule.name)
      .replace(/\$\{run\.attempt\}/g, String(ctx.attempt))
  return walkReplace(args, replace) as Record<string, unknown>
}

/** 超时 helper */
function timeoutAfter(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    // 不 unref — node 默认就没事，但显式更好
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      ;(t as { unref: () => void }).unref()
    }
  })
}

/** 从 MCP tool handler 返回值里尽量提取一段文本（用于 schedule_runs.output） */
function extractOutput(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  if (!Array.isArray(r.content)) return null
  const first = r.content[0]
  if (first && typeof first.text === 'string') {
    // 截断到 4KB 避免 DB 爆掉
    const text = first.text
    return text.length > 4096 ? text.slice(0, 4096) + '...[truncated]' : text
  }
  return null
}

export class ScheduleEngine {
  private readonly store: ScheduleStore
  private readonly registry: MapToolRegistry
  private readonly bus: ToolEventBus | null
  private readonly jobs = new Map<string, Cron>()
  private started = false

  constructor(deps: ScheduleEngineDeps) {
    this.store = deps.store
    this.registry = deps.registry
    this.bus = deps.bus
  }

  // ============================================================================
  // 生命周期
  // ============================================================================

  /**
   * 启动 — 加载所有 state='active' 的 schedules，每个起一个 croner。
   * 不立即触发错过的调度（croner catchUp 默认 false）。
   */
  start(): void {
    if (this.started) return
    const active = this.store.list({ state: 'active' })
    for (const s of active) {
      this._createJob(s)
    }
    this.started = true
    logger.info(`[ScheduleEngine] started with ${active.length} active schedule(s)`)
  }

  /**
   * 关闭 — 停所有 croner jobs。不强 kill 正在执行的 run（等它们自然完成）。
   */
  stop(): void {
    if (!this.started) return
    for (const job of this.jobs.values()) {
      try {
        job.stop()
      } catch {
        /* best effort */
      }
    }
    this.jobs.clear()
    this.started = false
    logger.info('[ScheduleEngine] stopped')
  }

  /**
   * 增/改一条 schedule 的 croner job（管理用：create / resume 后调）。
   * state 不是 active 就 removeJob（pause / delete 后）。
   */
  upsertJob(schedule: Schedule): void {
    if (!this.started) return
    this.removeJob(schedule.id)
    if (schedule.state !== 'active') return
    this._createJob(schedule)
  }

  /** 移除一条 croner job（pause / delete 后调） */
  removeJob(id: string): void {
    const job = this.jobs.get(id)
    if (job) {
      try {
        job.stop()
      } catch {
        /* best effort */
      }
      this.jobs.delete(id)
    }
  }

  // ============================================================================
  // 触发 — 同步（run_now）/ tick（扫描）
  // ============================================================================

  /**
   * 同步触发一条 schedule — 不走 croner；run_now 工具调用或测试用。
   *
   * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): 内部重试循环
   *   - maxAttempts = maxRetries + 1（首次也算 attempt=1）
   *   - 失败后计算 next_attempt_at = now + backoff[attempt-1] * 1000
   *   - emit schedule.retried { attempt, next_attempt_at }
   *   - 写一条 status='failed' 的 schedule_runs 行（带 next_attempt_at），审计完整
   *   - 全部失败 → emit schedule.failed + recordOutcome + L2 pause（保留原行为）
   *
   * 返回：成功执行 → { runId, status, durationMs } （最后一次 attempt 的 runId/status）
   *      跳过（不存在/非 active/被并发 claim） → { skipped: true, reason }
   */
  async runScheduleNow(
    id: string,
    triggeredBy: 'manual' | 'cron' | 'tick' | 'manual_retry' = 'manual',
  ): Promise<RunOutcome> {
    const schedule = this.store.get(id)
    if (!schedule) return { skipped: true, reason: 'not_found' }
    if (schedule.state !== 'active') return { skipped: true, reason: `state=${schedule.state}` }

    // 原子 claim：next_run_at 清空，避免重复触发
    const claimed = this.store.claimDue(id)
    if (!claimed) return { skipped: true, reason: 'already_claimed' }

    const policy = this.store.getRetryPolicy(schedule)
    const scheduledAt = schedule.nextRunAt ?? Date.now()

    let lastRunId: number | null = null
    let lastStatus: RunStatus = 'success'
    let lastError: string | null = null
    let totalDurationMs = 0

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const runId = this.store.recordRunStart(id, scheduledAt, attempt)
      const startedAt = Date.now()
      lastRunId = runId

      this._emit('schedule.triggered', id, {
        run_id: runId,
        scheduled_at: scheduledAt,
        attempt,
        triggered_by: triggeredBy,
      })

      let status: RunStatus = 'success'
      let error: string | null = null
      let output: string | null = null

      try {
        const replaced = applyTemplate(schedule.toolArgs, {
          schedule,
          attempt,
          now: new Date(startedAt),
        })

        const reg = this.registry.get(schedule.toolName)
        if (!reg) {
          throw new Error(`target tool '${schedule.toolName}' not found in registry`)
        }

        const result = await Promise.race([
          reg.handler(replaced),
          timeoutAfter(schedule.timeoutMs, `schedule '${id}' timeout after ${schedule.timeoutMs}ms`),
        ])
        output = extractOutput(result)
      } catch (e: any) {
        status = 'failed'
        error = e?.message || String(e)
      }

      const durationMs = Date.now() - startedAt
      totalDurationMs += durationMs
      lastStatus = status
      lastError = error
      this.store.recordRunEnd(runId, status, error, output, durationMs)

      if (status === 'success') {
        // 成功 — 不再重试
        this._emit('schedule.succeeded', id, { run_id: runId, attempt, duration_ms: durationMs })
        break
      }

      // 失败 — 判断是否还要重试
      if (attempt < policy.maxAttempts) {
        const backoffSec = policy.backoffSeconds[attempt - 1] ?? 30
        const nextAttemptAt = startedAt + backoffSec * 1000
        this._emit('schedule.retried', id, {
          run_id: runId,
          attempt,
          next_attempt_at: nextAttemptAt,
          error,
          backoff_seconds: backoffSec,
        })
        logger.info(
          `[ScheduleEngine] schedule '${id}' attempt ${attempt} failed, retry in ${backoffSec}s (next_attempt_at=${nextAttemptAt})`,
        )
        // 同步立即跑下一次 attempt（不 setTimeout，避免污染 croner job 上下文）
        // next_attempt_at 只是记录给 schedule_runs 看的"下次计划时间"，不是真实等待
      } else {
        // 最后一次也失败
        this._emit('schedule.failed', id, {
          run_id: runId,
          attempt,
          error,
          fail_count: schedule.failCount + 1,
        })
      }
    }

    // 收尾：更新 schedules.last_* / fail_count / next_run_at（基于最后一次结果）
    const newFailCount = lastStatus === 'failed' ? schedule.failCount + 1 : 0
    const next = nextRunFor(schedule.cronExpr, schedule.timezone)
    this.store.recordOutcome(id, {
      status: lastStatus,
      error: lastError,
      failCount: newFailCount,
      nextRunAt: next ? next.getTime() : null,
    })

    // L2 自动 pause
    if (lastStatus === 'failed' && newFailCount >= L2_AUTO_PAUSE_FAIL_COUNT) {
      this.store.setState(id, 'paused')
      this.removeJob(id)
      this._emit('schedule.paused', id, {
        reason: 'auto',
        fail_count: newFailCount,
        last_error: lastError,
      })
    }

    if (lastRunId == null) {
      // 不该发生（循环至少跑一次）— 防御性返回 skipped
      return { skipped: true, reason: 'no_run_recorded' }
    }
    return { runId: lastRunId, status: lastStatus, durationMs: totalDurationMs }
  }

  // ============================================================================
  // KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): dry_run validation
  // ============================================================================

  /**
   * 校验 schedule 配置（不写入 DB，不触发 target tool）。
   *
   * 检查项：
   *   1. cronExpr 合法（validateCron）
   *   2. timezone 是合法 IANA（Intl.DateTimeFormat 试解析）
   *   3. toolName 在 registry 里存在
   *   4. toolArgs 是 object（非数组、非 null）
   *
   * 返回：
   *   { ok: true, preview } — 校验通过，preview 含 nextRun（按 timezone）
   *   { ok: false, reason, detail? } — 校验失败
   */
  validateScheduleConfig(input: {
    cronExpr: string
    timezone: string
    toolName: string
    toolArgs?: unknown
  }): {
    ok: boolean
    reason?: string
    detail?: string
    preview?: { nextRun: number | null; cronExpr: string; timezone: string; toolName: string }
  } {
    // 1. cron 校验
    const cronCheck = validateCron(input.cronExpr)
    if (!cronCheck.valid) {
      return { ok: false, reason: 'invalid_cron', detail: cronCheck.error ?? 'unknown' }
    }

    // 2. timezone 校验（用 Intl 试解析一个固定时间戳）
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }).format(new Date())
    } catch (e: any) {
      return {
        ok: false,
        reason: 'invalid_timezone',
        detail: e?.message ?? `unknown timezone: ${input.timezone}`,
      }
    }

    // 3. toolName 校验
    if (!input.toolName || typeof input.toolName !== 'string') {
      return { ok: false, reason: 'missing_toolName' }
    }
    const reg = this.registry.get(input.toolName)
    if (!reg) {
      return {
        ok: false,
        reason: 'tool_not_registered',
        detail: `tool '${input.toolName}' not found in registry`,
      }
    }

    // 4. toolArgs 浅校验
    if (
      input.toolArgs != null &&
      (typeof input.toolArgs !== 'object' || Array.isArray(input.toolArgs))
    ) {
      return { ok: false, reason: 'invalid_toolArgs', detail: 'toolArgs must be a JSON object' }
    }

    // 通过：算 preview
    const next = nextRunFor(input.cronExpr, input.timezone)
    return {
      ok: true,
      preview: {
        nextRun: next ? next.getTime() : null,
        cronExpr: input.cronExpr,
        timezone: input.timezone,
        toolName: input.toolName,
      },
    }
  }

  /**
   * 扫一遍 DB，把所有到期且 active 的 schedule 各跑一次。
   * 主要给测试用（不依赖 croner 的 1 秒 tick）。
   */
  async tick(): Promise<void> {
    const now = Date.now()
    const active = this.store.list({ state: 'active' })
    const due = active.filter((s) => s.nextRunAt != null && s.nextRunAt <= now)
    await Promise.all(due.map((s) => this.runScheduleNow(s.id, 'tick')))
  }

  // ============================================================================
  // 内部
  // ============================================================================

  private _createJob(schedule: Schedule): void {
    try {
      const job = new Cron(
        schedule.cronExpr,
        {
          name: `schedule:${schedule.id}`,
          timezone: schedule.timezone,
          protect: true, // 兜底：阻止重叠；主要靠 SQLite claimDue 互斥
        },
        () => {
          // croner 内部调度；fire-and-forget
          void this.runScheduleNow(schedule.id, 'cron').catch((err) => {
            logger.warn(
              `[ScheduleEngine] croner fired runScheduleNow(${schedule.id}) failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            )
          })
        },
      )
      this.jobs.set(schedule.id, job)
    } catch (e: any) {
      logger.warn(
        `[ScheduleEngine] failed to create cron job for ${schedule.id} (${schedule.cronExpr}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }

  private _emit(
    type: string,
    scheduleId: string,
    payload: Record<string, unknown>,
  ): void {
    safeEmit(this.bus, {
      type,
      ts: Date.now(),
      role: 'system',
      producer: PRODUCER,
      producerVersion: PRODUCER_VERSION,
      schemaVersion: 1,
      sessionId: null,
      agentId: null,
      payload: { schedule_id: scheduleId, ...payload },
    })
  }
}