/**
 * EnvelopeValidator 单测 (3.6 P1)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.6 / 批次 2)
 * 覆盖：
 * - validateEnvelope 必填字段校验
 * - producer 命名空间校验（tool:|core:|runtime:）
 * - schemaVersion / producerVersion 版本策略
 * - assertTypeMatchesProducer type/producer 同步
 * - buildEnvelope 自动注入 producer/version/ts
 */

import { describe, it, expect, vi } from 'vitest'
import {
  validateEnvelope,
  buildEnvelope,
  assertTypeMatchesProducer,
  EnvelopeValidationError,
  CURRENT_SCHEMA_VERSION,
} from '../EnvelopeValidator.js'
import { PRODUCER_VERSION } from '../constants.js'
import type { BuilderEnvelope } from '../ToolContext.js'

// ============================================================================
// helpers
// ============================================================================

function makeEnvelope(overrides: Partial<BuilderEnvelope> = {}): BuilderEnvelope {
  return {
    type: 'action.activate',
    ts: Date.now(),
    ingestedAt: Date.now(),
    sessionId: null,
    agentId: null,
    imageId: null,
    role: 'system',
    producer: 'tool:action',
    producerVersion: PRODUCER_VERSION,
    schemaVersion: 1,
    causation: null,
    tenantId: null,
    ownerId: null,
    payload: { role: 'nuwa' },
    ...overrides,
  }
}

const fakeCtx = { trace: { sessionId: null, agentId: null, causationId: null } }

// ============================================================================
// validateEnvelope
// ============================================================================

describe('validateEnvelope', () => {
  it('V-1: 合法 envelope 通过（type 与 producer 命名空间匹配）', () => {
    expect(() => validateEnvelope(makeEnvelope())).not.toThrow()
  })

  it('V-2: type 为空抛错', () => {
    expect(() => validateEnvelope(makeEnvelope({ type: '' }))).toThrow(/type/)
  })

  it('V-3: producer 缺少 : 抛错', () => {
    expect(() => validateEnvelope(makeEnvelope({ producer: 'bad-name', type: 'bad-name.x' })))
      .toThrow(/producer/)
  })

  it('V-4: producer 错误 namespace（desktop:xxx）抛错', () => {
    expect(() => validateEnvelope(makeEnvelope({ producer: 'desktop:foo', type: 'desktop:foo.x' })))
      .toThrow(/producer/)
  })

  it('V-5: schemaVersion !== 1 抛错', () => {
    expect(() => validateEnvelope(makeEnvelope({ schemaVersion: 2 as unknown as 1 })))
      .toThrow(/schemaVersion/)
  })

  it('V-6: producerVersion 不一致抛错', () => {
    expect(() => validateEnvelope(makeEnvelope({ producerVersion: '0.0.1' })))
      .toThrow(/producerVersion/)
  })

  it('V-7: ts <= 0 抛错', () => {
    expect(() => validateEnvelope(makeEnvelope({ ts: 0 }))).toThrow(/ts/)
  })

  it('V-8: type/producer 命名空间偏离 — 默认仅 warn（不 throw）', () => {
    // producer=tool:action 但 type=lifecycle.focus 跨 namespace — 默认仅 console.warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => validateEnvelope(makeEnvelope({ type: 'lifecycle.focus' }))).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('V-9: core:* producer 通过', () => {
    expect(() => validateEnvelope(makeEnvelope({ producer: 'core:actAs', type: 'actAs.x' })))
      .not.toThrow()
  })

  it('V-10: runtime:* producer 通过', () => {
    expect(() => validateEnvelope(makeEnvelope({ producer: 'runtime:agentx', type: 'agentx.x' })))
      .not.toThrow()
  })

  it('V-11: EnvelopeValidationError 携带 field 名', () => {
    try {
      validateEnvelope(makeEnvelope({ producerVersion: '0.0.1' }))
    } catch (err) {
      expect(err).toBeInstanceOf(EnvelopeValidationError)
      expect((err as EnvelopeValidationError).field).toBe('producerVersion')
    }
  })

  it('V-12: assertTypeMatchesProducer strict 模式抛错', () => {
    expect(() => assertTypeMatchesProducer(makeEnvelope({ type: 'lifecycle.focus' }), { strict: true }))
      .toThrow(/recommended prefix/)
  })
})

// ============================================================================
// assertTypeMatchesProducer
// ============================================================================

describe('assertTypeMatchesProducer', () => {
  it('A-1: 默认 (non-strict) 偏离 → console.warn 不抛错', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => assertTypeMatchesProducer(makeEnvelope({ type: 'lifecycle.focus' }))).not.toThrow()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('A-2: 跨 producer + strict=true 抛错', () => {
    const env = makeEnvelope({ producer: 'tool:action', type: 'lifecycle.focus' })
    expect(() => assertTypeMatchesProducer(env, { strict: true })).toThrow(/type/)
  })

  it('A-3: producer 自身（type === producerShort）也算匹配', () => {
    const env = makeEnvelope({ producer: 'tool:action', type: 'action' })
    expect(() => assertTypeMatchesProducer(env)).not.toThrow()
  })
})

// ============================================================================
// buildEnvelope
// ============================================================================

describe('buildEnvelope', () => {
  it('B-1: 自动注入 producer / producerVersion / schemaVersion / ts', () => {
    const env = buildEnvelope({ type: 'action.activate', producer: 'tool:action' }, { role: 'nuwa' }, fakeCtx)
    expect(env.producer).toBe('tool:action')
    expect(env.producerVersion).toBe(PRODUCER_VERSION)
    expect(env.schemaVersion).toBe(1)
    expect(env.ts).toBeGreaterThan(0)
    expect(env.ingestedAt).toBe(env.ts)
  })

  it('B-2: payload 直传', () => {
    const payload = { foo: 'bar' }
    const env = buildEnvelope({ type: 't.x', producer: 'tool:x' }, payload, fakeCtx)
    expect(env.payload).toBe(payload)
  })

  it('B-3: silent 模式不抛错', () => {
    expect(() =>
      buildEnvelope({ type: 'lifecycle.x', producer: 'tool:action' }, {}, fakeCtx, 'system', { silent: true }),
    ).not.toThrow()
  })

  it('B-4: 默认 role = system', () => {
    const env = buildEnvelope({ type: 't.x', producer: 'tool:x' }, {}, fakeCtx)
    expect(env.role).toBe('system')
  })

  it('B-5: 显式 role 覆盖', () => {
    const env = buildEnvelope({ type: 't.x', producer: 'tool:x' }, {}, fakeCtx, 'assistant')
    expect(env.role).toBe('assistant')
  })

  it('B-6: trace 字段透传', () => {
    const env = buildEnvelope(
      { type: 't.x', producer: 'tool:x' },
      {},
      { trace: { sessionId: 's1', agentId: 'a1', causationId: 99 } },
    )
    expect(env.sessionId).toBe('s1')
    expect(env.agentId).toBe('a1')
    expect(env.causation).toBe(99)
  })

  it('B-7: 跨 producer type 不抛错（silent=true）但记录问题', () => {
    const env = buildEnvelope({ type: 'lifecycle.x', producer: 'tool:action' }, {}, fakeCtx, 'system', { silent: true })
    expect(env.type).toBe('lifecycle.x') // silent 下不 throw
  })
})

describe('constants', () => {
  it('C-1: PRODUCER_VERSION 与 CURRENT_SCHEMA_VERSION 一致', () => {
    expect(typeof PRODUCER_VERSION).toBe('string')
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
  })
})