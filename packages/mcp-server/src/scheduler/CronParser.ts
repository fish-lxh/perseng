/**
 * scheduler/CronParser.ts — croner 薄包装
 *
 * 只暴露 schedule 工具需要的两个能力：
 *   - parse: 给出 nextRun Date（用于缓存进 schedules.next_run_at）
 *   - validate: 不构造 cron 实例，纯校验（用于 create 时的快速拒绝）
 *
 * 错误信息统一抛 TypeError(message)（错误就是错误，不是 result.valid=false 的 string）。
 * 上层（ScheduleStore / ScheduleEngine）必须 try/catch。
 *
 * croner 设计参考：
 *   - 默认 catchUp: false，唤醒/重启不补触发
 *   - 默认 protect: false，多触发会排队（我们靠 SQLite claimDue 互斥，不用 croner 的 protect）
 *   - 时区直接传 IANA 字符串
 */

import { Cron } from 'croner'

export interface CronParseResult {
  /** 直接可用的 nextRun；非法表达式返回 null */
  nextRun: Date | null
  valid: boolean
  /** 非法时的错误信息（合法时省略） */
  error?: string
}

export interface CronValidateResult {
  valid: boolean
  error?: string
}

/**
 * 校验 cron 表达式并返回 nextRun。
 *
 * @param expr   cron 字符串（5 段或 6 段）
 * @param tz     IANA 时区；省略按 process.env.TZ / 系统默认
 */
export function parse(expr: string, tz?: string): CronParseResult {
  try {
    // nextRun() 不需要构造真 cron；用 Cron(expr, { timezone }) 后调 nextRun()
    const job = new Cron(expr, { timezone: tz })
    const next = job.nextRun()
    return { nextRun: next, valid: true }
  } catch (e: unknown) {
    return {
      nextRun: null,
      valid: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 仅校验 — 不构造 nextRun；用于 create 时的快速拒绝。
 *
 * 做法：catch parse 错误。复杂度 O(1)。
 */
export function validate(expr: string): CronValidateResult {
  try {
    new Cron(expr)
    return { valid: true }
  } catch (e: unknown) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 取 schedule 的下次触发时间（带时区）。
 * 复用 croner 的 nextRun() 但包一层错误处理 — 设计稿 §5.4 用此 cache 进
 * schedules.next_run_at 给 tick() 用 `next_run_at <= now` 查询。
 */
export function nextRunFor(expr: string, tz?: string): Date | null {
  try {
    return new Cron(expr, { timezone: tz }).nextRun()
  } catch {
    return null
  }
}
