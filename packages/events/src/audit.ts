/**
 * Audit — 统计 / dashboard helper
 *
 * M1 提供基于 EventStore.getStatistics() 的薄包装；
 * M2 扩展为带时间窗 / per-tenant 的更丰富视图。
 */

import type { EventStore } from './EventStore.js'
import type { EventStoreFilter, EventStatistics } from './types.js'

export interface AuditOptions {
  /** 限定时间区间（M2 扩展；M1 透传） */
  sinceTs?: number
  untilTs?: number
  filter?: EventStoreFilter
}

/**
 * 当前实现：直接复用 EventStore.getStatistics
 * M2 会在 EventStatistics 之上加 byTypePercentile / trendDelta 等
 */
export async function audit(
  store: EventStore,
  _options: AuditOptions = {},
): Promise<EventStatistics> {
  return store.getStatistics()
}
