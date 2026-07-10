/**
 * timeline:* IPC handlers — read from @promptx/events (V2 store).
 *
 * KNUTH-FEAT 2026-07-11 (M3 PR-3 of runtime event platform).
 *
 * 改动概要：
 * - 数据源：`@promptx/mcp-server/timeline` → `@promptx/events`（V2 `events_v2` 表）
 * - 通道名一字不变：`timeline:query` / `timeline:clear` / `timeline:statistics`
 * - 新增：`timeline:audit`（M2 的 audit() 包装）
 * - 行映射：V2 `EventStoreRow` → legacy `TimelineEventRow` 形状（payload 重 stringify，
 *   `ingestedAt` → `createdAt`），renderer TimelinePanel 不用改
 *
 * 双写并存期：本 main 进程读 V2 单一来源；
 * legacy `~/.perseng/timeline/events.db` 由 AgentXService.attachTimeline() 继续写。
 * 详见 `apps/desktop/docs/events-cutover.md`（M3 同步落地的 runbook）。
 */

import { ipcMain } from 'electron'
import * as logger from '@promptx/logger'
import { getEventStore } from '@promptx/events'
import type {
  ClearFilter as EventsClearFilter,
  EventStoreFilter,
  EventStoreQueryOptions,
  EventStoreRow,
} from '@promptx/events'

// ============================================================================
// 形状适配：V2 row → legacy TimelineEventRow (renderer 期望的形状)
// ============================================================================

type EventRole =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'system'
  | 'unknown'

interface TimelineEventRow {
  id: number
  ts: number
  sessionId: string | null
  containerId: string | null
  agentId: string | null
  imageId: string | null
  type: string
  role: EventRole
  payload: string // JSON-stringified
  createdAt: number
}

function stringifyPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null)
  } catch {
    return '"[unserializable]"'
  }
}

function mapRowToLegacy(row: EventStoreRow): TimelineEventRow {
  return {
    id: row.id,
    ts: row.ts,
    sessionId: row.sessionId,
    containerId: row.containerId,
    agentId: row.agentId,
    imageId: row.imageId,
    type: row.type,
    role: row.role,
    payload: stringifyPayload(row.payload),
    createdAt: row.ingestedAt,
  }
}

// ============================================================================
// 过滤映射：renderer 调的 flat filter → V2 EventStoreQueryOptions / EventStoreFilter
// ============================================================================

interface RendererQueryFilter {
  limit?: number
  order?: 'asc' | 'desc'
  cursor?: number
  sessionId?: string
  agentId?: string
  imageId?: string
  types?: string[]
  roles?: EventRole[]
  sinceTs?: number
  untilTs?: number
}

function toQueryOptions(filter: RendererQueryFilter = {}): EventStoreQueryOptions {
  const opts: EventStoreQueryOptions = {
    limit: filter.limit ?? 50,
    order: filter.order ?? 'desc',
  }
  if (filter.cursor !== undefined) opts.cursor = filter.cursor
  const f = toEventsFilter(filter)
  return { ...opts, ...f }
}

function toEventsFilter(filter: RendererQueryFilter): EventStoreFilter {
  const f: EventStoreFilter = {}
  if (filter.sessionId) f.sessionId = filter.sessionId
  if (filter.agentId) f.agentId = filter.agentId
  if (filter.imageId) f.imageId = filter.imageId
  if (filter.sinceTs !== undefined) f.sinceTs = filter.sinceTs
  if (filter.untilTs !== undefined) f.untilTs = filter.untilTs
  if (filter.types && filter.types.length > 0) f.types = filter.types
  // 注：V2 store 暂不支持 roles[]（role 是 envelope 字段而非 query 一级维度），
  // 后续 PR-5 可以加入。renderer 的 roles 过滤在 UI 侧就能应付（M3 暂不强求 server 端）。
  return f
}

function toClearFilter(filter: { scope?: string; targetId?: string }): EventsClearFilter {
  if (filter.scope && filter.scope !== 'all') {
    if (!filter.targetId) throw new Error('clear: targetId required for non-all scope')
    return {
      scope: filter.scope as 'session' | 'agent' | 'image' | 'producer',
      targetId: filter.targetId,
    }
  }
  return { scope: 'all' }
}

// ============================================================================
// IPC 注册
// ============================================================================

let registered = false

/** 测试钩子：清掉 idempotent 守卫，让 beforeEach 能重新注册 */
export function _resetTimelineIpcRegistration(): void {
  registered = false
}

export function registerTimelineIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('timeline:query', async (_event, filter: RendererQueryFilter = {}) => {
    try {
      const store = getEventStore()
      const opts = toQueryOptions(filter)
      const limit = opts.limit ?? 50
      const rows = await store.query(opts)
      const total = await store.count(toEventsFilter(filter))
      const nextCursor =
        rows.length === limit && rows.length > 0 ? (rows[rows.length - 1]?.id ?? null) : null
      return {
        success: true,
        events: rows.map(mapRowToLegacy),
        total,
        nextCursor,
      }
    } catch (error) {
      logger.error('Failed to query timeline (EventStore):', String(error))
      return { success: false, error: String(error), events: [], total: 0, nextCursor: null }
    }
  })

  ipcMain.handle(
    'timeline:clear',
    async (
      _event,
      filter: { scope?: 'all' | 'session' | 'agent' | 'image' | 'producer'; targetId?: string } = {},
    ) => {
      try {
        const store = getEventStore()
        const clearFilter = toClearFilter(filter)
        const result = await store.clear(clearFilter)
        logger.info(
          `[timeline:clear] deleted ${result.deleted} events (scope=${filter.scope ?? 'all'})`,
        )
        return { success: true, ...result }
      } catch (error) {
        logger.error('Failed to clear timeline (EventStore):', String(error))
        return { success: false, error: String(error), deleted: 0 }
      }
    },
  )

  ipcMain.handle('timeline:statistics', async () => {
    try {
      const store = getEventStore()
      return await store.getStatistics()
    } catch (error) {
      logger.error('Failed to get timeline statistics (EventStore):', String(error))
      return { totalEvents: 0, byType: {}, byProducer: {}, firstTs: null, lastTs: null, dbPath: '' }
    }
  })

  // M3 新增 — 走 audit() 包装（带 byProducer / first/last ts）
  ipcMain.handle('timeline:audit', async () => {
    try {
      const store = getEventStore()
      const { audit } = await import('@promptx/events')
      return await audit(store)
    } catch (error) {
      logger.error('Failed to audit timeline:', String(error))
      return { totalEvents: 0, byType: {}, byProducer: {}, firstTs: null, lastTs: null, dbPath: '' }
    }
  })
}
