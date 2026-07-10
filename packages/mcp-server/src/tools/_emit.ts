/**
 * safeEmit — MCP 工具埋事件的统一包装
 *
 * KNUTH-FEAT 2026-07-11 (M4): Runtime Event Platform 落地。
 *
 * 设计原则：
 * - 调用方不 await — fire-and-forget；事件落库延迟不阻塞 tool result
 * - 失败只 warn，绝不抛 — 事件平台不可用不该让 tool 失败
 * - env flag (`PERSENG_EVENTS_ENABLED=false`) 短路 — 紧急回退
 *
 * 用法（每个有 setEventBus 的 tool）：
 *
 *   const bus = getEventBus()
 *   await safeEmit(bus, {
 *     type: 'action.activate',
 *     producer: 'tool:action',
 *     producerVersion: PKG_VERSION,
 *     payload: { role: args.role },
 *     ...
 *   })
 */

import { createLogger } from '@promptx/logger'

const logger = createLogger()

interface MinimalEventBus {
  emit(envelope: Record<string, unknown>): void | Promise<void>
}

/**
 * 检查事件平台是否启用
 *
 * 默认 true；`PERSENG_EVENTS_ENABLED=false` 时 emit 短路。
 */
export function isMcpEmitEnabled(): boolean {
  const v = process.env['PERSENG_EVENTS_ENABLED']
  if (v === undefined || v === '' || v === '1' || v === 'true' || v === 'TRUE' || v === 'yes') return true
  if (v === '0' || v === 'false' || v === 'FALSE' || v === 'no') return false
  return v !== 'false' && v !== '0'
}

/**
 * Fire-and-forget emit. 永不抛、never await。
 *
 * @param bus  EventBus 实例 (从 setEventBus setter 注入)；为 null/undefined → no-op
 * @param envelope  V2 envelope 形状 — 见 packages/events/src/types.ts
 */
export function safeEmit(
  bus: MinimalEventBus | null | undefined,
  envelope: Record<string, unknown>,
): void {
  if (!bus) return
  if (!isMcpEmitEnabled()) return
  try {
    const result = bus.emit(envelope)
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      ;(result as Promise<unknown>).catch((err) => {
        logger.warn(
          `[safeEmit] async emit failed type=${envelope['type']}: ${err instanceof Error ? err.message : String(err)}`,
        )
      })
    }
  } catch (err) {
    logger.warn(
      `[safeEmit] sync emit threw type=${envelope['type']}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
