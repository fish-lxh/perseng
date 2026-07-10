/**
 * safeEmit — 单测
 *
 * 不变量：
 * - I-Safe-1: bus=null → no-op (不调用任何东西、不抛)
 * - I-Safe-2: PERSENG_EVENTS_ENABLED=false → no-op
 * - I-Safe-3: bus.sync emit 抛错 → caller 不感知 (warn 不抛)
 * - I-Safe-4: bus.async emit (Promise reject) → caller 不感知
 * - I-Safe-5: 正常 envelope 形状直通 bus.emit
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { safeEmit, isMcpEmitEnabled } from '../_emit.js'

let originalEnabled: string | undefined

beforeEach(() => {
  originalEnabled = process.env['PERSENG_EVENTS_ENABLED']
  delete process.env['PERSENG_EVENTS_ENABLED']
})

afterEach(() => {
  if (originalEnabled !== undefined) process.env['PERSENG_EVENTS_ENABLED'] = originalEnabled
  else delete process.env['PERSENG_EVENTS_ENABLED']
})

describe('safeEmit', () => {
  it('I-Safe-1: bus=null is no-op', () => {
    expect(() => safeEmit(null, { type: 'test', foo: 'bar' })).not.toThrow()
    expect(() => safeEmit(undefined, { type: 'test', foo: 'bar' })).not.toThrow()
  })

  it('I-Safe-2: PERSENG_EVENTS_ENABLED=false short-circuits', () => {
    process.env['PERSENG_EVENTS_ENABLED'] = 'false'
    let called = false
    const bus = { emit: () => { called = true } }
    safeEmit(bus, { type: 'test' })
    expect(called).toBe(false)
  })

  it('I-Safe-3: sync bus.emit throw does not propagate', () => {
    let called = false
    const bus = { emit: () => { called = true; throw new Error('sync boom') } }
    expect(() => safeEmit(bus, { type: 'test' })).not.toThrow()
    // bus.emit 仍被调了 — 但 throw 被 swallow
    expect(called).toBe(true)
  })

  it('I-Safe-4: async bus.emit (Promise reject) does not propagate', async () => {
    let called = false
    const bus = { emit: () => { called = true; return Promise.reject(new Error('async boom')) } }
    safeEmit(bus, { type: 'test' })
    expect(called).toBe(true)
    // microtask flush
    await new Promise((r) => setTimeout(r, 30))
    // 测试仅验证不抛；具体 reject 处理是 catch 链
  })

  it('I-Safe-5: normal envelope passes through to bus.emit', () => {
    let captured: Record<string, unknown> | null = null
    const bus = { emit: (env: Record<string, unknown>) => { captured = env } }
    const env = { type: 'action.activate', ts: 123, producer: 'tool:action', payload: { role: 'nuwa' } }
    safeEmit(bus, env)
    expect(captured).toEqual(env)
  })

  it('isMcpEmitEnabled respects env', () => {
    expect(isMcpEmitEnabled()).toBe(true)
    process.env['PERSENG_EVENTS_ENABLED'] = 'false'
    expect(isMcpEmitEnabled()).toBe(false)
    process.env['PERSENG_EVENTS_ENABLED'] = '1'
    expect(isMcpEmitEnabled()).toBe(true)
    process.env['PERSENG_EVENTS_ENABLED'] = 'FALSE'
    expect(isMcpEmitEnabled()).toBe(false)
    process.env['PERSENG_EVENTS_ENABLED'] = '0'
    expect(isMcpEmitEnabled()).toBe(false)
  })
})
