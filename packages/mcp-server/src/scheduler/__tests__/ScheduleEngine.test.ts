/**
 * scheduler/__tests__/ScheduleEngine.test.ts (Phase 1 / Commit 4 + Phase 3 / Commit 7)
 *
 * KNUTH-FEAT 2026-07-18:
 *   Phase 1 — 引擎基础
 *   Phase 3 / Commit 7 — 重试机制 + dry_run validation
 *
 * 覆盖：
 *  - applyTemplate: ${now.date} / ${now.time} / ${now.weekday} / ${schedule.id} /
 *    ${schedule.name} / ${run.attempt}（含嵌套对象、数组）
 *  - tzFormatter: Asia/Shanghai vs UTC 的 date / time 偏移
 *  - runScheduleNow: 同步触发，原子 claim，写 schedule_runs，调用 target tool，
 *    模板替换，事件 emit
 *  - 失败路径：target tool 抛错 → status=failed，fail_count++
 *  - L2 自动 pause：连续 3 次失败 → state=paused + 移除 croner job + emit schedule.paused
 *  - 1 秒级 cron：start() → 等 2.5s → 至少 1 条 runs（success）
 *  - stop()：停 croner 后不再触发
 *  - upsertJob / removeJob：管理 API（用于工具层 create/resume/pause/delete）
 *  - Phase 3:
 *    - 重试：失败 N 次后成功 → emit retried + schedule_runs 完整记录
 *    - 重试：全部失败 → fail_count +=1 + L2 pause + emit failed
 *    - backoff 时间戳正确性
 *    - dry_run: 校验通过 / 失败（invalid cron / tool not found / invalid timezone）
 *    - retry_now / manual_retry 触发器
 *
 * 每个测试 new 一个 ScheduleEngine（DI 模式，避免 Vitest timer leak）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ScheduleEngine, applyTemplate, tzFormatter } from '../ScheduleEngine.js'
import { ScheduleStore } from '../ScheduleStore.js'
import { L2_AUTO_PAUSE_FAIL_COUNT, type Schedule } from '../types.js'
import type { ToolEventBus } from '../../interfaces/MCPServer.js'
import { MapToolRegistry, type ToolRegistration } from '../../registry/ToolRegistry.js'

// ============================================================================
// helpers
// ============================================================================

function captureBus() {
  const captured: Array<Record<string, unknown>> = []
  const bus: ToolEventBus = {
    emit(env: Record<string, unknown>) {
      captured.push(env)
    },
  }
  return { bus, captured }
}

/**
 * 构造一个最小 MapToolRegistry，里面有一个 target tool（用 stubHandler 控制行为）。
 */
function makeRegistryWithTool(
  toolName: string,
  stubHandler: ReturnType<typeof vi.fn>,
): { registry: MapToolRegistry; lastArgs: { value: unknown } } {
  const lastArgs = { value: undefined as unknown }
  const stub = stubHandler as unknown as (args: unknown) => Promise<unknown>
  const reg: ToolRegistration = {
    manifest: {
      name: toolName,
      version: '1.0.0',
      capabilities: [`${toolName}:run`],
      dependencies: [],
      schemaVersion: 1,
      inputSchema: { type: 'object' },
    },
    handler: stub as unknown as ToolRegistration['handler'],
  }
  // Wrap to capture lastArgs before delegating
  const wrapped: ToolRegistration = {
    ...reg,
    handler: (async (args: unknown) => {
      lastArgs.value = args
      return await stub(args)
    }) as unknown as ToolRegistration['handler'],
  }
  const registry = new MapToolRegistry()
  registry.register(wrapped)
  return { registry, lastArgs }
}

