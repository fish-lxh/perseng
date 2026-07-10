/**
 * EventBus 单元测试
 *
 * 覆盖：
 * - emit → 所有订阅者拿到
 * - '*' 订阅：捕获所有
 * - unsubscribe idempotent
 * - 同步 handler throw 不影响其他订阅者
 * - emit 同时写入 store（store-side 测试覆盖；这里只验证 bus 调了）
 * - 多订阅者同 type 并发
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { EventStore } from '../EventStore.js'
import { InProcessEventBus } from '../EventBus.js'
import {
  EVENTS_ENABLED_ENV,
  type EventEnvelope,
} from '../types.js'

let tmpDir = ''
let store: EventStore | null = null
let bus: InProcessEventBus | null = null

function mkEnvelope(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    type: 'test.event',
    ts: Date.now(),
    producer: 'test:producer',
    producerVersion: '1.0.0',
    payload: { foo: 'bar' },
    ...over,
  }
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-bus-test-'))
  store = new EventStore(path.join(tmpDir, 'events.db'))
  bus = new InProcessEventBus(store)
})

afterEach(async () => {
  if (store) await store.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('InProcessEventBus — dispatch', () => {
  it('routes type-specific envelope to type-specific subscriber', () => {
    const received: EventEnvelope[] = []
    bus!.subscribe('user.message', (e) => received.push(e))
    bus!.emit(mkEnvelope({ type: 'user.message' }))
    expect(received.length).toBe(1)
    expect(received[0]!.type).toBe('user.message')
  })

  it('routes with wildcard subscriber', () => {
    const received: EventEnvelope[] = []
    bus!.subscribe('*', (e) => received.push(e))
    bus!.emit(mkEnvelope({ type: 'a' }))
    bus!.emit(mkEnvelope({ type: 'b' }))
    bus!.emit(mkEnvelope({ type: 'c' }))
    expect(received.length).toBe(3)
  })

  it('does not deliver to subscribers of other types', () => {
    const received: EventEnvelope[] = []
    bus!.subscribe('user.message', (e) => received.push(e))
    bus!.emit(mkEnvelope({ type: 'assistant.message' }))
    expect(received.length).toBe(0)
  })
})

describe('InProcessEventBus — unsubscribe', () => {
  it('returns unsubscribe closure that idempotently removes handler', () => {
    let count = 0
    const unsub = bus!.subscribe('foo', () => count++)
    bus!.emit(mkEnvelope({ type: 'foo' }))
    bus!.emit(mkEnvelope({ type: 'foo' }))
    expect(count).toBe(2)
    unsub()
    unsub() // idempotent
    bus!.emit(mkEnvelope({ type: 'foo' }))
    expect(count).toBe(2)
  })
})

describe('InProcessEventBus — error containment', () => {
  it('handler errors do not affect sibling subscribers', () => {
    const received: EventEnvelope[] = []
    bus!.subscribe('foo', () => {
      throw new Error('boom')
    })
    bus!.subscribe('foo', (e) => received.push(e))
    // mitt default — handler error 直接冒泡。我们 InProcessEventBus 必须 catch。
    // 先 emit 一个 — 不应当 throw
    expect(() => bus!.emit(mkEnvelope({ type: 'foo' }))).not.toThrow()
    expect(received.length).toBe(1)
  })
})

describe('InProcessEventBus — store routing', () => {
  it('writes each emit into the store (fire-and-forget)', async () => {
    bus!.emit(mkEnvelope({ type: 'core.a', ts: 1 }))
    bus!.emit(mkEnvelope({ type: 'core.b', ts: 2 }))
    // 等 microtask flush
    await new Promise((r) => setTimeout(r, 50))
    const rows = await store!.query({ order: 'asc' })
    expect(rows.length).toBe(2)
    expect(rows[0]!.type).toBe('core.a')
    expect(rows[1]!.type).toBe('core.b')
  })
})

describe('InProcessEventBus — env flag', () => {
  it('drops emit when PERSENG_EVENTS_ENABLED=false', async () => {
    const prev = process.env[EVENTS_ENABLED_ENV]
    process.env[EVENTS_ENABLED_ENV] = 'false'
    try {
      const received: EventEnvelope[] = []
      const local = new InProcessEventBus(store!)
      local.subscribe('*', (e) => received.push(e))
      local.emit(mkEnvelope({ type: 'blocked' }))
      expect(received.length).toBe(0)
      expect(local.getDroppedCount()).toBe(1)
    } finally {
      if (prev === undefined) delete process.env[EVENTS_ENABLED_ENV]
      else process.env[EVENTS_ENABLED_ENV] = prev
    }
  })
})
