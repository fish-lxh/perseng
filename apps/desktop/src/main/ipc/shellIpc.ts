/**
 * shell:openExternal IPC handler.
 *
 * Extracted from PersengDesktopApp.setupShellIPC (P0 step 2.1b). The
 * `window:*` family was split out to its own module (windowIpc) for cleaner
 * separation of concerns; only shell-launching behavior remains here.
 * Channel names preserved.
 */

import { ipcMain } from 'electron'
import * as logger from '@promptx/logger'

export function registerShellIpc(): void {
  // 打开外部链接 - 在新的 Electron 窗口中打开
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`)
      }

      const { BrowserWindow } = await import('electron')

      // 创建新的浏览器窗口
      const browserWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
        title: 'Browser',
      })

      // 加载 URL
      await browserWindow.loadURL(parsedUrl.toString())

      logger.info('Opened URL in Electron browser window:', parsedUrl.toString())
    } catch (error) {
      logger.error('Failed to open URL in browser window:', String(error))
      throw error
    }
  })
}