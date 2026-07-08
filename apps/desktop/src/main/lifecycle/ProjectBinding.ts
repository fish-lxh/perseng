/**
 * Desktop 启动时自动恢复 project 状态 (§14.1)
 *
 * 目标：完全剔除 `project` MCP 工具后, 大模型 MCP 连接时无需调用 project 工具。
 *      Desktop 启动时若 cwd 命中已注册项目, 自动恢复 currentProject 状态。
 *
 * 调用方: apps/desktop/src/main/index.ts initialize() 中, `await app.whenReady()` 之后,
 *        `startUseCase.execute()` (启动 MCP server) 之前。
 *
 * 设计要点:
 * - 无副作用: 无 instance 或路径无效时静默返回, 不影响 desktop 启动链路
 * - 幂等: ProjectManager.isInitialized() 已为 true 时直接返回
 * - 不阻塞: 用 setImmediate 让出事件循环, 主进程冷启动耗时不变
 * - 与 CLI `restoreProjectForCLI()` 对称, 但 filter 不限定 transport (desktop 没有
 *   transport 字段写入路径, 沿用历史实例即可)
 */
import * as logger from '@promptx/logger'

/**
 * Desktop 启动时尝试恢复 project 状态。
 *
 * @returns {Promise<boolean>} true=已恢复, false=无 instance 或失败
 */
export async function restoreProjectForDesktop(): Promise<boolean> {
  try {
    // 动态加载避免 boot 阶段循环依赖 (@promptx/core 自身在启动早期才完整加载)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('@promptx/core')
    const ProjectManager = core.utils?.ProjectManager
    if (!ProjectManager) {
      logger.debug('[ProjectBinding] @promptx/core utils.ProjectManager 未导出, 跳过')
      return false
    }

    // 幂等: 已初始化则跳过
    if (typeof ProjectManager.isInitialized === 'function' && ProjectManager.isInitialized()) {
      logger.debug('[ProjectBinding] ProjectManager 已初始化, 跳过恢复')
      return false
    }

    const getGlobalProjectManager =
      typeof ProjectManager.getGlobalProjectManager === 'function'
        ? ProjectManager.getGlobalProjectManager
        : core.utils?.getGlobalProjectManager

    if (typeof getGlobalProjectManager !== 'function') {
      logger.debug('[ProjectBinding] getGlobalProjectManager 不可用, 跳过')
      return false
    }

    const projectManager = getGlobalProjectManager()
    if (!projectManager) {
      logger.debug('[ProjectBinding] 全局 ProjectManager 实例不存在, 跳过')
      return false
    }

    // Desktop 工作目录: electron 启动时的 cwd
    // (用户也可后续通过 IPC 显式绑定, 不影响此处 fallback)
    const cwd = process.cwd()
    const instances = await projectManager.getProjectInstances(cwd)
    if (!Array.isArray(instances) || instances.length === 0) {
      logger.debug(`[ProjectBinding] cwd=${cwd} 无已注册项目实例, 跳过`)
      return false
    }

    // 沿用 CLI 的 "transport 优先 / fallback 第一个" 策略;
    // Desktop 历史上未明确写入 transport 字段, 此处默认取第一个有效实例。
    const cliInstance =
      instances.find((i: { transport?: string }) => i.transport === 'cli') ||
      instances.find((i: { transport?: string }) => i.transport === 'desktop') ||
      instances.find((i: { transport?: string }) => i.transport === 'electron') ||
      instances[0]

    if (!cliInstance || !cliInstance.projectPath || !cliInstance.mcpId) {
      logger.debug('[ProjectBinding] 实例字段不完整, 跳过')
      return false
    }

    ProjectManager.setCurrentProject(
      cliInstance.projectPath,
      cliInstance.mcpId,
      cliInstance.ideType || 'unknown'
    )

    logger.info(
      `[ProjectBinding] Desktop 启动时自动恢复 project: ${cliInstance.projectPath}` +
      ` (mcpId=${cliInstance.mcpId}, ideType=${cliInstance.ideType || 'unknown'})`
    )
    return true
  } catch (error) {
    logger.warn(
      `[ProjectBinding] 自动恢复失败 (无副作用): ${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}