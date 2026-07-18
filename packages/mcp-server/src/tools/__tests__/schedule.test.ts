/**
 * tools/__tests__/schedule.test.ts — schedule 工具 7 个 sub-op 单测 (Phase 1 / Commit 3)
 *
 * KNUTH-FEAT 2026-07-18 (Phase 1)
 *
 * 覆盖：
 *  - happy path: create / list / get / pause / resume / delete / history
 *  - validation-error: 缺必填参数、非法 cron、不存在的 id
 *  - event emit: type = `schedule.${operation}`
 *  - 与 enableV2 正交：V1 模式也能用
 *
 * 跑法：pnpm --filter @promptx/mcp-server test -- schedule
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ============================================================================
// helpers — event capture
// ============================================================================

function captureBus() {
  const captured: Array<Record<string, unknown>> = []
  const bus = {
    emit(env: Record<string, unknown>) {
      captured.push(env)
    },
  }
  return { bus, captured }
}

// ============================================================================
// schedule 模块 — mock-free（schedule 不依赖 @promptx/core）
// ============================================================================

import * as scheduleModule from '../schedule.js'
import { getScheduleStore, resetScheduleStore } from '../../scheduler/instance.js'

// ============================================================================
// ScheduleStore 单例管理 — 每个测试用 tmp db
// ============================================================================

let tmpDir = ''
let dbPath = ''

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-schedule-tool-test-'))
  dbPath = path.join(tmpDir, 'schedules.db')
  // 主动构造（不依赖 singleton）— schedule 工具 handler 调 getScheduleStore()
  getScheduleStore(dbPath)
  ;(scheduleModule as { _resetScheduleEventBus?: () => void })._resetScheduleEventBus?.()
})

afterEach(async () => {
  resetScheduleStore()
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

// ============================================================================
// 基本元数据
// ============================================================================

describe('schedule tool — 元数据 / 工厂', () => {
  it('I-SC-META-1: tool name 是 "schedule"', () => {
    const tool = scheduleModule.createScheduleTool(true)
    expect(tool.name).toBe('schedule')
  })

  it('I-SC-META-2: inputSchema.enum 列出 7 个 operation（不含 run_now）', () => {
    const tool = scheduleModule.createScheduleTool(true)
    const opEnum = (tool.inputSchema as any).properties.operation.enum
    expect(opEnum).toEqual([
      'create',
      'list',
      'get',
      'pause',
      'resume',
      'delete',
      'history',
    ])
    expect(opEnum).not.toContain('run_now')
  })

  it('I-SC-META-3: inputSchema.required 只含 operation', () => {
    const tool = scheduleModule.createScheduleTool(true)
    expect((tool.inputSchema as any).required).toEqual(['operation'])
  })

  it('I-SC-META-4: enableV2=false 也能用（与 V2 正交）', async () => {
    const tool = scheduleModule.createScheduleTool(false)
    const result = await tool.handler({ operation: 'list' } as any)
    expect(result.isError).toBeFalsy()
  })
})

// ============================================================================
// create
// ============================================================================

describe('schedule tool — create', () => {
  it('I-SC-C-1: 合法 cron + toolArgs → success，自动生成 id', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    const result = await tool.handler({
      operation: 'create',
      name: 'morning-prep',
      cronExpr: '0 9 * * 1-5',
      timezone: 'Asia/Shanghai',
      toolName: 'remember',
      toolArgs: { content: 'hello' },
    } as any)
    expect(result.isError).toBeFalsy()
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/✅ schedule 已创建/)
    expect(text).toMatch(/"id":/)
    expect(text).toMatch(/"state": "pending"/)
    expect(captured.some((e) => e['type'] === 'schedule.create')).toBe(true)
  })

  it('I-SC-C-2: 缺 cronExpr → 友好错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({
      operation: 'create',
      name: 'broken',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/缺少必填参数/)
    expect(text).toMatch(/cronExpr/)
  })

  it('I-SC-C-3: 非法 cron 表达式 → 友好错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({
      operation: 'create',
      name: 'broken',
      cronExpr: 'not-a-cron',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/cron 表达式非法/)
  })

  it('I-SC-C-4: 没 bus 时不抛错', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({
      operation: 'create',
      name: 'x',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    expect(result.isError).toBeFalsy()
  })

  it('I-SC-C-5: 没传 timezone → 默认 Asia/Shanghai', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({
      operation: 'create',
      name: 'default-tz',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"timezone": "Asia\/Shanghai"/)
  })
})

// ============================================================================
// list
// ============================================================================

describe('schedule tool — list', () => {
  beforeEach(async () => {
    // 准备 2 条
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({
      operation: 'create',
      id: 'list-a',
      name: 'a',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    await tool.handler({
      operation: 'create',
      id: 'list-b',
      name: 'b',
      cronExpr: '*/30 * * * *',
      toolName: 'action',
      toolArgs: {},
    } as any)
  })

  it('I-SC-L-1: 无 filter → 返回全部（含刚创建的）', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'list' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"count": 2/)
    expect(text).toMatch(/list-a/)
    expect(text).toMatch(/list-b/)
  })

  it('I-SC-L-2: state=pending filter', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'list', state: 'pending' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"count": 2/)
  })

  it('I-SC-L-3: toolName=remember filter', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'list', toolName: 'remember' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/list-a/)
    expect(text).not.toMatch(/list-b/)
  })

  it('I-SC-L-4: 默认隐藏已删除（state=deleted）', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({ operation: 'delete', id: 'list-a' } as any)
    const result = await tool.handler({ operation: 'list' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"count": 1/)
  })
})

