/**
 * scheduler/types.ts — 调度子系统的内部类型
 *
 * 设计参考 docs/scheduler-design.md §3, §4, §11。
 * 不导出到 mcp-server 之外；上层（schedule 工具）也只 import 此文件。
 *
 * DB schema 是 snake_case（与 SQLite 列对齐），TS 接口是 camelCase，映射在
 * ScheduleStore._mapRow 内显式做。
 */

// ============================================================================
// 常量
// ============================================================================

/** 全局 feature flag — 同 PERSENG_EVENTS_ENABLED 模式 */
export const SCHEDULES_ENABLED_ENV = 'PERSENG_SCHEDULES_ENABLED'
/** DB 路径覆盖 — env 优先于默认 */
export const SCHEDULES_DB_PATH_ENV = 'PERSENG_SCHEDULES_DB_PATH'
/** 当 env 未设置时的默认时区 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai'
/** L2 自动暂停阈值 — 连续失败次数 */
export const L2_AUTO_PAUSE_FAIL_COUNT = 3
/** 单次执行的默认超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 60_000

// KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): 重试回退策略（设计稿 §5.3）
/** 默认重试 backoff（秒）：30s → 2min → 8min */
export const DEFAULT_RETRY_BACKOFF_SECONDS = [30, 120, 480] as const
/** 重试最大次数上限（防止恶意 config） */
export const MAX_RETRY_LIMIT = 10

/** 重试策略（从 schedule.maxRetries 派生） */
export interface RetryPolicy {
  /** 总尝试次数（含首次）：maxRetries + 1；maxRetries=0 → maxAttempts=1（不重试） */
  maxAttempts: number
  /** 各次重试之间的延迟（秒）；下标 0 = 第 1 次重试前等待 */
  backoffSeconds: number[]
}

// ============================================================================
// 状态机
// ============================================================================

export type ScheduleState = 'pending' | 'active' | 'paused' | 'deleted'
export type RunStatus = 'running' | 'success' | 'failed' | 'skipped' | 'vetoed'

// ============================================================================
// Schedule
// ============================================================================

/** DB 行 → TS 接口（snake_case 已经映射成 camelCase） */
export interface Schedule {
  id: string
  name: string
  description: string | null
  cronExpr: string
  timezone: string
  toolName: string
  /** 解析后的 JSON 对象；DB 里是 TEXT */
  toolArgs: Record<string, unknown>
  state: ScheduleState
  maxRetries: number
  timeoutMs: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  createdBy: string | null
  createdAt: number
  updatedAt: number
  approvedAt: number | null
  lastRunAt: number | null
  /** 缓存的 nextRun()，避免每次 list 都重新算 */
  nextRunAt: number | null
  lastStatus: RunStatus | null
  lastError: string | null
  failCount: number
}

/** create() 入参 — 不包含 id（DB 生成 uuid v7） */
export interface NewSchedule {
  id: string
  name: string
  description?: string | null
  cronExpr: string
  timezone?: string
  toolName: string
  toolArgs: Record<string, unknown>
  state?: ScheduleState
  maxRetries?: number
  timeoutMs?: number
  notifyOnSuccess?: boolean
  notifyOnFailure?: boolean
  createdBy?: string | null
  approvedAt?: number | null
}

// ============================================================================
// ScheduleRun
// ============================================================================

export interface ScheduleRun {
  id: number
  scheduleId: string
  scheduledAt: number
  startedAt: number | null
  finishedAt: number | null
  status: RunStatus
  attempt: number
  error: string | null
  output: string | null
  durationMs: number | null
  /** KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): 下次重试时间戳（失败时）；null = 无下次 */
  nextAttemptAt: number | null
}

// ============================================================================
// 列表/查询 filter
// ============================================================================

export interface ScheduleListFilter {
  state?: ScheduleState
  toolName?: string
  limit?: number
}

export interface ScheduleRunHistoryFilter {
  scheduleId: string
  limit?: number
  since?: number
}

// ============================================================================
// KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 9): 失败模式识别
// ============================================================================

/** 失败模式分析结果 */
export interface FailurePattern {
  /** 连续失败次数（最近的 N 条全部 failed） */
  consecutiveFailures: number
  /** 错误指纹 — 相同错误会归为同一 fingerprint */
  sameErrorHash: string | null
  /** 失败原因原文（最近一次） */
  errorMessage: string | null
  /** 首次失败时间（连续段的起点） */
  firstFailedAt: number | null
  /** 最近失败时间 */
  lastFailedAt: number | null
  /** 建议动作 */
  suggestAction: 'pause' | 'review' | 'investigate'
}
