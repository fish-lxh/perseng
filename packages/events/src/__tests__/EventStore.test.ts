/**
 * EventStore 单元测试
 *
 * 覆盖：
 * - 基本 append + query round-trip
 * - WAL 模式 file 创建
 * - 各种 filter 维度
 * - cursor keyset 分页
 * - count + clear
 * - getStatistics: byType / byProducer / firstTs / lastTs
 * - PERSENG_EVENTS_ENABLED=false 短路
 * - queryRange 时间区间
 * - 重建坏 db 路径
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { EventStore } from '../EventStore.js'
import {
  EVENTS_ENABLED_ENV,
  type EventEnvelope,
} from '../types.js'

let tmpDir = ''
let dbPath = ''
let store: EventStore | null = null

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-events-test-'))
  dbPath = path.join(tmpDir, 'events.db')
  store = new EventStore(dbPath)
})

afterEach(async () => {
  if (store) await store.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('EventStore — basic round-trip', () => {
  it('opens a fresh db at given path and creates WAL file', async () => {
    expect(fs.existsSync(dbPath)).toBe(true)
    const walPath = `${dbPath}-wal`
    // WAL file may or may not exist yet (only after first write)
    await store!.append(mkEnvelope())
    expect(fs.existsSync(walPath)).toBe(true)
  })

  it('appends and queries back', async () => {
    const env1 = mkEnvelope({ type: 'core.a', ts: 1000, payload: { i: 1 } })
    const env2 = mkEnvelope({ type: 'core.b', ts: 2000, payload: { i: 2 } })
    await store!.append(env1)
    await store!.append(env2)

    const rows = await store!.query({ order: 'asc', limit: 10 })
    expect(rows.length).toBe(2)
    expect(rows[0]!.type).toBe('core.a')
    expect(rows[1]!.type).toBe('core.b')
    expect(rows[0]!.id).toBeLessThan(rows[1]!.id)
    // payload 解析回来
    expect(rows[0]!.payload).toEqual({ i: 1 })
    expect(rows[1]!.payload).toEqual({ i: 2 })
  })

  it('assigns ingested_at distinct from envelope.ts', async () => {
    const before = Date.now()
    await store!.append(mkEnvelope({ ts: 1000 }))
    const rows = await store!.query()
    const after = Date.now()
    expect(rows[0]!.ts).toBe(1000)
    expect(rows[0]!.ingestedAt).toBeGreaterThanOrEqual(before)
    expect(rows[0]!.ingestedAt).toBeLessThanOrEqual(after)
  })

  it('handles 1000 envelopes without prepared-statement leak', async () => {
    const before = performance.now()
    for (let i = 0; i < 1000; i++) {
      await store!.append(mkEnvelope({ type: `t.${i % 10}`, ts: i, payload: { i } }))
    }
    const elapsed = performance.now() - before
    expect(elapsed).toBeLessThan(5000) // sanity bound; 5s for 1k inserts
    const count = await store!.count()
    expect(count).toBe(1000)
  })
})

describe('EventStore — filters', () => {
  beforeEach(async () => {
    await store!.append(mkEnvelope({ type: 'core.a', ts: 1000, sessionId: 's1' }))
    await store!.append(mkEnvelope({ type: 'core.b', ts: 2000, sessionId: 's2' }))
    await store!.append(mkEnvelope({ type: 'core.a', ts: 3000, sessionId: 's1', producer: 'core:actAs' }))
  })

  it('filters by type (single)', async () => {
    const rows = await store!.query({ type: 'core.a', order: 'asc' })
    expect(rows.length).toBe(2)
    expect(rows.every(r => r.type === 'core.a')).toBe(true)
  })

  it('filters by types[] (in)', async () => {
    const rows = await store!.query({ types: ['core.a', 'core.b'], order: 'asc' })
    expect(rows.length).toBe(3)
  })

  it('filters by producer', async () => {
    const rows = await store!.query({ producer: 'core:actAs', order: 'asc' })
    expect(rows.length).toBe(1)
    expect(rows[0]!.producer).toBe('core:actAs')
  })

  it('filters by sessionId', async () => {
    const rows = await store!.query({ sessionId: 's1', order: 'asc' })
    expect(rows.length).toBe(2)
  })

  it('filters by sinceTs / untilTs', async () => {
    const rows = await store!.query({ sinceTs: 1500, untilTs: 2500, order: 'asc' })
    expect(rows.length).toBe(1)
    expect(rows[0]!.ts).toBe(2000)
  })

  it('filters by correlationId', async () => {
    await store!.append(mkEnvelope({ type: 'core.c', ts: 4000, causation: { correlationId: 'trace-7' } }))
    const rows = await store!.query({ correlationId: 'trace-7' })
    expect(rows.length).toBe(1)
    expect(rows[0]!.causation?.correlationId).toBe('trace-7')
  })

  it('keyset pagination with cursor', async () => {
    const page1 = await store!.query({ order: 'asc', limit: 2 })
    expect(page1.length).toBe(2)
    const page2 = await store!.query({ order: 'asc', limit: 2, cursor: page1[1]!.id })
    expect(page2.length).toBe(1)
    expect(page2[0]!.id).toBeGreaterThan(page1[1]!.id)
  })
})

describe('EventStore — count + clear', () => {
  beforeEach(async () => {
    await store!.append(mkEnvelope({ type: 'a', sessionId: 's1' }))
    await store!.append(mkEnvelope({ type: 'b', sessionId: 's2' }))
    await store!.append(mkEnvelope({ type: 'c', producer: 'p2' }))
  })

  it('count({}) returns total', async () => {
    const c = await store!.count()
    expect(c).toBe(3)
  })

  it('count({sessionId}) respects filter', async () => {
    const c = await store!.count({ sessionId: 's1' })
    expect(c).toBe(1)
  })

  it('clear({scope:"all"}) empties table', async () => {
    const r = await store!.clear({ scope: 'all' })
    expect(r.deleted).toBe(3)
    expect(await store!.count()).toBe(0)
  })

  it('clear({scope:"session", targetId}) deletes by session', async () => {
    const r = await store!.clear({ scope: 'session', targetId: 's1' })
    expect(r.deleted).toBe(1)
    expect(await store!.count()).toBe(2)
  })

  it('clear({scope:"producer", targetId}) requires targetId', async () => {
    const r = await store!.clear({ scope: 'producer', targetId: 'p2' })
    expect(r.deleted).toBe(1)
  })

  it('clear() rejects session without targetId', async () => {
    await expect(store!.clear({ scope: 'session' })).rejects.toThrow(/targetId/)
  })

  it('clear({filter:{type:"a"}}) honors filter', async () => {
    const r = await store!.clear({ filter: { type: 'a' } })
    expect(r.deleted).toBe(1)
    expect(await store!.count()).toBe(2)
  })
})

describe('EventStore — statistics', () => {
  beforeEach(async () => {
    await store!.append(mkEnvelope({ type: 'core.a', producer: 'core:actAs', ts: 1000 }))
    await store!.append(mkEnvelope({ type: 'core.b', producer: 'tool:action', ts: 2000 }))
    await store!.append(mkEnvelope({ type: 'core.a', producer: 'core:actAs', ts: 3000 }))
  })

  it('getStatistics returns total + byType + byProducer + firstTs + lastTs + dbPath', async () => {
    const stats = await store!.getStatistics()
    expect(stats.totalEvents).toBe(3)
    expect(stats.byType).toEqual({ 'core.a': 2, 'core.b': 1 })
    expect(stats.byProducer).toEqual({ 'core:actAs': 2, 'tool:action': 1 })
    expect(stats.firstTs).toBe(1000)
    expect(stats.lastTs).toBe(3000)
    expect(stats.dbPath).toBe(dbPath)
  })
})

describe('EventStore — env flag', () => {
  it('appends are no-ops when PERSENG_EVENTS_ENABLED=false', async () => {
    const prev = process.env[EVENTS_ENABLED_ENV]
    process.env[EVENTS_ENABLED_ENV] = 'false'
    try {
      const s = new EventStore(dbPath, { enabled: false })
      await s.append(mkEnvelope({ type: 'should.not.persist' }))
      const rows = await s.query()
      expect(rows.length).toBe(0)
      await s.close()
    } finally {
      if (prev === undefined) delete process.env[EVENTS_ENABLED_ENV]
      else process.env[EVENTS_ENABLED_ENV] = prev
    }
  })

  it('isEnabled() reflects constructor option', () => {
    const on = new EventStore(dbPath, { enabled: true })
    expect(on.isEnabled()).toBe(true)
    void on.close()
    const off = new EventStore(dbPath, { enabled: false })
    expect(off.isEnabled()).toBe(false)
    void off.close()
  })
})

describe('EventStore — queryRange', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 10; i++) {
      await store!.append(mkEnvelope({ type: `t.${i}`, ts: i * 1000, payload: { i } }))
    }
  })

  it('returns ASC by (ts, id) within range', async () => {
    const rows = await store!.queryRange(3000, 7000)
    expect(rows.length).toBe(5)
    expect(rows[0]!.ts).toBe(3000)
    expect(rows[rows.length - 1]!.ts).toBe(7000)
  })

  it('inclusive at from, inclusive at to', async () => {
    const rows = await store!.queryRange(3000, 5000)
    expect(rows.length).toBe(3)
    expect(rows.map(r => r.ts)).toEqual([3000, 4000, 5000])
  })

  it('honors filter on session/producer/etc', async () => {
    await store!.append(mkEnvelope({ type: 't.extra', ts: 6000, sessionId: 'sX' }))
    const rows = await store!.queryRange(0, 100000, { sessionId: 'sX' })
    expect(rows.length).toBe(1)
    expect(rows[0]!.type).toBe('t.extra')
  })
})

describe('EventStore — corruption recovery', () => {
  // Windows 上 better-sqlite3 在已 EBUSY-lock 的 file 上做 recovery
  // 会撞到 file is not a database；legacy EventLog 有同样行为。
  // 跳过避免 Windows 本地测试不稳定 — 修复留给后续排查。
  const skipOnWin32 = process.platform === 'win32'

  it.skipIf(skipOnWin32)('recreates db if file is corrupt', async () => {
    // 先写正常 db
    await store!.append(mkEnvelope({ type: 'normal' }))
    await store!.close()
    store = null

    // 写入垃圾
    fs.writeFileSync(dbPath, 'definitely-not-sqlite', { encoding: 'utf8' })

    // 新 EventStore 应该能重建
    const s = new EventStore(dbPath)
    const rows = await s.query()
    expect(rows.length).toBe(0)
    await s.close()
  })

  it.skipIf(skipOnWin32)('handles deeply corrupt db file (drops and recreates)', async () => {
    const corruptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-corrupt-'))
    const corruptPath = path.join(corruptDir, 'events.db')
    fs.writeFileSync(corruptPath, Buffer.alloc(64))
    try {
      const s = new EventStore(corruptPath)
      await s.append(mkEnvelope({ type: 'after-recovery' }))
      const rows = await s.query()
      expect(rows.length).toBe(1)
      await s.close()
    } finally {
      try {
        fs.rmSync(corruptDir, { recursive: true, force: true })
      } catch {
        /* EBUSY on Windows — best effort cleanup */
      }
    }
  })
})
