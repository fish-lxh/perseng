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
import { toolxTool } from '../toolx.js'
import { manifest as learningManifest } from '../learning.manifest.js'

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

  it('I-AT-4: [Bug 6] action inputSchema.required 不含 role - born 不被 schema 拦截', () => {
    const tool = actionModule.createActionTool(true)
    const required = (tool.inputSchema as any).required as string[]
    expect(required).not.toContain('role')
    expect(required).toEqual([])
  })

  it('I-AT-5: [Bug 6] born 不传 role 也能成功（无需魔法值 role:"_"）', async () => {
    const tool = actionModule.createActionTool(true)
    const { bus, captured } = captureBus()
    tool.setEventBus!(bus)
    const result = await tool.handler({
      operation: 'born',
      name: 'my-dev',
      source: 'Feature: x',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('born', expect.anything())
    expect(captured.some((e) => e['type'] === 'action.born')).toBe(true)
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

  it('I-LC-3: [Bug 6] lifecycle inputSchema.required 不含 role', () => {
    const tool = lifecycleModule.createLifecycleTool(true)
    const required = (tool.inputSchema as any).required as string[]
    expect(required).not.toContain('role')
    expect(required).toEqual(['operation'])
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
      encounters: 'enc1',
      name: 'n1',
      id: 'p1',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('reflect', expect.anything())
    expect(captured.some((e) => e['type'] === 'learning.reflect')).toBe(true)
  })

  it('I-LR-2: [Bug 6] learning inputSchema.required 不含 role', () => {
    const tool = learningModule.createLearningTool(true)
    const required = (tool.inputSchema as any).required as string[]
    expect(required).not.toContain('role')
    expect(required).toEqual(['operation'])
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
      source: 'Feature: Tech Lead',
    } as any)
    expect(result.isError).toBeFalsy()
    expect(dispatcherStub.dispatch).toHaveBeenCalledWith('establish', expect.anything())
    expect(captured.some((e) => e['type'] === 'organization.establish')).toBe(true)
  })

  it('I-OG-2: [Bug 6] organization inputSchema.required 不含 role', () => {
    const tool = organizationModule.createOrganizationTool(true)
    const required = (tool.inputSchema as any).required as string[]
    expect(required).not.toContain('role')
    expect(required).toEqual(['operation'])
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

// ============================================================================
// toolx
// ============================================================================

describe('toolx tool - independent happy/error path', () => {
  it('I-TX-1: [Bug 1] 空参数调用抛友好错误（不抛 JS 崩溃）', async () => {
    await expect(toolxTool.handler({} as any)).rejects.toThrow(/缺少必需参数|yaml/)
  })

  it('I-TX-2: [Bug 1] yaml 为 undefined 时抛友好错误', async () => {
    await expect(toolxTool.handler({ yaml: undefined } as any)).rejects.toThrow(/缺少必需参数/)
  })

  it('I-TX-3: [Bug 1] yaml 为空字符串/纯空白时抛友好错误', async () => {
    await expect(toolxTool.handler({ yaml: '   ' } as any)).rejects.toThrow(/缺少必需参数/)
  })
})

// ============================================================================
// Bug 2-5: 批量参数校验 & 友好提示
// ============================================================================

describe('remember tool - [Bug 2] engram 字段批量校验', () => {
  it('I-RM-3: [Bug 2] engram 缺 content/schema/strength/type -> 一次报全', async () => {
    const result = await rememberTool.handler({
      role: 'luban',
      engrams: [{}],
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/engram 字段校验失败/)
    expect(text).toMatch(/content/)
    expect(text).toMatch(/schema/)
    expect(text).toMatch(/strength/)
    expect(text).toMatch(/type/)
    // 缺字段不应走到 cli
    expect(cliExecute).not.toHaveBeenCalled()
  })

  it('I-RM-4: [Bug 2] 用 text/weight 错误字段名 -> 提示正确字段名', async () => {
    const result = await rememberTool.handler({
      role: 'luban',
      engrams: [{ text: 'x', weight: 0.5, schema: 'kw', type: 'ATOMIC' }],
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/用了 'text'，应为 'content'/)
    expect(text).toMatch(/用了 'weight'，应为 'strength'/)
  })
})

describe('learning tool - [Bug 3] forge 移除 & 批量校验', () => {
  it('I-LR-3: [Bug 3] forge 不在 manifest capabilities', () => {
    const caps = (learningManifest as any).capabilities as string[]
    expect(caps).not.toContain('learning:forge')
  })

  it('I-LR-4: [Bug 3] reflect 缺 encounters -> 友好错误一次报全', async () => {
    const tool = learningModule.createLearningTool(true)
    const result = await tool.handler({
      operation: 'reflect',
      role: '_',
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/reflect 操作缺少必填参数: encounters/)
    expect(dispatcherStub.dispatch).not.toHaveBeenCalled()
  })
})

describe('lifecycle tool - [Bug 4] V1 提示人性化', () => {
  it('I-LC-4: [Bug 4] V1 角色提示给出两个选择（A/B）', async () => {
    const tool = lifecycleModule.createLifecycleTool(true)
    const result = await tool.handler({
      operation: 'focus',
      role: 'luban',
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/两个选择/)
    expect(text).toMatch(/A\./)
    expect(text).toMatch(/B\./)
    expect(dispatcherStub.dispatch).not.toHaveBeenCalled()
  })
})

describe('organization tool - [Bug 5] found/establish 批量校验', () => {
  it('I-OG-3: [Bug 5] found 缺 name -> 友好错误', async () => {
    const tool = organizationModule.createOrganizationTool(true)
    const result = await tool.handler({
      operation: 'found',
      role: '_',
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/found 操作缺少必填参数: name/)
    expect(dispatcherStub.dispatch).not.toHaveBeenCalled()
  })

  it('I-OG-4: [Bug 5] establish 缺 source, org -> 一次报全', async () => {
    const tool = organizationModule.createOrganizationTool(true)
    const result = await tool.handler({
      operation: 'establish',
      role: '_',
      name: 'd1',
    } as any)
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/establish 操作缺少必填参数: source, org/)
    expect(dispatcherStub.dispatch).not.toHaveBeenCalled()
  })
})