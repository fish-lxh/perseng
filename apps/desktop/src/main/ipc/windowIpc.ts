/**
 * window:* IPC handlers (4 channels: minimize / maximize-toggle / close /
 * is-maximized).
 *
 * Extracted from PersengDesktopApp.setupShellIPC (P0 step 2.1b) — the window
 * controls were colocated with shell:openExternal historically; this split
 * follows the channel naming convention. Channel names preserved.
 */

import { ipcMain, BrowserWindow } from 'electron'

export function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.minimize()
  })

  ipcMain.handle('window:maximize-toggle', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return { isMaximized: false }
    }

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }

    return { isMaximized: window.isMaximized() }
  })

  ipcMain.handle('window:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.close()
  })

  ipcMain.handle('window:is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window?.isMaximized() ?? false
  })
}