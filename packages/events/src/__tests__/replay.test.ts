/**
 * Replay 测试 — 基本 fold 语义
 *
 * - 单事件 fold
 * - 多事件 fold（顺序敏感）
 * - mid-range（from/to 子集）
 * - empty-range（无匹配）
 * - session-scoped（filter.sessionId）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { EventStore } from '../EventStore.js'
import { replay } from '../replay.js'
import type { EventEnvelope } from '../types.js'
import identityProjection from './fixtures/projection.identity.js'

let tmpDir = ''
let store: EventStore

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-replay-'))
  store = new EventStore(path.join(tmpDir, 'events.db'))
})

afterEach(async () => {
  store.close()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
})

function mkEnv(type: string, payload: unknown, sessionId: string | null = null): EventEnvelope<unknown> {
  return {
    type,
    ts: Date.now(),
    role: 'system',
    producer: 'test:fixture',
    producerVersion: '1.0.0',
    schemaVersion: 1,
    sessionId,
    agentId: null,
    payload,
  }
}

describe('replay()', () => {
  it('returns initial state when no events exist', async () => {
    const state = await replay(store, { projection: identityProjection })
    expect(state.roles.size).toBe(0)
    expect(state.activations.length).toBe(0)
  })

  it('folds a single core.role.activated event', async () => {
    await store.append(mkEnv('core.role.activated', { roleId: 'nuwa' }, 'sess-1'))
    const state = await replay(store, { projection: identityProjection })
    expect(state.roles.has('nuwa')).toBe(true)
    expect(state.activations.length).toBe(1)
  })

  it('folds multiple events in (ts ASC, id ASC) order', async () => {
    // 显式按 ts 排序：nuwa @ 100, sean @ 200, luban @ 300
    const baseTs = 1_700_000_000_000
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'sean' }, 's1'), ts: baseTs + 200 })
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'nuwa' }, 's1'), ts: baseTs + 100 })
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'luban' }, 's1'), ts: baseTs + 300 })

    const state = await replay(store, { projection: identityProjection })
    expect(state.roles.size).toBe(3)
    // activations 必须按 (ts ASC) 顺序
    expect(state.activations.map((a) => a.id)).toEqual(['nuwa', 'sean', 'luban'])
  })

  it('honors from / to range bounds (inclusive)', async () => {
    const baseTs = 1_700_000_000_000
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'nuwa' }, 's1'), ts: baseTs + 100 })
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'sean' }, 's1'), ts: baseTs + 200 })
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'luban' }, 's1'), ts: baseTs + 300 })

    // 中段 [baseTs+150, baseTs+250]
    const state = await replay(store, {
      projection: identityProjection,
      from: baseTs + 150,
      to: baseTs + 250,
    })
    expect(state.roles.size).toBe(1)
    expect(state.roles.has('sean')).toBe(true)
    expect(state.activations.length).toBe(1)
  })

  it('returns initial when range matches no events', async () => {
    const baseTs = 1_700_000_000_000
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'nuwa' }, 's1'), ts: baseTs + 100 })

    const state = await replay(store, {
      projection: identityProjection,
      from: baseTs + 500,
      to: baseTs + 999,
    })
    expect(state.roles.size).toBe(0)
  })

  it('filters by sessionId when filter.sessionId is set', async () => {
    await store.append(mkEnv('core.role.activated', { roleId: 'nuwa' }, 'sess-A'))
    await store.append(mkEnv('core.role.activated', { roleId: 'sean' }, 'sess-B'))
    await store.append(mkEnv('core.role.activated', { roleId: 'luban' }, 'sess-A'))

    const stateA = await replay(store, {
      projection: identityProjection,
      filter: { sessionId: 'sess-A' },
    })
    expect(stateA.roles.has('nuwa')).toBe(true)
    expect(stateA.roles.has('luban')).toBe(true)
    expect(stateA.roles.has('sean')).toBe(false)
    expect(stateA.activations.length).toBe(2)
  })

  it('ignores events of unrelated types', async () => {
    await store.append(mkEnv('core.role.activated', { roleId: 'nuwa' }, 's1'))
    await store.append(mkEnv('action.activate', { foo: 'bar' }, 's1'))
    await store.append(mkEnv('lifecycle.plan', { task: 'X' }, 's1'))

    const state = await replay(store, { projection: identityProjection })
    expect(state.roles.size).toBe(1)
    expect(state.activations.length).toBe(1)
  })

  it('respects from="epoch" sentinel (== 0)', async () => {
    const baseTs = 1_700_000_000_000
    await store.append({ ...mkEnv('core.role.activated', { roleId: 'nuwa' }, 's1'), ts: baseTs })

    const state = await replay(store, { projection: identityProjection, from: 'epoch' })
    expect(state.roles.has('nuwa')).toBe(true)
  })
})