// ============================================================================
// get
// ============================================================================

describe('schedule tool — get', () => {
  it('I-SC-G-1: 取存在的 id → 返回完整 schedule', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({
      operation: 'create',
      id: 'get-1',
      name: 'g',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: { x: 1 },
    } as any)
    const result = await tool.handler({ operation: 'get', id: 'get-1' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"id": "get-1"/)
    expect(text).toMatch(/"name": "g"/)
    expect(text).toMatch(/"toolName": "remember"/)
  })

  it('I-SC-G-2: 不存在的 id → 友好错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'get', id: 'nope' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/不存在/)
  })

  it('I-SC-G-3: 缺 id → 必填错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'get' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/缺少必填参数/)
  })
})

// ============================================================================
// pause / resume
// ============================================================================

describe('schedule tool — pause / resume', () => {
  it('I-SC-P-1: pause active → paused 并 emit schedule.pause', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    await tool.handler({
      operation: 'create',
      id: 'p1',
      name: 'p',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    await tool.handler({ operation: 'resume', id: 'p1' } as any) // pending → active
    const result = await tool.handler({ operation: 'pause', id: 'p1' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/已暂停/)
    expect(captured.some((e) => e['type'] === 'schedule.pause')).toBe(true)
  })

  it('I-SC-P-2: pause 不存在 id → 错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'pause', id: 'nope' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/不存在/)
  })

  it('I-SC-P-3: pause 已 paused → 无操作（no-op）', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({
      operation: 'create',
      id: 'p2',
      name: 'p',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    await tool.handler({ operation: 'pause', id: 'p2' } as any)
    const result = await tool.handler({ operation: 'pause', id: 'p2' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/已经是 paused/)
  })

  it('I-SC-R-1: resume paused → active 并 emit schedule.resume', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    await tool.handler({
      operation: 'create',
      id: 'r1',
      name: 'r',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    await tool.handler({ operation: 'pause', id: 'r1' } as any)
    const result = await tool.handler({ operation: 'resume', id: 'r1' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/已激活/)
    expect(captured.some((e) => e['type'] === 'schedule.resume')).toBe(true)
  })

  it('I-SC-R-2: resume 已 active → no-op', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({
      operation: 'create',
      id: 'r2',
      name: 'r',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    await tool.handler({ operation: 'resume', id: 'r2' } as any)
    const result = await tool.handler({ operation: 'resume', id: 'r2' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/已经是 active/)
  })
})

// ============================================================================
// delete
// ============================================================================

describe('schedule tool — delete', () => {
  it('I-SC-D-1: delete → soft-deleted（state=deleted）并 emit schedule.delete', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    await tool.handler({
      operation: 'create',
      id: 'd1',
      name: 'd',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    const result = await tool.handler({ operation: 'delete', id: 'd1' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/已删除/)
    expect(captured.some((e) => e['type'] === 'schedule.delete')).toBe(true)
    // list 默认隐藏
    const listResult = await tool.handler({ operation: 'list' } as any)
    const listText = (listResult.content[0] as { text: string }).text
    expect(listText).toMatch(/"count": 0/)
  })

  it('I-SC-D-2: delete 不存在 → 错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'delete', id: 'nope' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/不存在/)
  })
})

// ============================================================================
// history
// ============================================================================

describe('schedule tool — history', () => {
  it('I-SC-H-1: 不存在的 id → 错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'history', id: 'nope' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/不存在/)
  })

  it('I-SC-H-2: 存在但无 runs → count=0', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({
      operation: 'create',
      id: 'h1',
      name: 'h',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    const result = await tool.handler({ operation: 'history', id: 'h1' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"count": 0/)
  })

  it('I-SC-H-3: 直接走 store 写一条 run → history 能看到', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    await tool.handler({
      operation: 'create',
      id: 'h2',
      name: 'h',
      cronExpr: '0 9 * * 1-5',
      toolName: 'remember',
      toolArgs: {},
    } as any)
    // 直接通过 store 注入一条 run（模拟 engine 跑过一次）
    const store = getScheduleStore()
    store.setState('h2', 'active')
    store.recordRunStart('h2', Date.now())
    store.recordRunEnd(1, 'success', null, '{"ok":true}', 42)
    const result = await tool.handler({ operation: 'history', id: 'h2' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/"count": 1/)
    expect(text).toMatch(/"status": "success"/)
    expect(text).toMatch(/"durationMs": 42/)
  })
})

// ============================================================================
// 不支持 operation
// ============================================================================

describe('schedule tool — 默认 / 未知 operation', () => {
  it('I-SC-X-1: 不传 operation → 必填错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({} as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/operation 必填/)
  })

  it('I-SC-X-2: 不支持的 operation（手注入 enum 漏的）→ 错误', async () => {
    const tool = scheduleModule.createScheduleTool(true)
    const result = await tool.handler({ operation: 'timetravel' } as any)
    const text = (result.content[0] as { text: string }).text
    // 不在 requiredByOp 里 → 走到 switch default
    expect(text).toMatch(/不支持的 operation/)
  })
})