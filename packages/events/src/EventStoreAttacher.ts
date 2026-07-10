/**
 * EventStoreAttacher — 把 SystemBus 风格的事件源桥接到 EventStore
 *
 * 与 legacy timeline 的 EventLogger 完全同形：
 * - 优先 EventSource.onAny（full capture）
 * - 否则走 per-type EventSource.on
 * - 可选类型过滤（allow-list）
 *
 * 不引入默认过滤 — Producer 控制自己 emit 哪些类型。
 */

import type { EventStore } from './EventStore.js'
import type { EventSource, MinimalSystemEvent } from './types.js'

const PRODUCER_DEFAULT = 'runtime:agentx'
const PRODUCER_VERSION_DEFAULT = 'unknown'

/**
 * 把 type 从 'foo.bar' 提升到 envelope-friendly 的字符串（保持原样）。
 * 这里把 MinimalSystemEvent 投影到 EventEnvelope；producer/producerVersion
 * 由 attacher 默认填。
 */
function project(envelope: EventSourceAttachedEnvelope, ev: MinimalSystemEvent): void {
  envelope.type = ev.type
  envelope.ts = ev.timestamp
  envelope.context = ev.context ?? null
  envelope.payload = ev.data ?? null
}

interface EventSourceAttachedEnvelope {
  type: string
  ts: number
  context: MinimalSystemEvent['context'] | null
  payload: unknown
  role?: string
  producer: string
  producerVersion: string
  schemaVersion: number
  causation?: undefined
  tenantId?: null
  ownerId?: null
}

export interface AttachOptions {
  /** 类型 allow-list（不在的过滤掉） */
  filter?: Set<string>
  /** 自定义 producer 标识（默认 'runtime:agentx'） */
  producer?: string
  /** 自定义 producer version */
  producerVersion?: string
}

/**
 * 订阅一个 EventSource 并把每个 event 写入 store。
 * 返回 unsubscribe 闭包。
 *
 * source 必填；store 可选（store 缺失时 attacher 退化为"啥也不做"，仍能 unsubscribe）。
 */
export function attachEventStore(
  source: EventSource,
  store: EventStore | null,
  options: AttachOptions = {},
): () => void {
  const filter = options.filter
  const producer = options.producer ?? PRODUCER_DEFAULT
  const producerVersion = options.producerVersion ?? PRODUCER_VERSION_DEFAULT

  const shouldKeep = (type: string): boolean => {
    if (!filter) return true
    if (filter.has(type)) return true
    return false
  }

  const handler = (ev: MinimalSystemEvent): void => {
    if (!shouldKeep(ev.type)) return
    const envelope: EventSourceAttachedEnvelope = {
      type: '',
      ts: 0,
      context: null,
      payload: null,
      producer,
      producerVersion,
      schemaVersion: 1,
      role: 'system',
    }
    project(envelope, ev)
    if (store) {
      void store.append(envelope as unknown as import('./types.js').EventEnvelope).catch(() => {
        /* store 已经 warn */
      })
    }
  }

  let unsubscribe: () => void = () => undefined
  if (source.onAny) {
    unsubscribe = source.onAny(handler)
  } else if (source.on) {
    // per-type 模式 — 没指定 filter 时全部订阅；指定 filter 时只订阅 allow-list 内
    const types = filter ? Array.from(filter) : []
    const unsubs: Array<() => void> = []
    if (types.length === 0 && !source.onAny) {
      // 没有 onAny 也没有 filter — 我们不知道有什么事件，attach 退化为 no-op
      return () => undefined
    }
    for (const t of types) {
      const u = source.on(t, handler)
      unsubs.push(u)
    }
    unsubscribe = () => {
      for (const u of unsubs) u()
    }
  }
  return unsubscribe
}
