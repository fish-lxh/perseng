/**
 * 公共类型定义
 *
 * 这个包里所有跨文件共享的 type / interface 都集中在这里。
 * 子模块（EventStore / EventBus / Projection / replay）只 import 不再内联。
 *
 * 关键概念：
 * - EventEnvelope：语义化的事件包（事件源时间戳 + 因果链 + payload）
 * - EventStoreRow：从 SQLite 取出的物理行（envelope 与 stored row 用同一个 interface 表达）
 * - CausationContext：事件来自何处（嵌套调用链 / 多进程追踪）
 *
 * 设计参考：M1 — packages/events 设计稿。
 */

/**
 * 因果链上下文 — 跨事件追踪
 *
 * - causationId：上一个 event.id（"我因为什么发生"）
 * - correlationId：一组事件的共同 trace id（"我们属于同一个 workflow"）
 */
export interface CausationContext {
  /** 上一事件 id（同 store 内） */
  causationId?: number | null
  /** trace id — 多事件共享 */
  correlationId?: string | null
}

/** 事件上下文 — 谁 / 在哪个会话 / 在哪个容器里发生 */
export interface EventContext {
  sessionId?: string | null
  containerId?: string | null
  agentId?: string | null
  imageId?: string | null
}

/**
 * 单个事件的完整包 — emit 入参
 *
 * `payload` 是业务负载（JSON.stringify 友好的对象）；
 * 物理存储层负责序列化。`ts` 是事件源时间（不是 store-time）。
 *
 * 设计：sessionId/agentId/imageId 同时支持 top-level 与 `context`，方便调用方
 * 扁平写（与 legacy MinimalSystemEvent 兼容）；append 时 top-level 优先。
 */
export interface EventEnvelope<T = unknown> {
  /** 事件类型，如 'core.role.activated' / 'action.activate' / 'lifecycle.want' */
  type: string
  /** 事件源时间（epoch ms） */
  ts: number
  /** 业务上下文（可选；与 top-level sessionId/agentId/imageId 互为冗余） */
  context?: EventContext | null
  /** 业务上下文：top-level 写法（与 legacy MinimalSystemEvent 对齐） */
  sessionId?: string | null
  agentId?: string | null
  imageId?: string | null
  containerId?: string | null
  /** 业务负载，任意可序列化对象 */
  payload: T
  /** 业务推断角色（与 EventLog 兼容） */
  role?: EventRole
  /** 生产者标识，如 'core:actAs' / 'tool:action' */
  producer: string
  /** 生产者版本（语义化版本字符串） */
  producerVersion: string
  /** schema 兼容性版本（默认 1） */
  schemaVersion?: number
  /** 因果链 */
  causation?: CausationContext
  /** 多租户边界（multi-tenant 安全） */
  tenantId?: string | null
  /** 单用户边界（per-user 安全） */
  ownerId?: string | null
}

/**
 * 与 EventLog 同形的角色枚举 — 兼容旧 timeline 数据
 *
 * 新事件进入时由 producer 标注；缺省回落 'system'。
 */
export type EventRole =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'system'
  | 'unknown'

/** EventStore 取出的物理行 — 与 envelope 双向映射
 *
 * 设计：与 legacy TimelineEventRow 兼容，**拍平** context 字段到顶层，
 * 这样 renderer 不用 `.context?.sessionId ?? null`，写起来简单。
 */
export interface EventStoreRow<T = unknown> {
  /** 自增主键 */
  id: number
  /** 事件源时间（epoch ms） */
  ts: number
  /** 落库时间（store-time） */
  ingestedAt: number
  // 拍平的 context 字段
  sessionId: string | null
  containerId: string | null
  agentId: string | null
  imageId: string | null
  // envelope 字段
  type: string
  role: EventRole
  producer: string
  producerVersion: string
  schemaVersion: number
  causation?: CausationContext | undefined
  tenantId: string | null
  ownerId: string | null
  payload: T
}

/** 查询过滤器 */
export interface EventStoreFilter {
  type?: string
  /** 类型白名单（OR）：任一匹配即命中 */
  types?: string[]
  producer?: string
  correlationId?: string
  sessionId?: string
  agentId?: string
  imageId?: string
  tenantId?: string
  ownerId?: string
  sinceTs?: number
  untilTs?: number
}

/** 查询 / 计数选项 */
export interface EventStoreQueryOptions extends EventStoreFilter {
  /** keyset 分页游标 */
  cursor?: number
  /** 排序方向 */
  order?: 'asc' | 'desc'
  /** 分页大小（默认 50，上限 500） */
  limit?: number
}

/**
 * 清空过滤 — 用于 timeline UI / 运维
 *
 * 优先级：filter > scope+targetId。filter 缺失时走 scope 分支。
 */
export interface ClearFilter {
  scope?: 'all' | 'session' | 'agent' | 'image' | 'producer'
  targetId?: string
  /** 直接按 filter 删（高级用法，例如只清某 producer 一周前） */
  filter?: EventStoreFilter
}

/** 入库统计 — ops dashboard 用 */
export interface EventStatistics {
  totalEvents: number
  byType: Record<string, number>
  byProducer: Record<string, number>
  firstTs: number | null
  lastTs: number | null
  dbPath: string
}

/** 事件源 — 给 EventStoreAttacher 用，bridge 已有 SystemBus */
export interface EventSource {
  /** 全捕获 — 优先 */
  onAny?: (handler: (event: MinimalSystemEvent) => void) => () => void
  /** 按类型订阅 — 回退 */
  on?: (type: string, handler: (event: MinimalSystemEvent) => void) => () => void
}

/**
 * Attacher 用的极简事件契约 — 避免依赖 @promptx/core 的 SystemBus 类型
 *
 * 只关心 type / timestamp / data / context 四字段。
 */
export interface MinimalSystemEvent {
  type: string
  timestamp: number
  data?: unknown
  context?: EventContext | null
}

/** 全局 feature flag — 集中常量 */
export const EVENTS_ENABLED_ENV = 'PERSENG_EVENTS_ENABLED'
export const EVENTS_DB_PATH_ENV = 'PERSENG_EVENTS_DB_PATH'

/**
 * 判断事件平台是否启用
 *
 * 默认启用；显式 `PERSENG_EVENTS_ENABLED=false` 关闭。
 * 关闭时 `append` 是 no-op、UI 仍可读（历史数据可用）。
 */
export function isEventsEnabled(): boolean {
  const v = process.env[EVENTS_ENABLED_ENV]
  if (v === undefined || v === '' || v === '1' || v === 'true' || v === 'TRUE' || v === 'yes') return true
  if (v === '0' || v === 'false' || v === 'FALSE' || v === 'no') return false
  // 任何其他非空值视为 true（容错）
  return v !== 'false' && v !== '0'
}
