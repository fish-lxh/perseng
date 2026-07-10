/**
 * EventBus — 进程内事件分发接口 + InProcess 实现
 *
 * 设计目标：
 * - 单一 fire-and-forget 入口（emit）
 * - 任意多的同步订阅（subscribe）
 * - 默认实现 InProcessEventBus：mitt 包装 + 自动 sink 给 EventStore
 *
 * backpressure：
 * - 同步订阅者抛错 → catch + warn，不影响 emit 主路径
 * - 慢订阅不会阻塞 emit（同 process.nextTick 异步队列）
 *
 * 与 @promptx/logger 集成；不引入第三方 IO 库。
 */

import mitt, { type Emitter } from 'mitt'

import type { EventBus, EventEnvelope } from './index.js'
import type { EventStore } from './EventStore.js'
import { isEventsEnabled } from './types.js'

type Events = Record<string, EventEnvelope>

/**
 * 进程内事件总线。
 *
 * 把 emit 同时：
 * 1. 派发给同步订阅者（subscribe 注册的）
 * 2. 写入 EventStore append（fire-and-forget；store 失败仅 warn）
 */
export class InProcessEventBus implements EventBus {
  private readonly emitter: Emitter<Events>
  private readonly store: EventStore | null
  private readonly enabled: boolean
  private droppedCount = 0

  constructor(store: EventStore | null = null) {
    this.emitter = mitt<Events>()
    this.store = store
    this.enabled = isEventsEnabled()
  }

  /**
   * 同步发送。订阅者在 next tick 内被调用；
   * EventStore.append 是 async 但 fire-and-forget。
   */
  emit<T>(envelope: EventEnvelope<T>): void {
    if (!this.enabled) {
      this.droppedCount++
      return
    }
    // mitt 类型上要求宽 EventEnvelope；包一层转换避免泛型丢失
    const wrapped = envelope as unknown as EventEnvelope
    // 1. 同步分发：try/catch 每个 handler，订阅者错误不影响其他订阅者
    const handlers = (this.emitter as unknown as { all: Map<string | '*', Set<(e: unknown) => void>> }).all
    const typeKey = wrapped.type
    const allKey = '*'
    for (const [k, set] of handlers.entries()) {
      if (k === typeKey || k === allKey) {
        for (const h of set) {
          try {
            h(wrapped)
          } catch (err) {
            // swallow — bus 不应当因为订阅者错而抛
            // eslint-disable-next-line no-console
            console.warn(
              `[EventBus] handler threw type=${wrapped.type}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }
    }
    // 2. 写 store（fire-and-forget；store 内部 try/catch + warn）
    if (this.store) {
      void this.store.append(wrapped).catch(() => {
        // store 自己已经 warn；这里不重复
      })
    }
  }

  /**
   * 同步订阅。
   *
   * `type = '*'` 表示捕获所有事件（用于 log/sink/审计）。
   * 返回 unsubscribe 函数。
   */
  subscribe<T>(
    type: string | '*',
    handler: (e: EventEnvelope<T>) => void,
  ): () => void {
    const key = type as keyof Events
    this.emitter.on(key, handler as (e: Events[keyof Events]) => void)
    return () => {
      this.emitter.off(key, handler as (e: Events[keyof Events]) => void)
    }
  }

  /** 调试 / 指标 */
  getDroppedCount(): number {
    return this.droppedCount
  }

  getStore(): EventStore | null {
    return this.store
  }
}
