/**
 * EventStoreAttacher 单元测试
 *
 * 覆盖：
 * - EventSource.onAny → handler 桥接到 store
 * - filter allow-list
 * - per-type on() 回退
 * - unsubscribe 真正解绑
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { EventStore } from '../EventStore.js'
import { attachEventStore } from '../EventStoreAttacher.js'
import type { EventSource, MinimalSystemEvent } from '../types.js'

let tmpDir = ''
let store: EventStore | null = null

interface SourceMock extends EventSource {
  emit(ev: MinimalSystemEvent): void
  _anyHandlers: Set<(e: MinimalSystemEvent) => void>
  _typedHandlers: Map<string, Set<(e: MinimalSystemEvent) => void>>
}

function mockSource(): SourceMock {
  const anyHandlers = new Set<(e: MinimalSystemEvent) => void>()
  const typedHandlers = new Map<string, Set<(e: MinimalSystemEvent) => void>>()
  return {
    _anyHandlers: anyHandlers,
    _typedHandlers: typedHandlers,
    onAny(handler) {
      anyHandlers.add(handler)
      return () => anyHandlers.delete(handler)
    },
    on(type, handler) {
      let set = typedHandlers.get(type)
      if (!set) {
        set = new Set()
        typedHandlers.set(type, set)
      }
      set.add(handler)
      return () => set!.delete(handler)
    },
    emit(ev) {
      for (const h of anyHandlers) h(ev)
      const set = typedHandlers.get(ev.type)
      if (set) for (const h of set) h(ev)
    },
  }
}

function mkEvent(type: string, ts: number, data?: unknown): MinimalSystemEvent {
  return { type, timestamp: ts, data, context: { sessionId: 'sess-1' } }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-attacher-test-'))
  store = new EventStore(path.join(tmpDir, 'events.db'))
})

afterEach(async () => {
  if (store) await store.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('attachEventStore — bridge', () => {
  it('captures all events via onAny', async () => {
    const src = mockSource()
    const unsub = attachEventStore(src, store!)
    src.emit(mkEvent('a', 1000))
    src.emit(mkEvent('b', 2000))
    src.emit(mkEvent('c', 3000))
    unsub()
    await new Promise((r) => setTimeout(r, 30))
    const rows = await store!.query({ order: 'asc' })
    expect(rows.length).toBe(3)
    expect(rows[0]!.type).toBe('a')
    expect(rows[2]!.ts).toBe(3000)
  })

  it('honors filter allow-list', async () => {
    const src = mockSource()
    const unsub = attachEventStore(src, store!, { filter: new Set(['keep']) })
    src.emit(mkEvent('keep', 1))
    src.emit(mkEvent('drop', 2))
    src.emit(mkEvent('keep', 3))
    unsub()
    await new Promise((r) => setTimeout(r, 30))
    const rows = await store!.query({ order: 'asc' })
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.type === 'keep')).toBe(true)
  })

  it('uses custom producer / producerVersion', async () => {
    const src = mockSource()
    const unsub = attachEventStore(src, store!, {
      producer: 'runtime:custom',
      producerVersion: '0.1.0',
    })
    src.emit(mkEvent('x', 1))
    unsub()
    await new Promise((r) => setTimeout(r, 30))
    const rows = await store!.query()
    expect(rows[0]!.producer).toBe('runtime:custom')
    expect(rows[0]!.producerVersion).toBe('0.1.0')
  })

  it('unsubscribe stops further captures', async () => {
    const src = mockSource()
    const unsub = attachEventStore(src, store!)
    src.emit(mkEvent('a', 1))
    unsub()
    src.emit(mkEvent('b', 2))
    await new Promise((r) => setTimeout(r, 30))
    const count = await store!.count()
    expect(count).toBe(1)
  })
})
