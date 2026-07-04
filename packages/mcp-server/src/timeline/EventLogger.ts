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

/**
 * 任何能订阅 SystemBus 事件的对象都可作为 bus。
 * 兼容两种风格：
 *   - Runtime / SystemBusImpl：原生 `onAny`（订阅所有事件，一次性）
 *   - agentxjs client：仅暴露 `on(type, handler)`（订阅单 type，回调会被附加过滤）
 *
 * KNUTH-FEAT 2026-07-04: 增加 on() 回退路径，修复 desktop AgentXService
 * 调用 attachEventLogger(this.agentx, ...) 抛 TypeError 的 bug（AgentX
 * 公开面没有 onAny）。见 timeline 0 事件排查。
 */
export interface EventSource {
  onAny?: (handler: (event: MinimalSystemEvent) => void) => () => void
  on?: (type: string, handler: (event: MinimalSystemEvent) => void) => () => void
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

  // KNUTH-FEAT 2026-07-04: 兼容两种 bus 风格。
  // 1) Runtime/SystemBusImpl 有 onAny（一次性订阅全部 + 客户端再过滤）—— 优先
  // 2) agentxjs client 只有 on(type)（按 type 订阅）—— 回退，需要订阅白名单里每个 type
  const mode = pickAttachMode(bus, filter, handler)
  const unsubscribe = mode.unsubscribe
  logger.info(
    `[EventLogger] attached mode=${mode.kind} filterSize=${filter?.size ?? 'none'} useDefaultFilter=${useDefault}`,
  )

  // 返回 unsubscribe 闭包，调用方负责在 stop 时触发
  return () => {
    try {
      unsubscribe()
      logger.info('[EventLogger] detached')
    } catch (err) {
      logger.warn(`[EventLogger] detach failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * 选择 bus 订阅方式。
 * - 优先 onAny（Runtime/SystemBusImpl 原生）：一次订阅 + 客户端过滤
 * - 回退 on(type)（agentxjs client）：每个白名单 type 单独订阅
 *
 * KNUTH-FEAT 2026-07-04: agentxjs client 公开面无 onAny，需逐 type 订阅。
 */
function pickAttachMode(
  bus: EventSource,
  filter: Set<string> | undefined,
  handler: (event: MinimalSystemEvent) => void,
): { kind: 'onAny' | 'on-per-type'; unsubscribe: () => void } {
  const anyBus = bus as unknown as {
    onAny?: (h: typeof handler) => () => void
    on?: (t: string, h: typeof handler) => () => void
  }

  if (typeof anyBus.onAny === 'function') {
    return {
      kind: 'onAny',
      unsubscribe: anyBus.onAny(handler),
    }
  }

  if (typeof anyBus.on === 'function' && filter && filter.size > 0) {
    const unsubs: Array<(() => void) | undefined> = []
    for (const type of filter) {
      try {
        unsubs.push(anyBus.on(type, handler))
      } catch (err) {
        logger.warn(
          `[EventLogger] failed to subscribe type ${type}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    return {
      kind: 'on-per-type',
      unsubscribe: () => {
        for (const u of unsubs) {
          try {
            u?.()
          } catch {
            /* 单个 unsubscribe 失败不影响其他 */
          }
        }
      },
    }
  }

  throw new Error(
    '[EventLogger] bus must implement onAny() or on(); got neither. ' +
      `onAny=${typeof anyBus.onAny}, on=${typeof anyBus.on}, filterSize=${filter?.size ?? 0}`,
  )
}
