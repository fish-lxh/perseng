/**
 * timeline MCP 工具 (V2) — V2 EventStore 路由验证
 *
 * KNUTH-FEAT 2026-07-11 (M5 cutover): query_timeline / clear_timeline 现在
 * 走 @promptx/events.getEventStore()，不再 import legacy ~/timeline/*。
 *
 * 测试目标：
 * 1. handler 调用 getEventStore()，不依赖 legacy 模块
 * 2. roles 过滤在 client-side 二次过滤（V2 SQL 层不支持）
 * 3. producer 过滤透传到 V2 store.query
 * 4. cursor 翻页逻辑保留（rows.length === limit 时取 last id）
 * 5. clear scope=producer 透传
 * 6. EventStore 不可用时返回友好错误
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { queryTimelineTool, clearTimelineTool } from '../timeline.js'
import type { EventStore, EventStoreRow } from '@promptx/events'

// ============================================================================
// storeFakes: 用 closure 持有 mock store + 调用历史
// ============================================================================

type QueryCall = {
  opts: unknown
}
type CountCall = {
  filter: unknown
}
type ClearCall = {
  filter: unknown
}

const storeFakes: {
  store: EventStore | null
  queries: QueryCall[]
  counts: CountCall[]
  clears: ClearCall[]
} = {
  store: null,
  queries: [],
  counts: [],
  clears: [],
}

function fakeStore(): EventStore {
  const fake: Partial<EventStore> = {
    query: vi.fn(async (opts: unknown) => {
      storeFakes.queries.push({ opts })
      // 返回 1 行，cursor 验证用
      return [
        {
          id: 73,
          ts: 1719792000000,
          ingestedAt: 1719792000001,
          sessionId: 's1',
          containerId: null,
          agentId: null,
          imageId: null,
          type: 'action.activate',
          role: 'system',
          producer: 'tool:action',
          producerVersion: '2.4.1',
          schemaVersion: 1,
          causation: undefined,
          tenantId: null,
          ownerId: null,
          payload: { role: 'luban' },
        } satisfies EventStoreRow,
      ]
    }),
    count: vi.fn(async (filter: unknown) => {
      storeFakes.counts.push({ filter })
      return 100
    }),
    clear: vi.fn(async (filter: unknown) => {
      storeFakes.clears.push({ filter })
      return { deleted: 5 }
    }),
  }
  return fake as EventStore
}

// ============================================================================
// mock @promptx/events — 只暴露 getEventStore()
// ============================================================================

vi.mock('@promptx/events', async () => {
  const actual = await vi.importActual<typeof import('@promptx/events')>('@promptx/events')
  return {
    ...actual,
    getEventStore: () => storeFakes.store,
  }
})

// ============================================================================
// 测试
// ============================================================================

beforeEach(() => {
  storeFakes.store = fakeStore()
  storeFakes.queries = []
  storeFakes.counts = []
  storeFakes.clears = []
})

/** MCPOutputAdapter 在 JSON 后面追加了 "--- 时间戳 / token 元数据"，测试需要剥掉。 */
function extractJsonPayload(text: string): unknown {
  const idx = text.indexOf('\n\n---\n')
  const head = idx >= 0 ? text.slice(0, idx) : text
  return JSON.parse(head)
}

