/**
 * server-config IPC handlers (3 channels).
 *
 * Extracted from PersengDesktopApp.setupServerConfigIPC (P0 step 2.1a) so the
 * server-config domain — host/port/enableV2 persistence and runtime apply —
 * lives in one focused module. Channel names are preserved verbatim so the
 * renderer/preload contract is unaffected.
 */

import { ipcMain } from 'electron'
import { ServerConfig } from '~/main/domain/entities/ServerConfig'
import { ServerConfigManager } from '@promptx/config'
import { IConfigPort } from '~/main/domain/ports/IConfigPort'
import { IServerPort } from '~/main/domain/ports/IServerPort'

/**
 * Deps are getters rather than values because the IPC handlers are registered
 * BEFORE the infrastructure fields are populated (see PersengDesktopApp.initialize
 * ordering) and are invoked only after init completes. This mirrors the original
 * `this.configPort` / `this.serverPort` closure-capture semantics.
 */
export interface ServerConfigIpcDeps {
  getConfigPort: () => IConfigPort | null
  getServerPort: () => IServerPort | null
}

export function registerServerConfigIpc(deps: ServerConfigIpcDeps): void {
  ipcMain.handle('server-config:get', async () => {
    const configPort = deps.getConfigPort()
    if (!configPort) {
      return ServerConfig.default().toJSON()
    }
    const res = await configPort.load()
    if (res.ok) {
      return res.value.toJSON()
    }
    // 加载失败则返回默认
    return ServerConfig.default().toJSON()
  })

  ipcMain.handle('server-config:update', async (_event, payload: { host: string; port: number; debug?: boolean; enableV2?: boolean }) => {
    const configPort = deps.getConfigPort()
    const serverPort = deps.getServerPort()
    const base = ServerConfig.default().toJSON()
    const created = ServerConfig.create({
      ...base,
      host: payload.host,
      port: payload.port,
      debug: payload.debug ?? base.debug,
      enableV2: payload.enableV2 ?? base.enableV2
    })
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const cfg = created.value
    // 持久化
    if (configPort) {
      const saveRes = await configPort.save(cfg)
      if (!saveRes.ok) {
        throw new Error(saveRes.error.message)
      }
    }
    // 同步 enableV2 到 ServerConfigManager（供 MCP server 读取）
    const scm = new ServerConfigManager()
    scm.setEnableV2(cfg.enableV2)
    // 应用配置（重启服务）
    if (serverPort) {
      const restartRes = await serverPort.restart(cfg)
      if (!restartRes.ok) {
        throw new Error(restartRes.error.message)
      }
    }
    return cfg.toJSON()
  })

  ipcMain.handle('server-config:reset', async () => {
    const configPort = deps.getConfigPort()
    const serverPort = deps.getServerPort()
    const cfg = ServerConfig.default()
    // 重置持久化文件
    if (configPort) {
      const resetRes = await configPort.reset()
      if (!resetRes.ok) {
        // 如果 reset 不可用或失败，则直接 save 默认
        const saveRes = await configPort.save(cfg)
        if (!saveRes.ok) {
          throw new Error(saveRes.error.message)
        }
      }
    }
    // 应用默认配置
    if (serverPort) {
      const restartRes = await serverPort.restart(cfg)
      if (!restartRes.ok) {
        throw new Error(restartRes.error.message)
      }
    }
    return cfg.toJSON()
  })
}