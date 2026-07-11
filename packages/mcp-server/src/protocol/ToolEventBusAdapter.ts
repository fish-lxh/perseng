/**
 * ToolEventBusAdapter — 把 @promptx/events InProcessEventBus 适配到 ToolEventBus interface
 *
 * KNUTH-FEAT 2026-07-11 (批次 2 / RFC 目标 3.5)
 *
 * 桥接：
 * - InProcessEventBus.subscribe(type, h) — type='*' 捕获全部
 * - ToolEventBus.on(type, h) / onAny(h) / onProducer(producer, h)
 *
 * 用途：PersengMCPServer._injectEventBus() 在 setEventBus 时，
 *       若 bus 有 subscribe 而 ToolEventBus interface 也扩展了 on/onAny/onProducer，
 *       可以直接 cast 而无需 adapter。此 adapter 主要是测试 / 自定义 bus 的便利。
 */

import type { ToolEventBus } from '~/interfaces/MCPServer.js'

/**
 * 最小 subscribe 风格：只要求 subscribe(type, handler) 返回 unsubscribe。
 * InProcessEventBus、mitt 都满足。
 */
export interface SubscribableBus {
  subscribe(type: string, handler: (e: Record<string, unknown>) => void): () => void
}

/**
 * 把任意 SubscribableBus 包装为完整 ToolEventBus interface。
 */
export function adaptToolEventBus(bus: SubscribableBus): ToolEventBus {
  return {
    emit: (env) => {
      // SubscribableBus 不暴露 emit — 调用方应保留原 emit 调用
      // 此适配器专注订阅，emit 走 undefined（调用方应直接拿原 bus emit）
      void env
      throw new Error(
        '[ToolEventBusAdapter] emit() not available — use the underlying bus.emit() directly, or pass an object with both emit and subscribe.',
      )
    },
    on: (type, handler) => bus.subscribe(type, handler),
    onAny: (handler) => bus.subscribe('*', handler),
    onProducer: (producer, handler) => {
      const filter = (env: Record<string, unknown>) => {
        if (env['producer'] === producer) handler(env)
      }
      return bus.subscribe('*', filter)
    },
  }
}

/**
 * 完整 adapter：接收 { emit, subscribe } 两方法的最小对象（InProcessEventBus 满足）。
 */
export function fullToolEventBusAdapter(bus: {
  emit: (e: Record<string, unknown>) => void | Promise<void>
  subscribe: (type: string, h: (e: Record<string, unknown>) => void) => () => void
}): ToolEventBus {
  return {
    emit: (env) => bus.emit(env),
    on: (type, handler) => bus.subscribe(type, handler),
    onAny: (handler) => bus.subscribe('*', handler),
    onProducer: (producer, handler) => {
      const filter = (env: Record<string, unknown>) => {
        if (env['producer'] === producer) handler(env)
      }
      return bus.subscribe('*', filter)
    },
  }
}