let tmpDir = ''
let store: ScheduleStore
let engine: ScheduleEngine
let stubHandler: ReturnType<typeof vi.fn>
let registry: MapToolRegistry
let lastArgs: { value: unknown }
let bus: ToolEventBus
let captured: Array<Record<string, unknown>>

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-engine-test-'))
  store = new ScheduleStore(path.join(tmpDir, 'schedules.db'), { silent: true })
  stubHandler = vi.fn(async () => ({
    content: [{ type: 'text', text: 'tool success' }],
  }))
  const r = makeRegistryWithTool('remember', stubHandler)
  registry = r.registry
  lastArgs = r.lastArgs
  const b = captureBus()
  bus = b.bus
  captured = b.captured
  engine = new ScheduleEngine({ store, registry, bus })
})

afterEach(async () => {
  engine.stop()
  await store.close()
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return store.create({
    id: 's1',
    name: 'test',
    description: null,
    cronExpr: '0 9 * * 1-5',
    timezone: 'Asia/Shanghai',
    toolName: 'remember',
    toolArgs: { content: 'hi' },
    createdBy: 'test',
    ...overrides,
  })
}

// ============================================================================
// applyTemplate
// ============================================================================

describe('applyTemplate', () => {
  it('replaces ${now.date} 按 schedule.timezone', () => {
    const sched = makeSchedule({ timezone: 'Asia/Shanghai' })
    // 2026-07-18 12:00 UTC = 2026-07-18 20:00 CST
    const now = new Date('2026-07-18T12:00:00Z')
    const out = applyTemplate({ date: '${now.date}' }, { schedule: sched, attempt: 1, now })
    expect(out['date']).toBe('2026-07-18')
  })

  it('replaces ${now.time} 按 schedule.timezone（24h）', () => {
    const sched = makeSchedule({ timezone: 'Asia/Shanghai' })
    const now = new Date('2026-07-18T12:34:56Z')
    const out = applyTemplate({ t: '${now.time}' }, { schedule: sched, attempt: 1, now })
    // 12:34:56 UTC = 20:34:56 CST
    expect(out['t']).toBe('20:34:56')
  })

  it('replaces ${now.weekday} 按 schedule.timezone', () => {
    const sched = makeSchedule({ timezone: 'Asia/Shanghai' })
    // 2026-07-17 是 Friday UTC；2026-07-18 00:00 CST 还是 Saturday
    const now = new Date('2026-07-17T20:00:00Z') // 2026-07-18 04:00 CST
    const out = applyTemplate({ w: '${now.weekday}' }, { schedule: sched, attempt: 1, now })
    expect(out['w']).toBe('Saturday')
  })

  it('replaces ${schedule.id} 和 ${schedule.name}', () => {
    const sched = makeSchedule({ id: 'abc-123', name: 'morning-prep' })
    const now = new Date('2026-07-18T00:00:00Z')
    const out = applyTemplate(
      { id: '${schedule.id}', name: '${schedule.name}' },
      { schedule: sched, attempt: 1, now },
    )
    expect(out['id']).toBe('abc-123')
    expect(out['name']).toBe('morning-prep')
  })

  it('replaces ${run.attempt}', () => {
    const sched = makeSchedule()
    const now = new Date('2026-07-18T00:00:00Z')
    const out = applyTemplate({ a: '${run.attempt}' }, { schedule: sched, attempt: 3, now })
    expect(out['a']).toBe('3')
  })

  it('递归替换嵌套对象 + 数组里的字符串', () => {
    const sched = makeSchedule({ id: 'nested-1', name: 'nested' })
    const now = new Date('2026-07-18T00:00:00Z')
    const out = applyTemplate(
      {
        outer: {
          inner: 'id=${schedule.id}',
          list: ['${schedule.name}', 'static'],
        },
      },
      { schedule: sched, attempt: 1, now },
    )
    const outer = out['outer'] as { inner: string; list: string[] }
    expect(outer.inner).toBe('id=nested-1')
    expect(outer.list).toEqual(['nested', 'static'])
  })

  it('非字符串值原样保留（数字 / 布尔 / null）', () => {
    const sched = makeSchedule()
    const now = new Date('2026-07-18T00:00:00Z')
    const out = applyTemplate(
      { n: 42, b: true, no: null },
      { schedule: sched, attempt: 1, now },
    )
    expect(out['n']).toBe(42)
    expect(out['b']).toBe(true)
    expect(out['no']).toBeNull()
  })
})

// ============================================================================
// tzFormatter
// ============================================================================

describe('tzFormatter', () => {
  it('Asia/Shanghai date 比 UTC 多 8 小时附近', () => {
    const fmt = tzFormatter('Asia/Shanghai')
    const utcFmt = tzFormatter('UTC')
    // 2026-07-18 16:00 UTC = 2026-07-19 00:00 CST (date 不同)
    const now = new Date('2026-07-18T16:00:00Z')
    expect(utcFmt.date(now)).toBe('2026-07-18')
    expect(fmt.date(now)).toBe('2026-07-19')
  })

  it('Asia/Shanghai time 比 UTC 多 8 小时', () => {
    const fmt = tzFormatter('Asia/Shanghai')
    const now = new Date('2026-07-18T12:00:00Z')
    expect(fmt.time(now)).toBe('20:00:00')
  })
})

// ============================================================================
// runScheduleNow — 同步触发
// ============================================================================

describe('runScheduleNow — 同步触发', () => {
  it('成功执行 → 写 schedule_runs + 调用 target tool + emit schedule.succeeded', async () => {
    makeSchedule({ id: 'run-1' })
    store.setState('run-1', 'active')
    const result = await engine.runScheduleNow('run-1')
    expect('skipped' in result).toBe(false)
    if ('skipped' in result) return
    expect(result.status).toBe('success')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(stubHandler).toHaveBeenCalledOnce()
    // runs 表
    const runs = store.listRuns({ scheduleId: 'run-1' })
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('success')
    expect(runs[0].output).toMatch(/tool success/)
    // events
    const types = captured.map((e) => e['type'])
    expect(types).toContain('schedule.triggered')
    expect(types).toContain('schedule.succeeded')
  })

  it('模板替换传给 target tool：toolArgs 含 ${today.date}', async () => {
    makeSchedule({
      id: 'tpl-1',
      toolArgs: { content: 'today=${today.date}', sid: '${schedule.id}' },
    })
    store.setState('tpl-1', 'active')
    await engine.runScheduleNow('tpl-1')
    expect(lastArgs.value).toMatchObject({
      content: expect.stringMatching(/^today=\d{4}-\d{2}-\d{2}$/),
      sid: 'tpl-1',
    })
  })

  it('不存在 id → skipped', async () => {
    const result = await engine.runScheduleNow('nope')
    expect('skipped' in result).toBe(true)
  })

  it('非 active 状态 → skipped', async () => {
    makeSchedule({ id: 'paused-1' })
    store.setState('paused-1', 'paused')
    const result = await engine.runScheduleNow('paused-1')
    expect('skipped' in result).toBe(true)
  })

  it('target tool 抛错 → status=failed + emit schedule.failed', async () => {
    stubHandler.mockRejectedValueOnce(new Error('tool exploded'))
    makeSchedule({ id: 'fail-1' })
    store.setState('fail-1', 'active')
    const result = await engine.runScheduleNow('fail-1')
    if ('skipped' in result) throw new Error('expected executed')
    expect(result.status).toBe('failed')
    const runs = store.listRuns({ scheduleId: 'fail-1' })
    expect(runs[0].status).toBe('failed')
    expect(runs[0].error).toBe('tool exploded')
    const after = store.get('fail-1')!
    expect(after.failCount).toBe(1)
    expect(after.lastStatus).toBe('failed')
    expect(captured.some((e) => e['type'] === 'schedule.failed')).toBe(true)
  })

  it('target tool 在 registry 里找不到 → status=failed（不抛）', async () => {
    makeSchedule({ id: 'missing-tool', toolName: 'no-such-tool' })
    store.setState('missing-tool', 'active')
    const result = await engine.runScheduleNow('missing-tool')
    if ('skipped' in result) throw new Error('expected executed')
    expect(result.status).toBe('failed')
    expect(store.get('missing-tool')!.failCount).toBe(1)
  })
})

// ============================================================================
// L2 自动 pause
// ============================================================================

describe('L2 自动 pause', () => {
  it(`累计 ${L2_AUTO_PAUSE_FAIL_COUNT} 次失败 → state=paused + emit schedule.paused`, async () => {
    stubHandler.mockRejectedValue(new Error('always fail'))
    makeSchedule({ id: 'l2-1' })
    store.setState('l2-1', 'active')

    for (let i = 0; i < L2_AUTO_PAUSE_FAIL_COUNT; i++) {
      const result = await engine.runScheduleNow('l2-1')
      // claimDue 会把 next_run_at 清掉，但 recordOutcome 会重算 — 没问题
      expect('skipped' in result).toBe(false)
    }

    const after = store.get('l2-1')!
    expect(after.state).toBe('paused')
    expect(after.failCount).toBe(L2_AUTO_PAUSE_FAIL_COUNT)
    const pauseEvent = captured.find((e) => e['type'] === 'schedule.paused')
    expect(pauseEvent).toBeDefined()
    expect((pauseEvent!.payload as Record<string, unknown>)['reason']).toBe('auto')
  })

  it('失败 → 成功后 fail_count 重置为 0', async () => {
    // 第一次失败
    stubHandler.mockRejectedValueOnce(new Error('fail once'))
    makeSchedule({ id: 'reset-1' })
    store.setState('reset-1', 'active')
    await engine.runScheduleNow('reset-1')
    expect(store.get('reset-1')!.failCount).toBe(1)

    // 第二次成功 → 重置
    stubHandler.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
    })
    await engine.runScheduleNow('reset-1')
    expect(store.get('reset-1')!.failCount).toBe(0)
  })
})

