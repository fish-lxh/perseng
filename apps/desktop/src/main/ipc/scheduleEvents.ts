/**
 * scheduleEvents.ts — 主进程订阅 MCP schedule.* 事件并推送给 settings-window
 *
 * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 9)
 *
 * 设计要点：
 *  - 主进程拿 MCP server 的 ToolEventBus，订阅所有 schedule.* 事件
 *  - 推到所有 BrowserWindow 的 webContents（settings-window 监听 schedule:event channel）
 *  - 失败 / 暂停 / 失败模式 → toast 告警
 *  - 不阻塞主流程：fire-and-forget 订阅
 */

import { BrowserWindow } from 'electron'
import * as logger from '@promptx/logger'
import type { PersengServerAdapter } from '~/main/infrastructure/adapters/PersengServerAdapter'

const SCHEDULE_EVENT_CHANNEL = 'schedule:event'

interface ScheduleEventEnvelope {
  type: string
  ts: number
  role?: string
  producer?: string
  schemaVersion?: number
  payload?: Record<string, unknown>
}

interface ToolEventBusLike {
  emit?: (env: Record<string, unknown>) => void | Promise<void>
  on?: (type: string, handler: (env: Record<string, unknown>) => void) => () => void
  onAny?: (handler: (env: Record<string, unknown>) => void) => () => void
  onProducer?: (producer: string, handler: (env: Record<string, unknown>) => void) => () => void
}

export interface ScheduleEventsDeps {
  getServerPort(): PersengServerAdapter | null
}

let subscribed = false
let unsubscribeFns: Array<() => void> = []

/** 测试钩子 */
export function _resetScheduleEventsSubscription(): void {
  for (const u of unsubscribeFns) {
    try {
      u()
    } catch {
      /* ignore */
    }
  }
  unsubscribeFns = []
  subscribed = false
}

/** 推送到所有 BrowserWindow */
function broadcastToRenderers(env: ScheduleEventEnvelope): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(SCHEDULE_EVENT_CHANNEL, env)
    } catch (err) {
      logger.debug(
        `[scheduleEvents] broadcast failed for window: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/**
 * 订阅 MCP EventBus 上的 schedule.* 事件。
 * - schedule.triggered / succeeded / failed / paused / retried → 直接广播
 * - schedule.failure_pattern_detected → 广播（renderer 端 toast 决定提示文案）
 */
export function registerScheduleEvents(deps: ScheduleEventsDeps): void {
  if (subscribed) return

  const port = deps.getServerPort()
  if (!port) {
    logger.warn('[scheduleEvents] server port unavailable, subscription deferred')
    return
  }
  const bus = port.getEventBus() as ToolEventBusLike | null
  if (!bus) {
    logger.warn('[scheduleEvents] EventBus unavailable, cannot subscribe')
    return
  }

  subscribed = true

  // 优先用 onAny — 一刀切监听所有事件，过滤 type 前缀
  if (typeof bus.onAny === 'function') {
    const u = bus.onAny((env) => {
      const type = String((env as Record<string, unknown>)['type'] ?? '')
      if (type.startsWith('schedule.')) {
        broadcastToRenderers(env as unknown as ScheduleEventEnvelope)
      }
    })
    if (typeof u === 'function') unsubscribeFns.push(u)
    logger.info('[scheduleEvents] subscribed via onAny')
    return
  }

  // 退而求其次：枚举订阅
  const KNOWN_TYPES = [
    'schedule.triggered',
    'schedule.succeeded',
    'schedule.failed',
    'schedule.paused',
    'schedule.retried',
    'schedule.dry_run_passed',
    'schedule.dry_run_failed',
    'schedule.failure_pattern_detected',
    'schedule.parse_natural_language_succeeded',
    'schedule.parse_natural_language_failed',
  ]
  if (typeof bus.on === 'function') {
    for (const type of KNOWN_TYPES) {
      const u = bus.on(type, (env) => {
        broadcastToRenderers(env as unknown as ScheduleEventEnvelope)
      })
      if (typeof u === 'function') unsubscribeFns.push(u)
    }
    logger.info(`[scheduleEvents] subscribed via on() to ${KNOWN_TYPES.length} types`)
    return
  }

  logger.warn('[scheduleEvents] bus has no on/onAny method, falling back to emit-only')
}