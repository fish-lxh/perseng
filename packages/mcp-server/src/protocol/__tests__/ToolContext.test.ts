/**
 * ToolContext 协议单测 (3.2 P0)
 *
 * KNUTH-FEAT 2026-07-11 (批次 1 / RFC 目标 3.2)
 * 验证：
 * - EnvelopeBuilder 自动从 ctx 派生 trace / producer / producerVersion
 * - NULL_CONTEXT 是合法 fallback（trace null、envelope 也能用）
 * - handlerAcceptsCtx + invokeHandler 正确分派 V1 / V2 签名
 */

import { describe, it, expect } from 'vitest'
import {
  NULL_TRACE,
  NULL_CONTEXT,
  createEnvelopeBuilder,
  handlerAcceptsCtx,
  invokeHandler,
  type ToolContext,
  type TraceContext,
} from '../ToolContext.js'
import type { ToolResponse } from '../ToolContext.js'

// ============================================================================
// EnvelopeBuilder
// ============================================================================

describe('createEnvelopeBuilder', () => {
  it('E-1: ts / ingestedAt 自动填充为同一毫秒', () => {
    const trace: TraceContext = { sessionId: 's1', agentId: 'a1', correlationId: 'c1', causationId: 42 }
    const builder = createEnvelopeBuilder(trace, 'tool:action', '2.4.1')
    const env = builder.create({ type: 'action.activate', payload: { role: 'luban' } })
    expect(env.ts).toBeGreaterThan(0)
    expect(env.ingestedAt).toBe(env.ts)
  })

  it('E-2: 自动从 trace 派生 sessionId/agentId/causation', () => {
    const trace: TraceContext = { sessionId: 's1', agentId: 'a1', correlationId: 'c1', causationId: 42 }
    const builder = createEnvelopeBuilder(trace, 'tool:action', '2.4.1')
    const env = builder.create({ type: 'action.activate', payload: {} })
    expect(env.sessionId).toBe('s1')
    expect(env.agentId).toBe('a1')
    expect(env.causation).toBe(42)
  })

  it('E-3: producer / producerVersion / schemaVersion 来自工厂参数', () => {
    const builder = createEnvelopeBuilder(NULL_TRACE, 'tool:learning', '9.9.9')
    const env = builder.create({ type: 'learning.reflect', payload: {} })
    expect(env.producer).toBe('tool:learning')
    expect(env.producerVersion).toBe('9.9.9')
    expect(env.schemaVersion).toBe(1)
  })

  it('E-4: 默认 role = system', () => {
    const builder = createEnvelopeBuilder(NULL_TRACE, 'tool:action', '1.0')
    const env = builder.create({ type: 't', payload: {} })
    expect(env.role).toBe('system')
  })

  it('E-5: role 可显式覆盖', () => {
    const builder = createEnvelopeBuilder(NULL_TRACE, 'tool:action', '1.0')
    const env = builder.create({ type: 't', payload: {}, role: 'assistant' })
    expect(env.role).toBe('assistant')
  })

  it('E-6: payload 直传（不深拷贝）', () => {
    const builder = createEnvelopeBuilder(NULL_TRACE, 'tool:action', '1.0')
    const payload = { role: 'luban', nested: { x: 1 } }
    const env = builder.create({ type: 't', payload })
    expect(env.payload).toBe(payload) // identity（reference），不深拷贝
    // 改 payload 不应该 mutate env.payload
    payload.nested.x = 999
    expect((env.payload as typeof payload).nested.x).toBe(999) // 同 reference；行为可见
  })

  it('E-7: NULL_TRACE 也能创建 envelope（sessionId/agentId = null）', () => {
    const builder = createEnvelopeBuilder(NULL_TRACE, 'tool:action', '1.0')
    const env = builder.create({ type: 't', payload: {} })
    expect(env.sessionId).toBeNull()
    expect(env.agentId).toBeNull()
    expect(env.causation).toBeNull()
  })
})