// ============================================================================
// tick — DB 扫描
// ============================================================================

describe('tick', () => {
  it('只触发到期（next_run_at <= now）的；跳过未到期的', async () => {
    // a: next_run_at 设成过去 → 应被触发
    makeSchedule({ id: 'due-1' })
    store.setState('due-1', 'active')
    store.recordOutcome('due-1', {
      status: 'success',
      error: null,
      failCount: 0,
      nextRunAt: Date.now() - 10_000, // 10s 前
    })

    // b: next_run_at 还在未来 → 不触发
    makeSchedule({ id: 'future-1' })
    store.setState('future-1', 'active')
    store.recordOutcome('future-1', {
      status: 'success',
      error: null,
      failCount: 0,
      nextRunAt: Date.now() + 60 * 60_000, // 1h 后
    })

    await engine.tick()
    const dueRuns = store.listRuns({ scheduleId: 'due-1' })
    const futureRuns = store.listRuns({ scheduleId: 'future-1' })
    expect(dueRuns).toHaveLength(1)
    expect(futureRuns).toHaveLength(0)
  })
})

// ============================================================================
// 1 秒级 cron（croner 真实触发）
// ============================================================================

describe('engine.start() — croner 真实触发', () => {
  it('start() → 等 2.5s → 至少 1 条 runs (success)', async () => {
    // 用 6 字段 cron（含秒）：每秒钟
    makeSchedule({
      id: 'every-sec',
      cronExpr: '*/1 * * * * *',
      toolName: 'remember',
      toolArgs: { content: 'tick' },
    })
    store.setState('every-sec', 'active')

    engine.start()
    // croner 1 秒分辨率；留 2.5s buffer
    await new Promise((r) => setTimeout(r, 2500))
    engine.stop()

    const runs = store.listRuns({ scheduleId: 'every-sec' })
    expect(runs.length).toBeGreaterThanOrEqual(1)
    expect(runs[0].status).toBe('success')
  }, 8000)

  it('start() 后立即 stop() → 后续不再触发', async () => {
    makeSchedule({
      id: 'stop-1',
      cronExpr: '*/1 * * * * *',
      toolName: 'remember',
      toolArgs: {},
    })
    store.setState('stop-1', 'active')

    engine.start()
    engine.stop()
    // 停后等 2s — 确认没有新 runs
    await new Promise((r) => setTimeout(r, 2000))
    const runs = store.listRuns({ scheduleId: 'stop-1' })
    expect(runs).toHaveLength(0)
  }, 6000)

  it('upsertJob 给运行中的 engine 添加新 schedule → croner 接管', async () => {
    // 先 start
    engine.start()

    // 中途创建并 active — 必须先 active，upsertJob 才会建 cron job
    const s = makeSchedule({
      id: 'late-add',
      cronExpr: '*/1 * * * * *',
      toolName: 'remember',
      toolArgs: {},
    })
    store.setState('late-add', 'active')
    engine.upsertJob(store.get('late-add')!)

    await new Promise((r) => setTimeout(r, 2500))
    engine.stop()
    const runs = store.listRuns({ scheduleId: 'late-add' })
    expect(runs.length).toBeGreaterThanOrEqual(1)
  }, 6000)

  it('removeJob → 该 schedule 不再被 croner 触发', async () => {
    const s = makeSchedule({
      id: 'remove-me',
      cronExpr: '*/1 * * * * *',
      toolName: 'remember',
      toolArgs: {},
    })
    store.setState('remove-me', 'active')
    engine.start()
    engine.removeJob('remove-me')

    await new Promise((r) => setTimeout(r, 2200))
    engine.stop()
    const runs = store.listRuns({ scheduleId: 'remove-me' })
    expect(runs).toHaveLength(0)
  }, 6000)
})