describe('queryTimelineTool (V2)', () => {
  it('I-Q-1: 调用 store.query 和 store.count', async () => {
    const result = await queryTimelineTool.handler({ limit: 50 })
    expect(storeFakes.queries).toHaveLength(1)
    expect(storeFakes.counts).toHaveLength(1)
    expect(result.isError).toBeFalsy()
  })

  it('I-Q-2: producer / types / sinceTs / untilTs 透传到 V2 query', async () => {
    await queryTimelineTool.handler({
      producer: 'tool:action',
      types: ['action.activate', 'action.born'],
      sinceTs: 100,
      untilTs: 200,
      sessionId: 's1',
      limit: 50,
    })
    const call = storeFakes.queries[0]!
    const opts = call.opts as Record<string, unknown>
    expect(opts['producer']).toBe('tool:action')
    expect(opts['types']).toEqual(['action.activate', 'action.born'])
    expect(opts['sinceTs']).toBe(100)
    expect(opts['untilTs']).toBe(200)
    expect(opts['sessionId']).toBe('s1')
  })

  it('I-Q-3: roles 过滤在 client-side 完成（V2 SQL 不支持）', async () => {
    const store = storeFakes.store!
    ;(store.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 1,
        ts: 1,
        ingestedAt: 2,
        sessionId: null,
        containerId: null,
        agentId: null,
        imageId: null,
        type: 't1',
        role: 'user',
        producer: 'p',
        producerVersion: '1',
        schemaVersion: 1,
        tenantId: null,
        ownerId: null,
        payload: {},
      },
      {
        id: 2,
        ts: 2,
        ingestedAt: 3,
        sessionId: null,
        containerId: null,
        agentId: null,
        imageId: null,
        type: 't2',
        role: 'assistant',
        producer: 'p',
        producerVersion: '1',
        schemaVersion: 1,
        tenantId: null,
        ownerId: null,
        payload: {},
      },
      {
        id: 3,
        ts: 3,
        ingestedAt: 4,
        sessionId: null,
        containerId: null,
        agentId: null,
        imageId: null,
        type: 't3',
        role: 'user',
        producer: 'p',
        producerVersion: '1',
        schemaVersion: 1,
        tenantId: null,
        ownerId: null,
        payload: {},
      },
    ])

    const result = await queryTimelineTool.handler({ roles: ['user'], limit: 50 })
    const text = extractJsonPayload((result.content[0] as { text: string }).text) as { events: Array<{ role: string }> }
    expect(text.events).toHaveLength(2)
    expect(text.events.every((e) => e.role === 'user')).toBe(true)
  })

  it('I-Q-4: rows.length === limit 时返回 nextCursor = last.id', async () => {
    const store = storeFakes.store!
    const rows = [
      { id: 10 }, { id: 11 }, { id: 12 },
    ]
    ;(store.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      rows.map((r) => ({
        id: r.id,
        ts: 1,
        ingestedAt: 2,
        sessionId: null,
        containerId: null,
        agentId: null,
        imageId: null,
        type: 't',
        role: 'system' as const,
        producer: 'p',
        producerVersion: '1',
        schemaVersion: 1,
        tenantId: null,
        ownerId: null,
        payload: {},
      })),
    )
    const result = await queryTimelineTool.handler({ limit: 3 })
    const text = extractJsonPayload((result.content[0] as { text: string }).text) as { nextCursor: number | null }
    expect(text.nextCursor).toBe(12)
  })

  it('I-Q-5: rows.length < limit 时 nextCursor = null', async () => {
    const store = storeFakes.store!
    ;(store.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 1, ts: 1, ingestedAt: 2, sessionId: null, containerId: null, agentId: null,
        imageId: null, type: 't', role: 'system' as const, producer: 'p', producerVersion: '1',
        schemaVersion: 1, tenantId: null, ownerId: null, payload: {},
      },
    ])
    const result = await queryTimelineTool.handler({ limit: 50 })
    const text = extractJsonPayload((result.content[0] as { text: string }).text) as { nextCursor: number | null }
    expect(text.nextCursor).toBeNull()
  })

  it('I-Q-6: EventStore 不可用时返回错误而非抛错', async () => {
    storeFakes.store = null
    const result = await queryTimelineTool.handler({})
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/EventStore unavailable/)
  })
})

describe('clearTimelineTool (V2)', () => {
  it('I-C-1: scope=all → clear({ scope: all })', async () => {
    await clearTimelineTool.handler({ scope: 'all' })
    expect(storeFakes.clears).toHaveLength(1)
    expect(storeFakes.clears[0]?.filter).toEqual({ scope: 'all' })
  })

  it('I-C-2: scope=producer + targetId 透传', async () => {
    await clearTimelineTool.handler({ scope: 'producer', targetId: 'tool:action' })
    expect(storeFakes.clears[0]?.filter).toEqual({
      scope: 'producer',
      targetId: 'tool:action',
    })
  })

  it('I-C-3: 默认 scope = all', async () => {
    await clearTimelineTool.handler({})
    expect(storeFakes.clears[0]?.filter).toEqual({ scope: 'all' })
  })

  it('I-C-4: 返回 deleted 计数', async () => {
    const result = await clearTimelineTool.handler({ scope: 'all' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/已清空 5 条/)
  })

  it('I-C-5: EventStore 不可用时返回错误', async () => {
    storeFakes.store = null
    const result = await clearTimelineTool.handler({ scope: 'all' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/EventStore unavailable/)
  })
})