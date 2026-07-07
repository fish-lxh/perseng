/**
 * dbManager:* IPC handlers (4 channels: scan / openDir / openFile / query).
 *
 * Extracted from PersengDesktopApp.setupDatabaseManagerIPC (P0 step 2.1b).
 * Read-only inspection of ~/.perseng/ sqlite + json files; the SQL console
 * route only executes single SELECT-style statements. Channel names preserved.
 */

import { ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as logger from '@promptx/logger'
import { scanPersengHome, querySqlite } from '~/main/services/DatabaseManager'
import { getPersengHomeDir } from '~/main/utils/persengPaths'

// Module-level guard mirrors the original `(this as any)._dbManagerIpcRegistered`.
let registered = false

export function registerDatabaseManagerIpc(): void {
  if (registered) return
  registered = true

  ipcMain.handle('dbManager:scan', async () => {
    try {
      const root = getPersengHomeDir()
      const items = scanPersengHome(root)
      const totals = {
        totalSize: items.reduce((s, i) => s + i.size, 0),
        dbCount: items.filter((i) => i.type === 'sqlite').length,
        jsonCount: items.filter((i) => i.type === 'json').length,
        rootDir: root,
        scannedAt: Date.now(),
      }
      return { success: true, items, totals }
    } catch (error) {
      logger.error('Failed to scan perseng home:', String(error))
      return { success: false, error: String(error), items: [], totals: null }
    }
  })

  ipcMain.handle('dbManager:openDir', async (_event, dirPath: string) => {
    try {
      if (!dirPath || !fs.existsSync(dirPath)) {
        return { success: false, error: 'Path not found' }
      }
      const { shell } = await import('electron')
      await shell.openPath(dirPath)
      return { success: true }
    } catch (error) {
      logger.error('Failed to open dir:', String(error))
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('dbManager:openFile', async (_event, filePath: string) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }
      const { shell: sh } = await import('electron')
      // showItemInFolder 在文件管理器中高亮文件
      sh.showItemInFolder(filePath)
      return { success: true }
    } catch (error) {
      logger.error('Failed to open file:', String(error))
      return { success: false, error: String(error) }
    }
  })

  // L3 SQL 控制台：只读执行单条 SQL
  ipcMain.handle('dbManager:query', async (_event, dbPath: string, sql: string) => {
    try {
      if (!dbPath || !sql?.trim()) {
        return { success: false, error: 'dbPath or sql is empty' }
      }
      const result = querySqlite(dbPath, sql)
      return { success: true, ...result }
    } catch (error: any) {
      logger.error('SQL query failed:', error?.message ?? String(error))
      return { success: false, error: error?.message ?? String(error) }
    }
  })
}