// ============================================================================
// NULL_CONTEXT / TraceContext
// ============================================================================

describe('NULL_TRACE / NULL_CONTEXT', () => {
  it('T-1: NULL_TRACE 全部字段为 null', () => {
    expect(NULL_TRACE.sessionId).toBeNull()
    expect(NULL_TRACE.agentId).toBeNull()
    expect(NULL_TRACE.correlationId).toBeNull()
    expect(NULL_TRACE.causationId).toBeNull()
  })

  it('T-2: NULL_CONTEXT 提供合法 envelope（producer = unknown）', () => {
    const env = NULL_CONTEXT.envelope.create({ type: 'test.event', payload: {} })
    expect(env.producer).toBe('unknown') // 兜底 producer
    expect(env.producerVersion).toBe('0.0.0')
  })

  it('T-3: NULL_CONTEXT.eventBus === null（兜底）', () => {
    expect(NULL_CONTEXT.eventBus).toBeNull()
  })

  it('T-4: NULL_CONTEXT.logger 提供全部方法（no-throw）', () => {
    expect(() => NULL_CONTEXT.logger.info('x')).not.toThrow()
    expect(() => NULL_CONTEXT.logger.warn('x')).not.toThrow()
    expect(() => NULL_CONTEXT.logger.error('x')).not.toThrow()
    expect(() => NULL_CONTEXT.logger.debug('x')).not.toThrow()
    expect(() => NULL_CONTEXT.logger.trace('x')).not.toThrow()
    expect(() => NULL_CONTEXT.logger.fatal('x')).not.toThrow()
  })
})

// ============================================================================
// handlerAcceptsCtx + invokeHandler
// ============================================================================

describe('handlerAcceptsCtx', () => {
  it('A-1: 单参 handler → 不接受 ctx', () => {
    const v1 = (_args: unknown) => Promise.resolve({ content: [] })
    expect(handlerAcceptsCtx(v1)).toBe(false)
  })

  it('A-2: 双参 handler → 接受 ctx', () => {
    const v2 = (_args: unknown, _ctx: unknown) => Promise.resolve({ content: [] })
    expect(handlerAcceptsCtx(v2)).toBe(true)
  })

  it('A-3: 0 参 handler → 不接受 ctx', () => {
    const v0 = () => Promise.resolve({ content: [] })
    expect(handlerAcceptsCtx(v0)).toBe(false)
  })
})

describe('invokeHandler', () => {
  it('I-1: V1 handler 单参调用，ctx 被忽略', async () => {
    const v1 = async (args: { role: string }) => ({ content: [{ type: 'text', text: args.role }] })
    const result = (await invokeHandler(v1, { role: 'luban' }, NULL_CONTEXT)) as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toBe('luban')
  })

  it('I-2: V2 handler (args, ctx) → 拿到 ctx', async () => {
    const seenCtx: ToolContext[] = []
    const v2 = async (args: { x: number }, ctx: ToolContext) => {
      seenCtx.push(ctx)
      return { content: [{ type: 'text', text: `${args.x}-${ctx.trace.sessionId}` }] } satisfies ToolResponse
    }
    const customCtx: ToolContext = { ...NULL_CONTEXT, trace: { ...NULL_TRACE, sessionId: 'S42' } }
    const result = (await invokeHandler(v2, { x: 7 }, customCtx)) as { content: Array<{ text: string }> }
    expect(result.content[0]!.text).toBe('7-S42')
    expect(seenCtx[0]).toBe(customCtx)
  })

  it('I-3: V2 handler 抛错能传播到 caller', async () => {
    const v2 = async () => { throw new Error('boom') }
    await expect(invokeHandler(v2, {}, NULL_CONTEXT)).rejects.toThrow('boom')
  })

  it('I-4: V1 handler 抛错能传播到 caller', async () => {
    const v1 = async () => { throw new Error('old-boom') }
    await expect(invokeHandler(v1, {}, NULL_CONTEXT)).rejects.toThrow('old-boom')
  })
})