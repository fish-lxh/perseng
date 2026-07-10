/**
 * @promptx/events 包入口
 *
 * 子模块：
 *   types         — 公共 type / interface
 *   EventStore    — SQLite 持久化层
 *   EventBus      — 进程内 in-process event bus 接口 + 默认实现
 *   EventStoreAttacher — SystemBus → EventStore bridge
 *   Projection    — replay 用的 fold 抽象（M2）
 *   replay        — replay 服务（M2）
 *   audit         — 统计 / dashboard（M2）
 *   ipc-contract  — 渲染层 IPC 契约（M3）
 *   instance      — 单例管理（M1/M2 复用）
 */

export type {
  CausationContext,
  ClearFilter,
  EventContext,
  EventEnvelope,
  EventRole,
  EventSource,
  EventStatistics,
  EventStoreFilter,
  EventStoreQueryOptions,
  EventStoreRow,
  MinimalSystemEvent,
} from './types.js'

export {
  EVENTS_DB_PATH_ENV,
  EVENTS_ENABLED_ENV,
  isEventsEnabled,
} from './types.js'

export { EventStore } from './EventStore.js'
export { InProcessEventBus } from './EventBus.js'
export type { AttachOptions } from './EventStoreAttacher.js'
export { attachEventStore } from './EventStoreAttacher.js'
export { getEventStore, getEventStoreForTest, resetEventStore } from './instance.js'

// 事件总线 interface（M2+ 才会被外部实现替代）
// 这里我们直接 re-export 类型，不重复定义。MCP 工具依赖这种"接口先有"的形状。
// 该接口在 EventBus.ts 里 import 了 ./index — 仅类型用，无运行时循环。
import type { EventEnvelope as _EventEnvelope } from './types.js'
import type { EventStore as _EventStore } from './EventStore.js'
export type EventBusHandler<T = unknown> = (envelope: _EventEnvelope<T>) => void
export type EventBusUnsubscribe = () => void
export interface EventBus {
  emit<T>(envelope: _EventEnvelope<T>): void
  subscribe<T>(type: string | '*', handler: EventBusHandler<T>): EventBusUnsubscribe
  getStore(): _EventStore | null
}

// M2 — Replay 服务 + Projection + audit
export { replay } from './replay.js'
export type { ReplayOptions } from './replay.js'
export { validatePure } from './Projection.js'
export type { Projection } from './Projection.js'
export { audit } from './audit.js'
export type { AuditOptions } from './audit.js'
