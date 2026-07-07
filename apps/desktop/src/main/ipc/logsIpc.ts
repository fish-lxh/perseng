/**
 * logs:* IPC handlers (4 channels: list / read / delete / clear).
 *
 * Extracted from PersengDesktopApp.setupLogsIPC (P0 step 2.1a). Pure
 * filesystem helpers — no injected deps needed because the logs directory is
 * derived from getPersengHomeDir() (which itself handles the legacy ~/.promptx
 * → ~/.perseng migration). Channel names preserved.
 */

import { ipcMain } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as logger from '@promptx/logger'
import { getPersengHomeDir } from '~/main/utils/persengPaths'

export function registerLogsIpc(): void {
  // 用户数据目录已迁移到 ~/.perseng;getPersengHomeDir() 内部优先读新路径,旧路径作为兜底兼容
  const logsDir = path.join(getPersengHomeDir(), 'logs')

  // 获取日志文件列表
  ipcMain.handle('logs:list', async () => {
    try {
      if (!fs.existsSync(logsDir)) {
        return { success: true, logs: [] }
      }

      const files = fs.readdirSync(logsDir)
      const logs = files
        .filter(file => file.startsWith('perseng-') && file.endsWith('.log'))
        .map(file => {
          const filePath = path.join(logsDir, file)
          try {
            const stats = fs.statSync(filePath)
            const isError = file.includes('error')

            return {
              name: file,
              path: filePath,
              size: stats.size,
              modified: stats.mtime,
              type: isError ? 'error' : 'normal'
            }
          } catch {
            // 文件可能在读取期间被删除或锁定，跳过
            return null
          }
        })
        .filter((log): log is NonNullable<typeof log> => log !== null)
        .sort((a, b) => b.modified.getTime() - a.modified.getTime())

      return { success: true, logs }
    } catch (error) {
      logger.error('Failed to list logs:', String(error))
      return { success: false, error: String(error) }
    }
  })

  // 读取日志文件内容
  ipcMain.handle('logs:read', async (_event, filename: string) => {
    try {
      const filePath = path.join(logsDir, filename)

      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Log file not found' }
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      logger.error('Failed to read log:', String(error))
      return { success: false, error: String(error) }
    }
  })

  // 删除日志文件
  ipcMain.handle('logs:delete', async (_event, filename: string) => {
    try {
      const filePath = path.join(logsDir, filename)

      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Log file not found' }
      }

      fs.unlinkSync(filePath)
      logger.info(`Log file deleted: ${filename}`)
      return { success: true }
    } catch (error) {
      logger.error('Failed to delete log:', String(error))
      return { success: false, error: String(error) }
    }
  })

  // 清空所有日志
  ipcMain.handle('logs:clear', async () => {
    try {
      if (!fs.existsSync(logsDir)) {
        return { success: true, deleted: 0 }
      }

      const files = fs.readdirSync(logsDir)
      let deleted = 0
      let skipped = 0

      for (const file of files) {
        if (file.startsWith('perseng-') && file.endsWith('.log')) {
          const filePath = path.join(logsDir, file)
          try {
            fs.unlinkSync(filePath)
            deleted++
          } catch {
            // 文件可能被锁定（如当前正在写入的日志），跳过
            skipped++
          }
        }
      }

      if (deleted > 0 || skipped === 0) {
        logger.info(`Cleared ${deleted} log files${skipped > 0 ? `, ${skipped} skipped (in use)` : ''}`)
      }
      return { success: true, deleted }
    } catch (error) {
      logger.error('Failed to clear logs:', String(error))
      return { success: false, error: String(error) }
    }
  })
}