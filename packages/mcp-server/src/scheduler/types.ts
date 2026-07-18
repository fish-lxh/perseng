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
