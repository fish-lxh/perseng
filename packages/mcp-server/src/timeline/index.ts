/**
 * @promptx/mcp-server/timeline 模块入口
 *
 * 使用：
 *   import { getEventLog, attachEventLogger } from '~/timeline/index.js'
 */

export { EventLog } from './EventLog.js'
export { attachEventLogger } from './EventLogger.js'
export { getEventLog, resetEventLog } from './instance.js'
export type {
  TimelineEventRow,
  TimelineQueryFilter,
  ClearFilter,
  ClearScope,
  EventRole,
  MinimalSystemEvent,
} from './EventLog.js'
export type { EventSource, AttachOptions } from './EventLogger.js'
