/**
 * Replay determinism test — **THE key test** for M2.
 *
 * Invariants:
 * - I-Det-1: 100 次 replay 同一序列 → 状态 hash 必须全部相等（byte-identical）
 * - I-Det-2: 100 次 projection.reduce(initial, event) 链式调用 → 状态 hash 必须全部相等
 * - I-Det-3: 不依赖 Date.now() / Math.random() — hash 在毫秒间隔内依然稳定
 *
 * 失败 = projection 不纯 / store 排序不稳 / replay 有非确定性副作用。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

import { EventStore } from '../EventStore.js'
import { replay } from '../replay.js'
import type { EventEnvelope } from '../types.js'
import identityProjection, { type IdentityState } from './fixtures/projection.identity.js'

let tmpDir = ''
let store: EventStore

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-replay-det-'))
  store = new EventStore(path.join(tmpDir, 'events.db'))
})

afterEach(async () => {
  store.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
})

/**
 * Seed N envelopes in deterministic order.
 * - 70% core.role.activated (主路径)
 * - 20% action.activate (无关，验证不污染 state)
 * - 10% lifecycle.plan (无关)
 *
 * ts 单调递增；sessionId 在 5 个会话间轮转。
 */
async function seedStore(n: number): Promise<void> {
  const baseTs = 1_700_000_000_000
  const roles = ['nuwa', 'sean', 'luban', 'jingwei', 'fuxi', 'nvwa', 'kuafu']
  const sessions = ['s1', 's2', 's3', 's4', 's5']
  for (let i = 0; i < n; i++) {
    const ts = baseTs + i * 7 // 固定间隔 7ms → 严格 ts ASC
    const sessionId = sessions[i % sessions.length] ?? 's1'
    const r = i % 10
    let env: EventEnvelope<unknown>
    if (r < 7) {
      const roleId = roles[i % roles.length] ?? 'nuwa'
      env = {
        type: 'core.role.activated',
        ts,
        role: 'system',
        producer: 'test:fixture',
        producerVersion: '1.0.0',
        schemaVersion: 1,
        sessionId,
        agentId: null,
        payload: { roleId, idx: i },
      }
    } else if (r < 9) {
      env = {
        type: 'action.activate',
        ts,
        role: 'system',
        producer: 'test:fixture',
        producerVersion: '1.0.0',
        schemaVersion: 1,
        sessionId,
        agentId: null,
        payload: { action: 'foo', idx: i },
      }
    } else {
      env = {
        type: 'lifecycle.plan',
        ts,
        role: 'system',
        producer: 'test:fixture',
        producerVersion: '1.0.0',
        schemaVersion: 1,
        sessionId,
        agentId: null,
        payload: { task: `task-${i}` },
      }
    }
    await store.append(env)
  }
}

/**
 * 把 IdentityState 序列化到一个稳定字符串。
 * Set 必须按某种顺序遍历 — 这里用 Array.from + sort 来保证确定性。
 */
function serializeIdentity(state: IdentityState): string {
  const roles = Array.from(state.roles).sort()
  const activations = state.activations.map((a) => `${a.ts}:${a.id}:${a.sessionId ?? ''}`)
  return JSON.stringify({ roles, activations })
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

describe('replay determinism', () => {
  it('100x replay of 500 seeded events yields identical hash', async () => {
    await seedStore(500)

    const hashes = new Set<string>()
    const firstState: IdentityState = await replay(store, { projection: identityProjection })
    hashes.add(sha256(serializeIdentity(firstState)))

    for (let i = 0; i < 99; i++) {
      const state = await replay(store, { projection: identityProjection })
      hashes.add(sha256(serializeIdentity(state)))
    }

    expect(hashes.size).toBe(1)
  }, 30_000)

  it('100x reduce-only fold yields identical hash (no store I/O)', async () => {
    await seedStore(500)

    // 一次性从 store 抓所有 row，在内存里 fold 100 次
    const rows = await store.queryRange(0, Number.MAX_SAFE_INTEGER, {})

    const hashes = new Set<string>()
    let state: IdentityState = identityProjection.initial
    for (const row of rows) {
      state = identityProjection.reduce(state, row)
    }
    hashes.add(sha256(serializeIdentity(state)))

    for (let i = 0; i < 99; i++) {
      let s: IdentityState = identityProjection.initial
      for (const row of rows) {
        s = identityProjection.reduce(s, row)
      }
      hashes.add(sha256(serializeIdentity(s)))
    }

    expect(hashes.size).toBe(1)
  }, 30_000)

  it('replay is independent of wall-clock time between calls', async () => {
    await seedStore(200)

    const h1 = sha256(serializeIdentity(await replay(store, { projection: identityProjection })))
    // 跨多个 ms — 如果 projection 误用了 Date.now()，这里会漂移
    await new Promise((r) => setTimeout(r, 25))
    const h2 = sha256(serializeIdentity(await replay(store, { projection: identityProjection })))

    expect(h1).toBe(h2)
  })

  it('replay is order-stable when rows have identical ts (tiebreak by id ASC)', async () => {
    const baseTs = 1_700_000_000_000
    // 5 个事件共享同一 ts — store 必须用 id ASC 做 tiebreak
    for (let i = 0; i < 5; i++) {
      await store.append({
        ...{
          type: 'core.role.activated',
          role: 'system',
          producer: 'test:fixture',
          producerVersion: '1.0.0',
          schemaVersion: 1,
          sessionId: 's1',
          agentId: null,
          payload: { roleId: `r${i}` },
        },
        ts: baseTs,
      })
    }

    // 不同顺序插入 → queryRange 必须始终返回相同 (ts, id ASC) 序列
    const rows1 = await store.queryRange(0, Number.MAX_SAFE_INTEGER, {})
    const rows2 = await store.queryRange(0, Number.MAX_SAFE_INTEGER, {})
    expect(rows1.map((r) => r.id)).toEqual(rows2.map((r) => r.id))

    const state = await replay(store, { projection: identityProjection })
    expect(state.activations.length).toBe(5)
    // roleId 顺序应严格按 id ASC
    expect(state.activations.map((a) => a.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4'])
  })
})