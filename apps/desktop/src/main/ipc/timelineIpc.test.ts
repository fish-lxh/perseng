/**
 * timelineIpc — 验证 IPC handler 路由到 EventStore (M3 PR)
 *
 * 测试策略：
 * - mock `electron.ipcMain.handle()` 收 handler map
 * - mock `@promptx/events` 的 `getEventStore()` 与 `audit()`
 * - 用 tmpdir 隔开真实 DB
 * - 验证 IPC handler 名、参数映射、shape 适配
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 必须在 import timelineIpc 之前 — vi.mock hoist
const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler)
    },
  },
}))

// In-memory fake EventStore — 直接覆盖 getEventStore
const storeFakes: Array<{
  query: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  getStatistics: ReturnType<typeof vi.fn>
}> = []

vi.mock('@promptx/events', async () => {
  const { EventStore } = await import('@promptx/events')
  return {
    getEventStore: () => {
      // 全局共享一个 store（per test 唯一）
      if (storeFakes.length === 0) {
        // 第一次调用时实际打开；如果 caller 把它 reset 了，就返回替身
        return null // 由 beforeEach 注入
      }
      return storeFakes[0]
    },
    audit: vi.fn(async () => ({ totalEvents: 0, byType: {}, byProducer: {}, firstTs: null, lastTs: null, dbPath: '' })),
    EventStore,
  }
})

const timelineIpcModule = await import('./timelineIpc.js')

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { EventStore } from '@promptx/events'

let tmpDir = ''
let store: EventStore

beforeEach(async () => {
  storeFakes.length = 0
  ipcHandlers.clear()
  timelineIpcModule._resetTimelineIpcRegistration()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-timeline-ipc-'))
  process.env['PERSENG_EVENTS_DB_PATH'] = path.join(tmpDir, 'events.db')
  process.env['PERSENG_EVENTS_ENABLED'] = 'true'

  store = new EventStore(path.join(tmpDir, 'events.db'))

  // 给 mock 提供真实 EventStore 替身；所有方法直接 delegate
  storeFakes.push({
    query: vi.fn(async (opts: any) => store.query(opts)),
    count: vi.fn(async (filter: any) => store.count(filter)),
    clear: vi.fn(async (filter: any) => store.clear(filter)),
    getStatistics: vi.fn(async () => store.getStatistics()),
  })
})

afterEach(async () => {
  store.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
  delete process.env['PERSENG_EVENTS_DB_PATH']
  delete process.env['PERSENG_EVENTS_ENABLED']
})

// ============================================================================
// Tests
// ============================================================================

describe('registerTimelineIpc — M3 V2 read path', () => {
  it('registers all 4 handlers (query/clear/statistics/audit)', () => {
    timelineIpcModule.registerTimelineIpc()
    expect(ipcHandlers.has('timeline:query')).toBe(true)
    expect(ipcHandlers.has('timeline:clear')).toBe(true)
    expect(ipcHandlers.has('timeline:statistics')).toBe(true)
    expect(ipcHandlers.has('timeline:audit')).toBe(true)
  })

  it('is idempotent — calling twice does not overwrite handlers', () => {
    timelineIpcModule.registerTimelineIpc()
    const firstQuery = ipcHandlers.get('timeline:query')
    timelineIpcModule.registerTimelineIpc()
    expect(ipcHandlers.get('timeline:query')).toBe(firstQuery)
  })

  it('timeline:query maps V2 row → legacy TimelineEventRow shape', async () => {
    await store.append({
      type: 'core.role.activated',
      ts: 1_700_000_000_000,
      role: 'system',
      producer: 'core:actAs',
      producerVersion: '2.4.1',
      schemaVersion: 1,
      sessionId: 'sess-1',
      agentId: 'agent-1',
      payload: { roleId: 'nuwa', kind: 'role' },
    })

    timelineIpcModule.registerTimelineIpc()
    const handler = ipcHandlers.get('timeline:query')!

    const result = await handler({}, { limit: 50, order: 'desc' }) as {
      success: boolean
      events: Array<Record<string, unknown>>
      total: number
      nextCursor: number | null
    }
    expect(result.success).toBe(true)
    expect(result.total).toBe(1)
    expect(result.events.length).toBe(1)

    const ev = result.events[0]!
    // legacy 形状字段都存在
    expect(ev['id']).toBeTypeOf('number')
    expect(ev['ts']).toBe(1_700_000_000_000)
    expect(ev['sessionId']).toBe('sess-1')
    expect(ev['agentId']).toBe('agent-1')
    expect(ev['type']).toBe('core.role.activated')
    expect(ev['role']).toBe('system')
    expect(typeof ev['payload']).toBe('string') // V2 payload: unknown → legacy payload: JSON string
    expect(ev['createdAt']).toBeTypeOf('number') // ingestedAt → createdAt
  })

  it('timeline:query passes sessionId/types filter through', async () => {
    await store.append({
      type: 'core.role.activated',
      ts: 1_700_000_000_000,
      role: 'system',
      producer: 'core:actAs',
      producerVersion: '2.4.1',
      schemaVersion: 1,
      sessionId: 'sess-A',
      agentId: null,
      payload: { roleId: 'nuwa' },
    })
    await store.append({
      type: 'action.activate',
      ts: 1_700_000_000_001,
      role: 'system',
      producer: 'tool:action',
      producerVersion: '1.0.0',
      schemaVersion: 1,
      sessionId: 'sess-B',
      agentId: null,
      payload: { role: 'sean' },
    })

    timelineIpcModule.registerTimelineIpc()
    const handler = ipcHandlers.get('timeline:query')!

    const r1 = await handler({}, { limit: 50, sessionId: 'sess-A' }) as { events: unknown[]; total: number }
    expect(r1.total).toBe(1)

    const r2 = await handler({}, { limit: 50, types: ['core.role.activated'] }) as { events: unknown[]; total: number }
    expect(r2.total).toBe(1)
  })

  it('timeline:clear routes to EventStore.clear with scope=session', async () => {
    await store.append({
      type: 'core.role.activated',
      ts: 1_700_000_000_000,
      role: 'system',
      producer: 'core:actAs',
      producerVersion: '2.4.1',
      schemaVersion: 1,
      sessionId: 'sess-X',
      agentId: null,
      payload: { roleId: 'nuwa' },
    })

    timelineIpcModule.registerTimelineIpc()
    const handler = ipcHandlers.get('timeline:clear')!

    const result = await handler({}, { scope: 'session', targetId: 'sess-X' }) as {
      success: boolean
      deleted: number
    }
    expect(result.success).toBe(true)
    expect(result.deleted).toBe(1)

    // store 计数应为 0
    const stats = await store.getStatistics()
    expect(stats.totalEvents).toBe(0)
  })

  it('timeline:statistics returns EventStatistics shape', async () => {
    timelineIpcModule.registerTimelineIpc()
    const handler = ipcHandlers.get('timeline:statistics')!
    const stats = await handler({}) as {
      totalEvents: number
      byType: Record<string, number>
      byProducer: Record<string, number>
      dbPath: string
    }
    expect(typeof stats.totalEvents).toBe('number')
    expect(typeof stats.byType).toBe('object')
    expect(typeof stats.byProducer).toBe('object')
    expect(stats.dbPath).toContain(tmpDir)
  })

  it('timeline:audit handler is registered and callable', async () => {
    timelineIpcModule.registerTimelineIpc()
    const handler = ipcHandlers.get('timeline:audit')!
    const result = await handler({}) as { totalEvents: number }
    expect(typeof result.totalEvents).toBe('number')
  })

  it('returns success:false on store error (handler robustness)', async () => {
    timelineIpcModule.registerTimelineIpc()
    const handler = ipcHandlers.get('timeline:query')!

    // 替换 query 替身让它抛错
    storeFakes[0]!.query.mockRejectedValueOnce(new Error('store blown up'))

    const result = await handler({}, { limit: 50 }) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('store blown up')
  })
})
