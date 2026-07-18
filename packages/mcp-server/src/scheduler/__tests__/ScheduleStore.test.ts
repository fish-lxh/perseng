/**
 * scheduler/__tests__/ScheduleStore.test.ts
 *
 * 模式参考 packages/events/src/__tests__/EventStore.test.ts:
 *   - mkdtempSync 拿 tmp dir，real file path（不用 :memory:，WAL 不支持）
 *   - beforeEach / afterEach 包起来
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ScheduleStore } from '../ScheduleStore.js'
import { getScheduleStoreForTest } from '../instance.js'
import type { NewSchedule } from '../types.js'

let tmpDir = ''
let store: ScheduleStore

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-schedule-test-'))
  store = getScheduleStoreForTest(path.join(tmpDir, 'schedules.db'), { silent: true })
})

afterEach(async () => {
  if (store) await store.close()
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function makeSchedule(overrides: Partial<NewSchedule> = {}): NewSchedule {
  return {
    id: 'sched-1',
    name: 'test schedule',
    description: null,
    cronExpr: '0 9 * * 1-5',
    timezone: 'Asia/Shanghai',
    toolName: 'remember',
    toolArgs: { scope: 'session', content: 'hello' },
    createdBy: 'tester',
    ...overrides,
  }
}

describe('ScheduleStore — create / get / list', () => {
  it('create() stores a schedule and computes next_run_at', () => {
    const created = store.create(makeSchedule())
    expect(created.id).toBe('sched-1')
    expect(created.state).toBe('pending')
    expect(created.failCount).toBe(0)
    expect(created.toolArgs).toEqual({ scope: 'session', content: 'hello' })
    expect(typeof created.nextRunAt).toBe('number')
    expect((created.nextRunAt as number) > Date.now()).toBe(true)
  })

  it('get() returns null for unknown id', () => {
    expect(store.get('nope')).toBeNull()
  })

  it('list() returns non-deleted schedules by default', () => {
    store.create(makeSchedule({ id: 'a' }))
    store.create(makeSchedule({ id: 'b' }))
    store.create(makeSchedule({ id: 'c' }))
    store.delete('b')
    const all = store.list()
    expect(all.map((s) => s.id).sort()).toEqual(['a', 'c'])
  })

  it('list() supports state filter', () => {
    store.create(makeSchedule({ id: 'a' }))
    store.create(makeSchedule({ id: 'b' }))
    store.setState('b', 'active')
    const active = store.list({ state: 'active' })
    expect(active.map((s) => s.id)).toEqual(['b'])
  })

  it('list() supports toolName filter', () => {
    store.create(makeSchedule({ id: 'a', toolName: 'remember' }))
    store.create(makeSchedule({ id: 'b', toolName: 'action' }))
    const filtered = store.list({ toolName: 'remember' })
    expect(filtered.map((s) => s.id)).toEqual(['a'])
  })
})

describe('ScheduleStore — state + claimDue', () => {
  it('setState() transitions state and updates updated_at', async () => {
    store.create(makeSchedule())
    const before = store.get('sched-1')!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    expect(store.setState('sched-1', 'active')).toBe(true)
    const after = store.get('sched-1')!
    expect(after.state).toBe('active')
    expect(after.updatedAt).toBeGreaterThan(before)
  })

  it('claimDue() returns true once and false the second time (互斥)', () => {
    store.create(makeSchedule())
    store.setState('sched-1', 'active')
    expect(store.claimDue('sched-1', Date.now())).toBe(true)
    // 已经 claim 过（next_run_at 被清），再次 claim 不动
    expect(store.claimDue('sched-1', Date.now())).toBe(false)
  })

  it('claimDue() returns false for non-active schedule', () => {
    store.create(makeSchedule())
    // 还在 pending
    expect(store.claimDue('sched-1', Date.now())).toBe(false)
  })

  it('delete() is soft (state=deleted) and list() 默认隐藏', () => {
    store.create(makeSchedule())
    expect(store.delete('sched-1')).toBe(true)
    expect(store.get('sched-1')!.state).toBe('deleted')
    expect(store.list().find((s) => s.id === 'sched-1')).toBeUndefined()
  })
})

describe('ScheduleStore — runs', () => {
  beforeEach(() => {
    store.create(makeSchedule())
    store.setState('sched-1', 'active')
  })

  it('recordRunStart() writes a running row and returns id', () => {
    const runId = store.recordRunStart('sched-1', Date.now(), 1)
    expect(typeof runId).toBe('number')
    expect(runId).toBeGreaterThan(0)
  })

  it('recordRunEnd() updates the row', () => {
    const runId = store.recordRunStart('sched-1', Date.now())
    store.recordRunEnd(runId, 'success', null, '{"ok":true}', 123)
    const runs = store.listRuns({ scheduleId: 'sched-1' })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].durationMs).toBe(123)
    expect(runs[0].output).toBe('{"ok":true}')
  })

  it('recordRunEnd() captures error', () => {
    const runId = store.recordRunStart('sched-1', Date.now())
    store.recordRunEnd(runId, 'failed', 'tool not found', null, 50)
    const runs = store.listRuns({ scheduleId: 'sched-1' })
    expect(runs[0].status).toBe('failed')
    expect(runs[0].error).toBe('tool not found')
  })

  it('recordOutcome() updates last_* and fail_count', () => {
    store.recordOutcome('sched-1', {
      status: 'failed',
      error: 'timeout',
      failCount: 1,
      nextRunAt: Date.now() + 60_000,
    })
    const s = store.get('sched-1')!
    expect(s.lastStatus).toBe('failed')
    expect(s.lastError).toBe('timeout')
    expect(s.failCount).toBe(1)
    expect(s.nextRunAt).toBeGreaterThan(Date.now())
  })
})

describe('ScheduleStore — update()', () => {
  it('patches fields and recomputes next_run_at if cron changed', () => {
    store.create(makeSchedule())
    const originalNext = store.get('sched-1')!.nextRunAt
    const updated = store.update('sched-1', {
      cronExpr: '*/15 * * * *',
      name: 'renamed',
    })
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('renamed')
    expect(updated!.cronExpr).toBe('*/15 * * * *')
    expect(updated!.nextRunAt).not.toBe(originalNext)
  })

  it('returns null for unknown id', () => {
    expect(store.update('nope', { name: 'x' })).toBeNull()
  })
})

describe('ScheduleStore — corrupt-recovery', () => {
  it('recovers from a corrupt db file (delete + recreate)', () => {
    // 写一个非 sqlite 的文件
    const dbPath = path.join(tmpDir, 'schedules.db')
    fs.writeFileSync(dbPath, 'this is not a sqlite database file')
    // 重新构造 — should delete and recreate
    const recovered = new ScheduleStore(dbPath, { silent: true })
    const s = recovered.create(makeSchedule({ id: 'after-recover' }))
    expect(s.id).toBe('after-recover')
  })
})
