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

// KNUTH-FEAT 2026-07-10: 内容契约 M3 — 启动时 actAs 校验默认角色，
// 避免把不存在的 role 名注入到 Feishu session。
async function resolveRoleId(roleConfig?: { name?: string }): Promise<string> {
  const candidate = roleConfig?.name || 'Perseng'
  try {
    const core = await import('@promptx/core')
    const actAs = (core as any).actAs || (core.default && (core.default as any).actAs)
    if (typeof actAs === 'function') {
      const result = await actAs(candidate, { fallback: 'throw' })
      return result.identity.id
    }
  } catch (e: any) {
    throw new Error(`飞书默认角色 '${candidate}' 不存在：${e?.message || ''}`)
  }
  // actAs 不可用时退化为原行为（兼容旧版 core）
  return candidate
}

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
      // KNUTH-FEAT 2026-07-10: actAs 校验；找不到 → 拒绝启动，运营需先配置有效 role
      let roleName: string
      try {
        roleName = await resolveRoleId(roleConfig)
      } catch (e: any) {
        return { success: false, error: e?.message || '默认角色校验失败' }
      }
      const role = { ...(roleConfig || {}), name: roleName }
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