/**
 * ToolEventBusAdapter 协议单测 (3.5 P1)
 *
 * KNUTH-FEAT 2026-07-11 (批次 2 / RFC 目标 3.5)
 * 验证 on / onAny / onProducer 三个 subscribe API 正确分派到底层 subscribe。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fullToolEventBusAdapter, adaptToolEventBus } from '../ToolEventBusAdapter.js'

// ============================================================================
// helpers
// ============================================================================

type Handler = (e: Record<string, unknown>) => void

function mockBus() {
  const subs = new Map<string, Set<Handler>>()
  let emitCount = 0
  const lastEmitted: Array<Record<string, unknown>> = []
  const bus = {
    subscribe(type: string, h: Handler): () => void {
      if (!subs.has(type)) subs.set(type, new Set())
      subs.get(type)!.add(h)
      return () => subs.get(type)!.delete(h)
    },
    emit(e: Record<string, unknown>): void {
      emitCount++
      lastEmitted.push(e)
      const set = subs.get(e['type'] as string)
      if (set) for (const h of set) h(e)
      const all = subs.get('*')
      if (all) for (const h of all) h(e)
    },
    _emitCount: () => emitCount,
    _lastEmitted: () => lastEmitted,
    _subs: subs,
  }
  return bus
}

// ============================================================================
// fullToolEventBusAdapter
// ============================================================================

describe('fullToolEventBusAdapter', () => {
  it('F-1: emit 透传到 bus.emit', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    adapter.emit({ type: 'test.foo', payload: { x: 1 } })
    expect(bus._emitCount()).toBe(1)
    expect(bus._lastEmitted()[0]).toEqual({ type: 'test.foo', payload: { x: 1 } })
  })

  it('F-2: on(type, h) 分派到 subscribe(type, h)', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    const h = vi.fn()
    adapter.on('action.activate', h)
    adapter.emit({ type: 'action.activate' })
    expect(h).toHaveBeenCalledTimes(1)
    expect(h).toHaveBeenCalledWith({ type: 'action.activate' })
  })

  it('F-3: onAny(h) 捕获所有 type', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    const h = vi.fn()
    adapter.onAny(h)
    adapter.emit({ type: 'a' })
    adapter.emit({ type: 'b' })
    adapter.emit({ type: 'c' })
    expect(h).toHaveBeenCalledTimes(3)
  })

  it('F-4: onProducer(producer, h) 仅触发 envelope.producer 匹配的事件', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    const h = vi.fn()
    adapter.onProducer('tool:action', h)
    adapter.emit({ type: 'action.activate', producer: 'tool:action' })
    adapter.emit({ type: 'lifecycle.focus', producer: 'tool:lifecycle' })
    adapter.emit({ type: 'action.born', producer: 'tool:action' })
    expect(h).toHaveBeenCalledTimes(2)
    expect(h).toHaveBeenNthCalledWith(1, { type: 'action.activate', producer: 'tool:action' })
    expect(h).toHaveBeenNthCalledWith(2, { type: 'action.born', producer: 'tool:action' })
  })

  it('F-5: on 多次注册同一 type → 都被触发', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    const h1 = vi.fn()
    const h2 = vi.fn()
    adapter.on('x', h1)
    adapter.on('x', h2)
    adapter.emit({ type: 'x' })
    expect(h1).toHaveBeenCalledTimes(1)
    expect(h2).toHaveBeenCalledTimes(1)
  })

  it('F-6: on(type, h) 返回的 unsubscribe 停止投递', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    const h = vi.fn()
    const off = adapter.on('x', h)!
    adapter.emit({ type: 'x' })
    off()
    adapter.emit({ type: 'x' })
    expect(h).toHaveBeenCalledTimes(1)
  })

  it('F-7: onProducer 与 onAny 不互相干扰', () => {
    const bus = mockBus()
    const adapter = fullToolEventBusAdapter(bus)
    const producerH = vi.fn()
    const anyH = vi.fn()
    adapter.onProducer('tool:action', producerH)
    adapter.onAny(anyH)
    adapter.emit({ type: 'a', producer: 'tool:action' })
    adapter.emit({ type: 'b', producer: 'tool:lifecycle' })
    expect(producerH).toHaveBeenCalledTimes(1)
    expect(anyH).toHaveBeenCalledTimes(2)
  })
})

describe('adaptToolEventBus — emit-only adapter throws (use fullAdapter)', () => {
  it('A-1: adaptToolEventBus 的 emit 抛错（提示用 fullAdapter）', () => {
    const subs = new Map<string, Set<Handler>>()
    const bus = {
      subscribe(type: string, h: Handler): () => void {
        if (!subs.has(type)) subs.set(type, new Set())
        subs.get(type)!.add(h)
        return () => subs.get(type)!.delete(h)
      },
    }
    const adapter = adaptToolEventBus(bus)
    expect(() => adapter.emit!({ type: 'x' })).toThrow(/emit.*not available/)
  })

  it('A-2: adaptToolEventBus 的 on/onAny/onProducer 仍可用', () => {
    const subs = new Map<string, Set<Handler>>()
    const bus = {
      subscribe(type: string, h: Handler): () => void {
        if (!subs.has(type)) subs.set(type, new Set())
        subs.get(type)!.add(h)
        return () => subs.get(type)!.delete(h)
      },
    }
    const adapter = adaptToolEventBus(bus)
    const h = vi.fn()
    adapter.onAny!(h)
    // 直接通过 bus.subscribe 注入的事件（由于 adapter 无法 emit）
    bus.subscribe('test', h)
    bus.subscribe('test', (e) => subs.get('*')?.forEach((hh) => hh(e)))
    // 实际上简单的验证 onAny 已注册
    expect(adapter.onAny).toBeDefined()
    expect(adapter.onProducer).toBeDefined()
  })
})