// ============================================================================
// 事件 emit 完整性
// ============================================================================

describe('事件 emit — producer=scheduler:engine', () => {
  it('成功路径 emit triggered + succeeded（producer=scheduler:engine）', async () => {
    makeSchedule({ id: 'emit-ok' })
    store.setState('emit-ok', 'active')
    await engine.runScheduleNow('emit-ok')
    const triggered = captured.find((e) => e['type'] === 'schedule.triggered')
    const succeeded = captured.find((e) => e['type'] === 'schedule.succeeded')
    expect(triggered).toBeDefined()
    expect(succeeded).toBeDefined()
    expect(triggered!['producer']).toBe('scheduler:engine')
    expect((triggered!.payload as Record<string, unknown>)['schedule_id']).toBe('emit-ok')
    expect((succeeded!.payload as Record<string, unknown>)['schedule_id']).toBe('emit-ok')
  })

  it('bus=null 时不抛错', async () => {
    const noBusEngine = new ScheduleEngine({ store, registry, bus: null })
    makeSchedule({ id: 'no-bus' })
    store.setState('no-bus', 'active')
    const result = await noBusEngine.runScheduleNow('no-bus')
    expect('skipped' in result).toBe(false)
    noBusEngine.stop()
  })
})

// ============================================================================
// KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): 重试机制
// ============================================================================

