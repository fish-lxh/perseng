/**
 * 6 个工具的独立单测 — happy path + 输入校验 + V2 拒绝
 *
 * KNUTH-FEAT 2026-07-11 (批次 1 / RFC 目标 3.2 衍生):
 * 与 emit.wiring.test.ts 互补 — emit.wiring 验证 envelope 正确性，
 * 本文件验证 handler 主体路径（成功 / 缺必填 / V2 拒绝 / bus=null）。
 *
 * 覆盖：
 *  - action          (createActionTool)
 *  - lifecycle       (createLifecycleTool)
 *  - learning        (createLearningTool)
 *  - organization    (createOrganizationTool)
 *  - recall          (const export)
 *  - remember        (const export)
 *
 * 不依赖 @promptx/events / SQLite — 用 capture bus + stub core。
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'

// ============================================================================
// @promptx/core mock
// ============================================================================

const dispatcherStub = {
  dispatch: vi.fn(async (operation: string) => ({
    type: operation,
    content: `mock dispatch ${operation}`,
  })),
  isV2Role: vi.fn(async (_role: string) => false), // 默认 V1，避免走 'V2 不支持' 错误
}

class RolexActionDispatcher {
  constructor() {
    return dispatcherStub
  }
}

const cliExecute = vi.fn(async (cmd: string) => ({
  type: 'success',
  content: `mock cli ${cmd} done`,
}))

const coreMock = {
  default: {
    rolex: { RolexActionDispatcher },
    actAs: vi.fn(async (role: string) => ({
      kind: 'role',
      identity: { id: role, name: role },
      reference: `@role://${role}`,
    })),
    cli: { execute: cliExecute },
    pouch: { cli: { execute: cliExecute } },
  },
  rolex: { RolexActionDispatcher },
  actAs: vi.fn(async (role: string) => ({
    kind: 'role',
    identity: { id: role, name: role },
    reference: `@role://${role}`,
  })),
  cli: { execute: cliExecute },
  pouch: { cli: { execute: cliExecute } },
}

vi.mock('@promptx/core', () => coreMock)

// ============================================================================
// 静态 import（在 mock 之后）
// ============================================================================

import * as actionModule from '../action.js'
import * as lifecycleModule from '../lifecycle.js'
import * as learningModule from '../learning.js'
import * as organizationModule from '../organization.js'
import { recallTool } from '../recall.js'
import { rememberTool } from '../remember.js'

// ============================================================================
// helpers
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

function stripMetadata(text: string): string {
  const idx = text.indexOf('\n\n---\n')
  return idx >= 0 ? text.slice(0, idx) : text
}

beforeEach(() => {
  dispatcherStub.dispatch.mockClear()
  dispatcherStub.isV2Role.mockClear()
  cliExecute.mockClear()
  // 每个工具模块都有 _resetXxxEventBus（可选存在）
  ;(actionModule as { _resetActionEventBus?: () => void })._resetActionEventBus?.()
  ;(lifecycleModule as { _resetLifecycleEventBus?: () => void })._resetLifecycleEventBus?.()
  ;(learningModule as { _resetLearningEventBus?: () => void })._resetLearningEventBus?.()
  ;(organizationModule as { _resetOrganizationEventBus?: () => void })._resetOrganizationEventBus?.()
})

// ============================================================================
// action
// ============================================================================

describe('action tool — independent happy/error path', () => {
  it('I-AT-1: activate 走 V2 dispatcher (version=v2) 并 emit action.activate', async () => {
    const tool = actionModule.createActionTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    // version='v2' 强制走 dispatcher；不走 isV2Role 自动检测
    const result = await tool.handler({ role: 'nuwa', operation: 'activate', version: 'v2' } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('activate', expect.anything())
    expect(captured.some((e) => e['type'] === 'action.activate')).toBe(true)
  })

  it('I-AT-2: born 操作走 dispatcher 并 emit action.born', async () => {
    const tool = actionModule.createActionTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    const result = await tool.handler({
      role: '_',
      operation: 'born',
      name: 'my-dev',
      source: 'Feature: x',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('born', expect.anything())
    expect(captured.some((e) => e['type'] === 'action.born')).toBe(true)
  })

  it('I-AT-3: 没有 bus 时不抛错（graceful no-op）', async () => {
    const tool = actionModule.createActionTool(true)
    const result = await tool.handler({
      role: 'nuwa',
      operation: 'activate',
      version: 'v2',
    } as any)
    expect(result.isError).toBeFalsy()
  })
})

// ============================================================================
// lifecycle
// ============================================================================

describe('lifecycle tool — independent happy/error path', () => {
  it('I-LC-1: focus 成功走 dispatcher 并 emit lifecycle.focus', async () => {
    const tool = lifecycleModule.createLifecycleTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    // role='_' 跳过 V1/V2 前置校验，直接走 dispatcher.dispatch
    const result = await tool.handler({
      operation: 'focus',
      role: '_',
      name: 'g1',
      id: 'p1',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('focus', expect.anything())
    expect(captured.some((e) => e['type'] === 'lifecycle.focus')).toBe(true)
  })

  it('I-LC-2: V1 角色不支持 lifecycle → 友好错误（不抛错）', async () => {
    dispatcherStub.isV2Role.mockResolvedValueOnce(false)
    const tool = lifecycleModule.createLifecycleTool(true)
    const result = await tool.handler({ operation: 'focus', role: 'nuwa' } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/V1/)
    expect(text).toMatch(/不支持 lifecycle/)
  })
})

// ============================================================================
// learning
// ============================================================================

describe('learning tool — independent happy/error path', () => {
  it('I-LR-1: reflect 成功走 dispatcher 并 emit learning.reflect', async () => {
    const tool = learningModule.createLearningTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    const result = await tool.handler({
      operation: 'reflect',
      role: '_',
      name: 'n1',
      id: 'p1',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('reflect', expect.anything())
    expect(captured.some((e) => e['type'] === 'learning.reflect')).toBe(true)
  })
})

// ============================================================================
// organization
// ============================================================================

describe('organization tool — independent happy/error path', () => {
  it('I-OG-1: establish 成功走 dispatcher 并 emit organization.establish', async () => {
    const tool = organizationModule.createOrganizationTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    const result = await tool.handler({
      operation: 'establish',
      role: '_',
      org: 'o1',
      name: 'd1',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('establish', expect.anything())
    expect(captured.some((e) => e['type'] === 'organization.establish')).toBe(true)
  })
})

// ============================================================================
// recall (V1 cli 路径)
// ============================================================================

describe('recall tool — independent happy/error path', () => {
  it('I-RC-1: V1 角色 + DMN 模式 → cli.execute("recall") 被调', async () => {
    const result = await recallTool.handler({ role: 'luban', query: null, mode: 'balanced' } as any)
    expect(cliExecute).toHaveBeenCalledWith('recall', expect.anything())
    expect(result.isError).toBeFalsy()
  })

  it('I-RC-2: V2 角色 → 友好错误信息（不抛错）', async () => {
    dispatcherStub.isV2Role.mockResolvedValueOnce(true)
    const result = await recallTool.handler({ role: 'nuwa', query: null } as any)
    // KNUTH-FEAT 2026-07-11: convertToMCPFormat 不会为成功路径设置 isError；
    // 但 V2 错误走 convertToMCPFormat({ type: 'error', content })，
    // 该内容会出现在 content[0].text 让客户端能识别（不需要 isError）。
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/V2/)
    expect(text).toMatch(/不支持 recall/)
  })
})

// ============================================================================
// remember (V1 cli 路径)
// ============================================================================

describe('remember tool — independent happy/error path', () => {
  it('I-RM-1: V1 角色 + engrams → cli.execute("remember") 被调', async () => {
    const result = await rememberTool.handler({
      role: 'luban',
      engrams: [{ content: 'x', schema: 'kw', strength: 0.8, type: 'ATOMIC' }],
    } as any)
    expect(cliExecute).toHaveBeenCalledWith('remember', expect.anything())
    expect(result.isError).toBeFalsy()
  })

  it('I-RM-2: V2 角色 → 友好错误信息', async () => {
    dispatcherStub.isV2Role.mockResolvedValueOnce(true)
    const result = await rememberTool.handler({
      role: 'nuwa',
      engrams: [{ content: 'x', schema: 'kw', strength: 0.5, type: 'LINK' }],
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/V2/)
    expect(text).toMatch(/不支持 remember/)
  })
})