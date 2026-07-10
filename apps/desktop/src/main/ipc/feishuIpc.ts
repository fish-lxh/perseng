/**
 * feishu:* IPC handlers (6 channels: getConfig / saveConfig / start / stop /
 * status / remove).
 *
 * Extracted from PersengDesktopApp.setupFeishuIPC (P0 step 2.1c). The Feishu
 * manager owns long-lived state (websocket connection, saved config) and is
 * fully encapsulated here — nothing outside this module touches it. The
 * `restore()` reconnect attempt fires after handler registration to mirror
 * the original ordering. Channel names preserved.
 */

import { ipcMain, app } from 'electron'
import { FeishuManager } from '@promptx/feishu-desktop'
import { agentXService } from '~/main/services/AgentXService'

export function registerFeishuIpc(): void {
  const dataDir = app.getPath('userData')
  const feishuManager = new FeishuManager(dataDir, agentXService.getPort())

  ipcMain.handle('feishu:getConfig', async () => {
    const saved = feishuManager.loadConfig()
    if (saved?.feishu) {
      return saved.feishu
    }
    return null
  })

  ipcMain.handle('feishu:saveConfig', async (_, config: any) => {
    try {
      feishuManager.saveConfig(config, { name: 'Perseng' })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('feishu:start', async (_, feishuConfig: any, roleConfig?: any) => {
    try {
      const role = roleConfig || { name: 'Perseng' }
      await feishuManager.start(feishuConfig, role)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('feishu:stop', async () => {
    try {
      await feishuManager.stop()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('feishu:status', async () => {
    return feishuManager.getStatus()
  })

  ipcMain.handle('feishu:remove', async () => {
    try {
      await feishuManager.remove()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 尝试恢复已保存的飞书连接
  feishuManager.restore().catch(() => {})
}