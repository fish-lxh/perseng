/**
 * dialog:* IPC handlers (2 channels: openFile / readFile).
 *
 * Extracted from PersengDesktopApp.setupDialogIPC (P0 step 2.1b). Wraps the
 * Electron native file dialog and a base64 file reader used by the role
 * resource upload path. Channel names preserved.
 */

import { ipcMain, dialog } from 'electron'
import * as logger from '@promptx/logger'

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
}

export function registerDialogIpc(): void {
  // 打开文件选择对话框
  ipcMain.handle('dialog:openFile', async (_event, options?: any) => {
    try {
      const result = await dialog.showOpenDialog(options || {})
      return result
    } catch (error) {
      logger.error('Failed to open file dialog:', String(error))
      return { canceled: true, filePaths: [] }
    }
  })

  // 读取文件内容（返回 base64）
  ipcMain.handle('dialog:readFile', async (_event, filePath: string) => {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')
      const buffer = await fs.readFile(filePath)
      const fileName = path.basename(filePath)
      // 简单的 MIME 类型检测
      const ext = path.extname(filePath).toLowerCase()
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
      return {
        success: true,
        data: buffer.toString('base64'),
        fileName,
        mimeType,
        size: buffer.length,
      }
    } catch (error) {
      logger.error('Failed to read file:', String(error))
      return { success: false, error: String(error) }
    }
  })
}