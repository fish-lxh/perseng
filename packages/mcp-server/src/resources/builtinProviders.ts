/**
 * Built-in Resource Providers — 3 个内置 (3.3 P1)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.3 / 批次 2)
 *
 * - RolesResourceProvider         perseng://roles          → @promptx/core.discover()
 * - EventsStatsResourceProvider   perseng://events/stats   → @promptx/events.audit()
 * - RecentEventsResourceProvider  perseng://events/recent  → EventStore.query()
 *
 * 动态 import @promptx/core / @promptx/events 让 mcp-server 不强行依赖，
 * 失败时返回带 isError-like 文本（走空字符串 + description）。
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import type { ResourceProvider } from '~/registry/ResourceRegistry.js'

function makeText(uri: string, mimeType: string, text: string): ReadResourceResult {
  return { contents: [{ uri, mimeType, text }] }
}

// ============================================================================
// Roles — 角色列表（来自 @promptx/core.discover()）
// ============================================================================

export const RolesResourceProvider: ResourceProvider = {
  uri: 'perseng://roles',
  name: 'Perseng Roles',
  description: 'All available roles, their IDs and metadata (from @promptx/core.discover())',
  mimeType: 'application/json',
  async read() {
    try {
      const core = await import('@promptx/core')
      const coreExports = (core.default || core) as { discover?: () => Promise<unknown> }
      if (!coreExports.discover) {
        return makeText(this.uri, this.mimeType, JSON.stringify({ roles: [], note: 'discover() unavailable' }))
      }
      const result = await coreExports.discover()
      return makeText(this.uri, this.mimeType, JSON.stringify({ roles: result }, null, 2))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return makeText(this.uri, this.mimeType, JSON.stringify({ roles: [], error: msg }))
    }
  },
}

// ============================================================================
// EventsStats — 事件统计（来自 @promptx/events.audit()）
// ============================================================================

export const EventsStatsResourceProvider: ResourceProvider = {
  uri: 'perseng://events/stats',
  name: 'EventStore Statistics',
  description: 'EventStore statistics (total / byType / byProducer / first/last ts) via audit()',
  mimeType: 'application/json',
  async read() {
    try {
      const events = await import('@promptx/events')
      const store = events.getEventStore()
      if (!store) {
        return makeText(this.uri, this.mimeType, JSON.stringify({ totalEvents: 0, note: 'EventStore unavailable' }))
      }
      const { audit } = await import('@promptx/events')
      const stats = await audit(store)
      return makeText(this.uri, this.mimeType, JSON.stringify(stats, null, 2))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return makeText(this.uri, this.mimeType, JSON.stringify({ error: msg }))
    }
  },
}

// ============================================================================
// RecentEvents — 最近 N 条事件（EventStore.query）
// ============================================================================

export const RecentEventsResourceProvider: ResourceProvider = {
  uri: 'perseng://events/recent',
  name: 'Recent Events',
  description: 'Most recent N events from EventStore.query() (limit via args.limit; default 50)',
  mimeType: 'application/json',
  async read(args?: { sessionId?: string }) {
    try {
      const events = await import('@promptx/events')
      const store = events.getEventStore()
      if (!store) {
        return makeText(this.uri, this.mimeType, JSON.stringify({ events: [], note: 'EventStore unavailable' }))
      }
      const rows = await store.query({
        limit: 50,
        order: 'desc',
        ...(args?.sessionId ? { sessionId: args.sessionId } : {}),
      })
      return makeText(this.uri, this.mimeType, JSON.stringify({ count: rows.length, events: rows }, null, 2))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return makeText(this.uri, this.mimeType, JSON.stringify({ error: msg }))
    }
  },
}

export const BUILTIN_RESOURCE_PROVIDERS: ResourceProvider[] = [
  RolesResourceProvider,
  EventsStatsResourceProvider,
  RecentEventsResourceProvider,
] as const