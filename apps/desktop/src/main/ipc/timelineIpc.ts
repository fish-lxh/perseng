/**
 * timeline:* IPC handlers (3 channels: query / clear / statistics).
 *
 * Extracted from PersengDesktopApp.setupTimelineIPC (P0 step 2.1b). Bridges
 * the @promptx/mcp-server/timeline event log to the renderer. Channel names
 * preserved verbatim.
 */

import { ipcMain } from 'electron'
import * as logger from '@promptx/logger'
import { getEventLog } from '@promptx/mcp-server/timeline'

// Module-level guard mirrors the original `(this as any)._timelineIpcRegistered`
// pattern in PersengDesktopApp. Idempotent registration.
let registered = false

export function registerTimelineIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('timeline:query', async (_event, filter: any = {}) => {
    try {
      const log = getEventLog()
      const limit = filter.limit ?? 50
      const rows = await log.query(filter)
      const total = await log.count({
        sessionId: filter.sessionId,
        agentId: filter.agentId,
        imageId: filter.imageId,
        types: filter.types,
        roles: filter.roles,
        sinceTs: filter.sinceTs,
        untilTs: filter.untilTs,
      })
      const nextCursor =
        rows.length === limit && rows.length > 0 ? rows[rows.length - 1].id : null
      return { success: true, events: rows, total, nextCursor }
    } catch (error) {
      logger.error('Failed to query timeline:', String(error))
      return { success: false, error: String(error), events: [], total: 0, nextCursor: null }
    }
  })

  ipcMain.handle('timeline:clear', async (_event, filter: { scope?: 'all' | 'session' | 'agent' | 'image'; targetId?: string } = {}) => {
    try {
      const log = getEventLog()
      const result = await log.clear(filter)
      logger.info(`[timeline:clear] deleted ${result.deleted} events (scope=${filter.scope ?? 'all'})`)
      return { success: true, ...result }
    } catch (error) {
      logger.error('Failed to clear timeline:', String(error))
      return { success: false, error: String(error), deleted: 0 }
    }
  })

  ipcMain.handle('timeline:statistics', async () => {
    try {
      const log = getEventLog()
      return await log.getStatistics()
    } catch (error) {
      logger.error('Failed to get timeline statistics:', String(error))
      return { totalEvents: 0, dbPath: '' }
    }
  })
}