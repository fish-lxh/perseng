/**
 * agentx:* IPC handlers (14 channels).
 *
 * Extracted from PersengDesktopApp.setupAgentXIPC (P0 step 2.1c). The AgentX
 * service is a process-wide singleton imported from ~/main/services/AgentXService
 * so no deps are needed. Channel names preserved verbatim.
 */

import { ipcMain } from 'electron'
import { agentXService } from '~/main/services/AgentXService'

export function registerAgentXIpc(): void {
  // 获取 AgentX 服务器 URL
  ipcMain.handle('agentx:getServerUrl', () => {
    return agentXService.getServerUrl()
  })

  // 获取 AgentX 服务状态
  ipcMain.handle('agentx:getStatus', () => {
    return agentXService.getStatus()
  })

  // 启动 AgentX 服务
  ipcMain.handle('agentx:start', async () => {
    try {
      await agentXService.start()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 停止 AgentX 服务
  ipcMain.handle('agentx:stop', async () => {
    try {
      await agentXService.stop()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 获取 AgentX 配置
  ipcMain.handle('agentx:getConfig', () => {
    return agentXService.getConfig()
  })

  // 更新 AgentX 配置
  ipcMain.handle('agentx:updateConfig', async (_event, config) => {
    try {
      await agentXService.updateConfig(config)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 测试 AgentX 连接
  ipcMain.handle('agentx:testConnection', async (_event, config) => {
    return await agentXService.testConnection(config)
  })

  // 获取 MCP 服务器配置
  ipcMain.handle('agentx:getMcpServers', () => {
    return agentXService.getMcpServers()
  })

  // 更新 MCP 服务器配置
  ipcMain.handle('agentx:updateMcpServers', async (_event, mcpServers) => {
    try {
      await agentXService.updateMcpServers(mcpServers)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 获取可用 Skills 列表
  ipcMain.handle('agentx:getAvailableSkills', async () => {
    return await agentXService.getAvailableSkills()
  })

  // 获取已启用的 Skills
  ipcMain.handle('agentx:getEnabledSkills', () => {
    return agentXService.getEnabledSkills()
  })

  // 更新已启用的 Skills
  ipcMain.handle('agentx:updateEnabledSkills', async (_event, skills: string[]) => {
    try {
      await agentXService.updateEnabledSkills(skills)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 导入 Skill（zip 压缩包）
  ipcMain.handle('agentx:importSkill', async (_event, zipPath: string) => {
    return await agentXService.importSkill(zipPath)
  })

  // 删除 Skill
  ipcMain.handle('agentx:deleteSkill', async (_event, skillName: string) => {
    return await agentXService.deleteSkill(skillName)
  })
}