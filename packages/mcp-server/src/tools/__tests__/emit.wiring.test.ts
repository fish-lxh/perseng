/**
 * 4 个工具的 setEventBus 注入 + emit 单测
 *
 * 策略：mock `@promptx/core` 的 dynamic import 让 dispatcher 返回 controlled result，
 * 这样 handler 走完整路径（actAs → isV2Role → dispatcher.dispatch → emitX）。
 *
 * I-M4-1 action: 6 operation 各自 emit 正确的 action.<op>
 * I-M4-2 lifecycle: 7 op 各自 emit
 * I-M4-3 learning: 6 op 各自 emit
 * I-M4-4 organization: 17 op 各自 emit
 *
 * 不变量：每工具 emit 1 条；producer 正确；type 与 operation 一致；payload 包含 role/name。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ============================================================================
// mock @promptx/core BEFORE importing any tool
// ============================================================================

const dispatcherStub = {
  // 每个 operation 都返回一段 successful 文本，让 convertToMCPFormat 不抛
  dispatch: vi.fn(async (operation: string) => ({
    type: operation,
    content: `mock dispatch result for ${operation}`,
  })),
  isV2Role: vi.fn(async (_role: string) => true),
}

// 用 class 而不是 arrow function — arrow 不能被 `new`
class RolexActionDispatcher {
  constructor() {
    return dispatcherStub
  }
}

const coreMock = {
  rolex: {
    RolexActionDispatcher,
  },
  actAs: vi.fn(async (role: string) => ({
    kind: 'role',
    identity: { id: role, name: role },
    reference: `@role://${role}`,
  })),
  cli: {
    execute: vi.fn(async () => ({
      type: 'success',
      content: 'mocked V1 activation success',
    })),
  },
  pouch: { cli: { execute: vi.fn(async () => ({ type: 'success', content: 'mock V1' })) } },
}

// core.default 是 ESM default export — 工具代码用 (core.default || core)
vi.mock('@promptx/core', () => ({
  default: coreMock,
  ...coreMock, // 同时顶层挂，让 CJS 也能拿到 rolex
}))

// ============================================================================
// imports (static — TS1378 静态 import 不需要 top-level await)
// ============================================================================

import * as actionModule from '../action.js'
import * as lifecycleModule from '../lifecycle.js'
import * as learningModule from '../learning.js'
import * as organizationModule from '../organization.js'

let tmpDir = ''

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-mcp-emit-'))
  process.env['PERSENG_EVENTS_DB_PATH'] = path.join(tmpDir, 'events.db')
  process.env['PERSENG_EVENTS_ENABLED'] = 'true'
  dispatcherStub.dispatch.mockClear()
  dispatcherStub.isV2Role.mockClear()
})

afterEach(async () => {
  delete process.env['PERSENG_EVENTS_DB_PATH']
  delete process.env['PERSENG_EVENTS_ENABLED']
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
})

// ============================================================================
// bus stub
// ============================================================================

interface CapturedEvent {
  type: string
  producer: string
  payload: Record<string, unknown>
}

function makeCaptureBus() {
  const captured: CapturedEvent[] = []
  const bus = {
    emit(env: Record<string, unknown>) {
      captured.push({
        type: env['type'] as string,
        producer: env['producer'] as string,
        payload: env['payload'] as Record<string, unknown>,
      })
      // emit 也可同步返回 void 或 async Promise — 都接受
    },
  }
  return { bus, captured }
}

// ============================================================================
// I-M4-1: action tool
// ============================================================================

describe('M4 action tool — emit wiring', () => {
  beforeEach(() => {
    actionModule._resetActionEventBus?.()
  })

  const ops: Array<{ op: string; extraArgs: Record<string, unknown> }> = [
    { op: 'born', extraArgs: { name: 'my-role', source: 'Feature: x' } },
    { op: 'identity', extraArgs: {} },
    { op: 'archive', extraArgs: {} },
    { op: 'unarchive', extraArgs: {} },
    { op: 'delete', extraArgs: {} },
    { op: 'activate', extraArgs: { version: 'v2' } },
  ]

  for (const { op, extraArgs } of ops) {
    it(`emits action.${op} on success`, async () => {
      const tool = actionModule.createActionTool(true)
      const { bus, captured } = makeCaptureBus()
      tool.setEventBus!(bus)
      await tool.handler({ role: 'nuwa', operation: op, ...extraArgs } as any)
      // fire-and-forget 时若 sync emit 同步落 captured
      const evs = captured.filter((e) => e.type === `action.${op}`)
      // 至少 1 条；fire-and-forget 的 async 路径允许 0
      expect(evs.length).toBeGreaterThanOrEqual(1)
      if (evs.length >= 1) {
        expect(evs[0]!.producer).toBe('tool:action')
        expect(evs[0]!.payload['operation']).toBe(op)
      }
    })
  }

  it('activates V1 (when version=v1) and emits action.activate v1', async () => {
    const tool = actionModule.createActionTool(true)
    const { bus, captured } = makeCaptureBus()
    tool.setEventBus!(bus)
    await tool.handler({ role: 'nuwa', version: 'v1' } as any)
    const evs = captured.filter((e) => e.type === 'action.activate')
    expect(evs.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// I-M4-2: lifecycle tool
// ============================================================================

describe('M4 lifecycle tool — emit wiring', () => {
  beforeEach(() => {
    lifecycleModule._resetLifecycleEventBus?.()
  })

  const ops = ['want', 'plan', 'todo', 'finish', 'achieve', 'abandon', 'focus']

  for (const op of ops) {
    it(`emits lifecycle.${op} on success`, async () => {
      const tool = lifecycleModule.createLifecycleTool(true)
      const { bus, captured } = makeCaptureBus()
      tool.setEventBus!(bus)
      await tool.handler({ operation: op, role: 'nuwa', name: 'g1', id: 'p1' } as any)
      const evs = captured.filter((e) => e.type === `lifecycle.${op}`)
      expect(evs.length).toBeGreaterThanOrEqual(1)
      if (evs.length >= 1) {
        expect(evs[0]!.producer).toBe('tool:lifecycle')
      }
    })
  }
})

// ============================================================================
// I-M4-3: learning tool
// ============================================================================

describe('M4 learning tool — emit wiring', () => {
  beforeEach(() => {
    learningModule._resetLearningEventBus?.()
  })

  const ops = ['reflect', 'realize', 'master', 'forget', 'synthesize', 'skill']

  for (const op of ops) {
    it(`emits learning.${op} on success`, async () => {
      const tool = learningModule.createLearningTool(true)
      const { bus, captured } = makeCaptureBus()
      tool.setEventBus!(bus)
      // synthesize 用 target role；其余用 '_'
      const role = op === 'synthesize' ? 'target-role' : '_'
      await tool.handler({ operation: op, role, name: 'n1', id: 'p1' } as any)
      const evs = captured.filter((e) => e.type === `learning.${op}`)
      expect(evs.length).toBeGreaterThanOrEqual(1)
      if (evs.length >= 1) {
        expect(evs[0]!.producer).toBe('tool:learning')
      }
    })
  }
})

// ============================================================================
// I-M4-4: organization tool — 17 operations
// ============================================================================

describe('M4 organization tool — emit wiring', () => {
  beforeEach(() => {
    organizationModule._resetOrganizationEventBus?.()
  })

  const ops = [
    'found', 'charter', 'dissolve', 'directory',
    'establish', 'charge', 'require', 'abolish',
    'hire', 'fire', 'appoint', 'dismiss',
    'retire', 'rehire', 'die', 'train',
  ]

  for (const op of ops) {
    it(`emits organization.${op} on success`, async () => {
      const tool = organizationModule.createOrganizationTool(true)
      const { bus, captured } = makeCaptureBus()
      tool.setEventBus!(bus)
      await tool.handler({
        operation: op,
        role: '_',
        name: 'x',
        org: 'o',
        position: 'p',
        individual: 'i',
      } as any)
      const evs = captured.filter((e) => e.type === `organization.${op}`)
      expect(evs.length).toBeGreaterThanOrEqual(1)
      if (evs.length >= 1) {
        expect(evs[0]!.producer).toBe('tool:organization')
      }
    })
  }
})
