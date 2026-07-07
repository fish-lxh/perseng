/**
 * check-for-updates / app:relaunch IPC handlers.
 *
 * Extracted from PersengDesktopApp.setupUpdateIPC (P0 step 2.1c). The
 * UpdateManager is created later in initialize() so we surface it as a
 * getter; the app:relaunch handler needs no deps. Channel names preserved.
 */

import { ipcMain, app, BrowserWindow } from 'electron'
import type { UpdateManager } from '~/main/application/UpdateManager'

export interface UpdateIpcDeps {
  /**
   * Returns the live UpdateManager (or null until setupApplication has wired
   * it up). The check-for-updates handler guards on null and throws.
   */
  getUpdateManager: () => UpdateManager | null
}

export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  // 检查更新
  ipcMain.handle('check-for-updates', async () => {
    const updateManager = deps.getUpdateManager()
    if (!updateManager) {
      throw new Error('Update manager not initialized')
    }
    await updateManager.checkForUpdatesManual()
    return { success: true }
  })

  // 重启应用
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    // 先隐藏所有窗口，避免白屏闪烁
    BrowserWindow.getAllWindows().forEach(w => w.hide())
    app.exit(0)
  })
}