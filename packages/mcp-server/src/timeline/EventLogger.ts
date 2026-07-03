/**
 * EventLogger - SystemBus 事件 → EventLog 接线器
 *
 * 唯一职责：把 SystemBus 的事件转发给 EventLog.append。
 * 默认 filter 跳过高频 `text_delta`（每个 token 一次），避免撑爆 db。
 *
 * 用法：
 * ```ts
 * const detach = attachEventLogger(runtime, getEventLog())
 * // ... 应用退出前
 * detach()
 * await getEventLog().close()
 * ```
 */

import type { EventLog, MinimalSystemEvent } from './EventLog.js'
import { createLogger } from '@promptx/logger'

const logger = createLogger()

/** 默认白名单：跳过 text_delta（每 token 一次，太密） */
const DEFAULT_FILTER = new Set<string>([
  'user_message',
  'message_stop',
  'tool_use_content_block_start',
  'tool_result',
  'text_content_block_start',
  'text_content_block_stop',
  'image_create_request',
  'image_create_response',
])

/** 任何有 onAny 方法的对象都可作为 bus（兼容 Runtime / SystemBusImpl） */
export interface EventSource {
  onAny(handler: (event: MinimalSystemEvent) => void): () => void
}

export interface AttachOptions {
  /** 自定义白名单；不传则用 DEFAULT_FILTER */
  filter?: Set<string>
  /** false = 收所有事件（注意：text_delta 高频） */
  useDefaultFilter?: boolean
}

export function attachEventLogger(
  bus: EventSource,
  log: EventLog,
  options: AttachOptions = {},
): () => void {
  const useDefault = options.useDefaultFilter !== false
  const filter = options.filter ?? (useDefault ? DEFAULT_FILTER : undefined)

  const handler = (event: MinimalSystemEvent) => {
    if (filter && !filter.has(event.type)) return
    // fire-and-forget，append 内部已 try/catch
    void log.append(event)
  }

  const unsubscribe = bus.onAny(handler)
  logger.info('[EventLogger] attached', {
    filterSize: filter?.size ?? 'none',
    useDefaultFilter: useDefault,
  })

  // 返回 unsubscribe 闭包，调用方负责在 stop 时触发
  return () => {
    try {
      unsubscribe()
      logger.info('[EventLogger] detached')
    } catch (err) {
      logger.warn('[EventLogger] detach failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