describe('重试机制 — maxRetries + backoff', () => {
  it('attempt 1 失败 → attempt 2 成功 → 写 2 条 schedule_runs + emit schedule.retried + schedule.succeeded', async () => {
    makeSchedule({ id: 'retry-then-ok', maxRetries: 2 })
    store.setState('retry-then-ok', 'active')

    // 第一次失败，第二次成功
    let call = 0
    stubHandler.mockImplementation(async () => {
      call++
      if (call === 1) throw new Error('first attempt fails')
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    const result = await engine.runScheduleNow('retry-then-ok')
    expect('skipped' in result).toBe(false)
    if ('skipped' in result) return
    expect(result.status).toBe('success')

    // schedule_runs 应有 2 条
    const runs = store.listRuns({ scheduleId: 'retry-then-ok' })
    expect(runs).toHaveLength(2)
    expect(runs[0]!.attempt).toBe(2)
    expect(runs[0]!.status).toBe('success')
    expect(runs[1]!.attempt).toBe(1)
    expect(runs[1]!.status).toBe('failed')
    expect(runs[1]!.error).toContain('first attempt fails')

    // 事件：retried + succeeded
    const retried = captured.find((e) => e['type'] === 'schedule.retried')
    const succeeded = captured.find((e) => e['type'] === 'schedule.succeeded')
    expect(retried).toBeDefined()
    expect(succeeded).toBeDefined()
    const retriedPayload = retried!['payload'] as Record<string, unknown>
    expect(retriedPayload['attempt']).toBe(1)
    expect(typeof retriedPayload['next_attempt_at']).toBe('number')
    expect(retriedPayload['backoff_seconds']).toBe(30) // backoff[0] = 30s

    // fail_count 应为 0（最终成功）
    const sched = store.get('retry-then-ok')
    expect(sched?.failCount).toBe(0)
  })

  it('全部失败 → fail_count +=1（单次 runScheduleNow）+ emit schedule.failed', async () => {
    makeSchedule({ id: 'retry-all-fail', maxRetries: 2 })
    store.setState('retry-all-fail', 'active')
    stubHandler.mockRejectedValue(new Error('always fail'))

    const result = await engine.runScheduleNow('retry-all-fail')
    expect('skipped' in result).toBe(false)
    if ('skipped' in result) return
    expect(result.status).toBe('failed')

    // 3 条 schedule_runs（maxAttempts = 3）
    const runs = store.listRuns({ scheduleId: 'retry-all-fail' })
    expect(runs).toHaveLength(3)

    // 事件：triggered × 3 + retried × 2 + failed × 1
    const triggeredEvents = captured.filter((e) => e['type'] === 'schedule.triggered')
    const retriedEvents = captured.filter((e) => e['type'] === 'schedule.retried')
    const failedEvents = captured.filter((e) => e['type'] === 'schedule.failed')
    expect(triggeredEvents).toHaveLength(3)
    expect(retriedEvents).toHaveLength(2)
    expect(failedEvents).toHaveLength(1)

    // fail_count 按 run-level 计数（一次 runScheduleNow 全失败 → +1）
    const sched = store.get('retry-all-fail')
    expect(sched?.failCount).toBe(1)
    expect(sched?.state).toBe('active') // L2 还没到 3
  })

  it('连续 3 次 runScheduleNow 全失败 → 触发 L2 pause（fail_count=3）', async () => {
    makeSchedule({ id: 'l2-trigger', maxRetries: 0 })
    store.setState('l2-trigger', 'active')
    stubHandler.mockRejectedValue(new Error('always fail'))

    for (let i = 0; i < L2_AUTO_PAUSE_FAIL_COUNT; i++) {
      // 需要重置 nextRunAt 让 engine 能 claim
      const next = new Date(Date.now() + 60_000).getTime()
      ;(store as any).db.prepare(
        'UPDATE schedules SET next_run_at = ? WHERE id = ?',
      ).run(next, 'l2-trigger')
      await engine.runScheduleNow('l2-trigger')
    }

    const sched = store.get('l2-trigger')
    expect(sched?.state).toBe('paused')
    expect(sched?.failCount).toBe(L2_AUTO_PAUSE_FAIL_COUNT)

    const pausedEvents = captured.filter((e) => e['type'] === 'schedule.paused')
    expect(pausedEvents.length).toBeGreaterThan(0)
  })

  it('backoff 时间戳符合 [30s, 120s, 480s] 默认', async () => {
    makeSchedule({ id: 'backoff-check', maxRetries: 3 })
    store.setState('backoff-check', 'active')
    stubHandler.mockRejectedValue(new Error('fail'))

    await engine.runScheduleNow('backoff-check')
    const retriedEvents = captured.filter((e) => e['type'] === 'schedule.retried')
    expect(retriedEvents).toHaveLength(3)
    expect((retriedEvents[0]!.payload as any).backoff_seconds).toBe(30)
    expect((retriedEvents[1]!.payload as any).backoff_seconds).toBe(120)
    expect((retriedEvents[2]!.payload as any).backoff_seconds).toBe(480)
  })

  it('maxRetries=0 → 不重试（maxAttempts=1）', async () => {
    makeSchedule({ id: 'no-retry', maxRetries: 0 })
    store.setState('no-retry', 'active')
    stubHandler.mockRejectedValue(new Error('fail'))

    const result = await engine.runScheduleNow('no-retry')
    expect('skipped' in result).toBe(false)
    if ('skipped' in result) return
    expect(result.status).toBe('failed')

    const runs = store.listRuns({ scheduleId: 'no-retry' })
    expect(runs).toHaveLength(1)
    const retried = captured.filter((e) => e['type'] === 'schedule.retried')
    expect(retried).toHaveLength(0)
  })

  it('maxRetries 超过上限（>10）→ 自动夹到 10', async () => {
    const s = makeSchedule({ id: 'cap-test', maxRetries: 999 })
    const policy = store.getRetryPolicy(s)
    expect(policy.maxAttempts).toBe(11) // MAX_RETRY_LIMIT=10 + 1
    expect(policy.backoffSeconds).toHaveLength(10)
  })

  it('triggeredBy=manual_retry 区分于 manual', async () => {
    makeSchedule({ id: 'retry-triggered', maxRetries: 0 })
    store.setState('retry-triggered', 'active')
    await engine.runScheduleNow('retry-triggered', 'manual_retry')
    const triggered = captured.find((e) => e['type'] === 'schedule.triggered')!
    expect((triggered.payload as any).triggered_by).toBe('manual_retry')
  })
})

// ============================================================================
// KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 7): dry_run validation
// ============================================================================

describe('validateScheduleConfig — dry_run', () => {
  it('校验通过 → ok=true + preview.nextRun', () => {
    const result = engine.validateScheduleConfig({
      cronExpr: '0 9 * * 1-5',
      timezone: 'Asia/Shanghai',
      toolName: 'remember',
      toolArgs: { content: 'hi' },
    })
    expect(result.ok).toBe(true)
    expect(result.preview?.cronExpr).toBe('0 9 * * 1-5')
    expect(typeof result.preview?.nextRun).toBe('number')
  })

  it('cron 非法 → ok=false + reason=invalid_cron', () => {
    const result = engine.validateScheduleConfig({
      cronExpr: 'this is not cron',
      timezone: 'Asia/Shanghai',
      toolName: 'remember',
      toolArgs: {},
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_cron')
    expect(result.detail).toBeDefined()
  })

  it('timezone 非法 → ok=false + reason=invalid_timezone', () => {
    const result = engine.validateScheduleConfig({
      cronExpr: '0 9 * * *',
      timezone: 'Mars/Olympus_Mons',
      toolName: 'remember',
      toolArgs: {},
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_timezone')
  })

  it('tool 不在 registry → ok=false + reason=tool_not_registered', () => {
    const result = engine.validateScheduleConfig({
      cronExpr: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      toolName: 'nonexistent_tool',
      toolArgs: {},
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('tool_not_registered')
    expect(result.detail).toContain('nonexistent_tool')
  })

  it('toolArgs 是数组 → ok=false + reason=invalid_toolArgs', () => {
    const result = engine.validateScheduleConfig({
      cronExpr: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      toolName: 'remember',
      toolArgs: ['not', 'an', 'object'],
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_toolArgs')
  })

  it('toolArgs 缺失 → ok=true（可选字段）', () => {
    const result = engine.validateScheduleConfig({
      cronExpr: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      toolName: 'remember',
    })
    expect(result.ok).toBe(true)
  })
})

// ============================================================================
// KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 9): 失败模式识别
// ============================================================================

describe('失败模式识别 — failure_pattern_detected', () => {
  it('连续 3 次相同错误 → emit failure_pattern_detected + suggestAction=pause', async () => {
    stubHandler.mockRejectedValue(new Error('connection refused to api.example.com'))
    makeSchedule({ id: 'fp-same', maxRetries: 0 })
    store.setState('fp-same', 'active')

    for (let i = 0; i < 3; i++) {
      const next = new Date(Date.now() + 60_000).getTime()
      ;(store as any).db
        .prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run(next, 'fp-same')
      await engine.runScheduleNow('fp-same')
    }

    const patternEvents = captured.filter((e) => e['type'] === 'schedule.failure_pattern_detected')
    expect(patternEvents.length).toBeGreaterThan(0)
    const last = patternEvents[patternEvents.length - 1]!
    const payload = last['payload'] as Record<string, unknown>
    expect(payload['consecutive_failures']).toBe(3)
    expect(payload['suggest_action']).toBe('pause')
    expect(payload['same_error_hash']).not.toBeNull()
    expect(payload['error_message']).toContain('connection refused')
  })

  it('连续 3 次不同错误 → suggestAction=investigate', async () => {
    const errors = ['network timeout', 'rate limit exceeded', 'auth token expired']
    makeSchedule({ id: 'fp-diff', maxRetries: 0 })
    store.setState('fp-diff', 'active')

    for (const err of errors) {
      stubHandler.mockRejectedValueOnce(new Error(err))
      const next = new Date(Date.now() + 60_000).getTime()
      ;(store as any).db
        .prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
        .run(next, 'fp-diff')
      await engine.runScheduleNow('fp-diff')
    }

    const patternEvents = captured.filter((e) => e['type'] === 'schedule.failure_pattern_detected')
    expect(patternEvents.length).toBeGreaterThan(0)
    const last = patternEvents[patternEvents.length - 1]!
    const payload = last['payload'] as Record<string, unknown>
    expect(payload['consecutive_failures']).toBe(3)
    expect(payload['suggest_action']).toBe('investigate')
    expect(payload['same_error_hash']).toBeNull()
  })

  it('只失败 1 次 → 不 emit failure_pattern_detected（阈值 3）', async () => {
    stubHandler.mockRejectedValueOnce(new Error('one off failure'))
    makeSchedule({ id: 'fp-one', maxRetries: 0 })
    store.setState('fp-one', 'active')
    await engine.runScheduleNow('fp-one')

    const patternEvents = captured.filter((e) => e['type'] === 'schedule.failure_pattern_detected')
    expect(patternEvents).toHaveLength(0)
  })

  it('失败后成功 → consecutiveFailures 归零（success 中断连续段）', async () => {
    stubHandler.mockRejectedValueOnce(new Error('fail'))
    makeSchedule({ id: 'fp-recover', maxRetries: 0 })
    store.setState('fp-recover', 'active')
    await engine.runScheduleNow('fp-recover')

    stubHandler.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] })
    const next = new Date(Date.now() + 60_000).getTime()
    ;(store as any).db
      .prepare('UPDATE schedules SET next_run_at = ? WHERE id = ?')
      .run(next, 'fp-recover')
    await engine.runScheduleNow('fp-recover')

    const pattern = store.getFailurePatterns('fp-recover')
    expect(pattern.consecutiveFailures).toBe(0)
  })

  it('store.getFailurePatterns 直接调用：无失败 → consecutiveFailures=0', () => {
    makeSchedule({ id: 'fp-none', maxRetries: 0 })
    const pattern = store.getFailurePatterns('fp-none')
    expect(pattern.consecutiveFailures).toBe(0)
    expect(pattern.suggestAction).toBe('review')
    expect(pattern.sameErrorHash).toBeNull()
  })
})