/**
 * 项目管理命令
 * 负责项目配置、环境准备和状态管理
 * 使用Area架构组装输出
 *
 * P0 step 0B.4.3: 迁 .js → .ts. BasePouchCommand / ProjectArea / StateArea 已 .ts;
 * resource/ / project/ / ~/constants / fs-extra / path 仍 .js / built-in, 走 const+require.
 */

import { BasePouchCommand } from '../BasePouchCommand.js'
import { ProjectArea, type ProjectError } from '../areas/project/ProjectArea.js'
import { StateArea } from '../areas/common/StateArea.js'
import * as logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalResourceManager } = require('../../resource') as {
  getGlobalResourceManager(): ResourceManagerLike
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PACKAGE_NAMES } = require('~/constants') as {
  PACKAGE_NAMES: Record<string, string>
}
// KNUTH-FEAT 2026-07-11: Phase 3 cast 清理 — ProjectDiscovery / ProjectManager 真实 .d.ts 已生成。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectDiscovery = require('../../project/ProjectDiscovery')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectManager = require('~/project/ProjectManager')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalProjectManager } = require('~/project/ProjectManager')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs-extra') as typeof import('fs-extra')

/** ResourceManager 鸭子类型 */
interface ResourceManagerLike {
  initialized: boolean
  initializeWithNewArchitecture(): Promise<void>
  protocols: Map<string, { resolvePath(p: string): Promise<string> }>
  [key: string]: unknown
}

/** ProjectDiscovery 鸭子类型（duck-typed 即可） */
interface ProjectDiscoveryLike {
  generateRegistry(): Promise<{
    size: number
    getStats(): { byProtocol: Record<string, number> }
  }>
}

/** ProjectManager 鸭子类型 */
interface ProjectManagerLike {
  getCurrentProject(): { initialized: boolean } | null
  registerCurrentProject(
    projectPath: string,
    ideType: string,
  ): Promise<{ mcpId: string; ideType: string; projectPath: string }>
  generateConfigFileName(mcpId: string, ideType: string, projectPath: string): string
  detectIdeType(): string
  getIdeType(mcpId: string): Promise<string>
  [key: string]: unknown
}

/** project 命令参数（MCP 对象格式或 CLI 字符串格式） */
interface ProjectArgsObject {
  workingDirectory?: string
  ideType?: string
}

export class ProjectCommand extends BasePouchCommand {
  private resourceManager: ResourceManagerLike | null
  private projectDiscovery: ProjectDiscoveryLike | null
  private projectManager: ProjectManagerLike | null

  constructor() {
    super()
    // 延迟初始化：这些组件可能依赖项目状态，在 getContent 中按需初始化
    this.resourceManager = null
    this.projectDiscovery = null
    this.projectManager = null
  }

  /**
   * 组装Areas
   */
  async assembleAreas(args: unknown[] = []): Promise<void> {
    // 获取参数，支持两种格式：
    // 1. 来自MCP的对象格式：{ workingDirectory: "path", ideType: "cursor" }
    // 2. 来自CLI的字符串格式：["path"]
    let workingDirectory: string | undefined
    let userIdeType: string | undefined

    if (args && typeof args[0] === 'object' && args[0] !== null) {
      // MCP格式
      const first = args[0] as ProjectArgsObject
      workingDirectory = first.workingDirectory
      userIdeType = first.ideType
    } else if (args && typeof args[0] === 'string') {
      // CLI格式
      workingDirectory = args[0]
      // CLI格式暂不支持IDE类型参数，使用自动检测
    }

    if (!workingDirectory) {
      // 没有提供项目路径时，全局模式
      const projectArea = new ProjectArea({ isProjectMode: false })
      this.registerArea(projectArea)

      const stateArea = new StateArea('global_mode')
      this.registerArea(stateArea)
      return
    }

    // 解码中文路径并解析
    const decodedWorkingDirectory = decodeURIComponent(workingDirectory)
    const projectPath = path.resolve(decodedWorkingDirectory)

    // 🎯 第一优先级：立即设置项目状态，确保后续所有操作都有正确的项目上下文
    // 在任何依赖项目状态的操作之前，必须先设置当前项目状态
    const detectedIdeType = this.detectIdeType()
    let ideType = userIdeType || detectedIdeType || 'unknown'

    // 规范化IDE类型（移除特殊字符，转小写）
    if (userIdeType) {
      ideType = userIdeType.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'unknown'
    }

    // 基础路径验证（使用简单的 fs 检查，避免依赖 ProjectManager 实例方法）
    const validationError = await this.validateProjectPathDirectly(projectPath)
    if (validationError) {
      // 传递错误信息给 ProjectArea 统一处理
      const projectArea = new ProjectArea({
        isProjectMode: false,
        error: validationError,
      })
      this.registerArea(projectArea)

      const stateArea = new StateArea('error')
      this.registerArea(stateArea)
      return
    }

    // 使用统一项目注册方法（从ServerEnvironment获取服务信息）
    // 这将设置 ProjectManager.currentProject 状态，确保后续操作有正确的项目上下文
    const registeredConfig = await ProjectManager.registerCurrentProject(projectPath, ideType)
    const projectConfig = {
      mcpId: registeredConfig.mcpId,
      ideType: registeredConfig.ideType,
      projectPath: registeredConfig.projectPath,
      resourcesDiscovered: 0,
    }

    logger.debug(`[InitCommand]  项目状态已设置: ${projectConfig.projectPath} -> ${projectConfig.mcpId} (${ideType})`)
    logger.debug(`[InitCommand] IDE类型: ${userIdeType ? `用户指定(${ideType})` : `自动检测(${detectedIdeType})`}`)

    // 现在项目状态已设置，可以安全初始化依赖组件
    this.resourceManager = getGlobalResourceManager()
    this.projectDiscovery = new ProjectDiscovery()
    this.projectManager = getGlobalProjectManager()

    // 1. 获取版本信息
    const version = await this.getVersionInfo()

    // 2. 基础环境准备 - 现在可以安全使用项目路径
    await this.ensurePersengDirectory(projectPath)

    // 3. 项目级注册表现在由 DiscoverCommand 在需要时生成
    const registryStats = {
      message: `✅ 项目资源目录已准备就绪
   📂 目录: .perseng/resource
   💾 注册表将在首次查看资源时自动生成`,
      totalResources: 0,
    }

    // 4. ResourceManager 的刷新现在由 DiscoverCommand 负责
    // init 只负责项目环境初始化，不负责资源发现

    // 生成配置文件名
    const configFileName = this.projectManager!.generateConfigFileName(
      projectConfig.mcpId,
      ideType,
      projectPath,
    )

    // 组装Areas
    const projectInfo = {
      version,
      projectConfig,
      registryStats,
      configFileName,
      ideType,
      isProjectMode: true,
    }

    const projectArea = new ProjectArea(projectInfo)
    this.registerArea(projectArea)

    const stateArea = new StateArea('initialized')
    this.registerArea(stateArea)
  }

  /**
   * 生成项目级资源注册表
   */
  async generateProjectRegistry(_projectPath: string): Promise<{ message: string; totalResources: number }> {
    try {
      // 🎯 使用@project协议进行路径解析，支持HTTP/本地模式
      const projectProtocol = this.resourceManager!.protocols.get('project')
      const resourceDir = await projectProtocol!.resolvePath('.perseng/resource')

      // 2. 确保资源目录存在（已通过@project协议映射）
      await fs.ensureDir(resourceDir)
      logger.debug(`[InitCommand] 确保资源目录存在: ${resourceDir}`)

      // 3. 使用 ProjectDiscovery 的正确方法生成注册表（已内置@project协议支持）
      logger.info('正在扫描项目资源...')
      const registryData = await this.projectDiscovery!.generateRegistry()

      // 4. 生成统计信息
      const stats = registryData.getStats()

      if (registryData.size === 0) {
        return {
          message: `✅ 项目资源目录已创建，注册表已初始化
   📂 目录: .perseng/resource
   💾 注册表: .perseng/resource/project.registry.json
   💡 现在可以在 domain 目录下创建角色资源了`,
          totalResources: 0,
        }
      }

      return {
        message: `✅ 项目资源注册表已重新生成
   📊 总计: ${registryData.size} 个资源
   📋 分类: role(${stats.byProtocol.role || 0}), thought(${stats.byProtocol.thought || 0}), execution(${stats.byProtocol.execution || 0}), knowledge(${stats.byProtocol.knowledge || 0})
   💾 位置: .perseng/resource/project.registry.json`,
        totalResources: registryData.size,
      }
    } catch (error) {
      logger.error('生成项目注册表时出错:', error as Error)
      return {
        message: `❌ 生成项目注册表失败: ${(error as Error).message}`,
        totalResources: 0,
      }
    }
  }

  /**
   * 确保 .perseng 基础目录存在
   */
  async ensurePersengDirectory(_projectPath: string): Promise<void> {
    // 🎯 使用@project协议解析路径，支持HTTP模式的路径映射
    const projectProtocol = this.resourceManager!.protocols.get('project')
    const persengDir = await projectProtocol!.resolvePath('.perseng')
    await fs.ensureDir(persengDir)
    logger.debug(`[InitCommand] 确保.perseng目录存在: ${persengDir}`)
  }

  /**
   * 刷新全局 ResourceManager
   */
  async refreshGlobalResourceManager(): Promise<void> {
    try {
      logger.debug('[InitCommand] 刷新全局 ResourceManager...')

      // 重新初始化 ResourceManager，清除缓存并重新发现资源
      await this.resourceManager!.initializeWithNewArchitecture()

      logger.debug('[InitCommand] 全局 ResourceManager 刷新完成')
    } catch (error) {
      logger.warn(`[InitCommand] 刷新 ResourceManager 失败: ${(error as Error).message}`)
      // 不抛出错误，避免影响 init 命令的主要功能
    }
  }

  /**
   * 获取版本信息
   */
  async getVersionInfo(): Promise<string> {
    try {
      const packageJsonPath = path.resolve(__dirname, '../../../../../package.json')
      if (await fs.pathExists(packageJsonPath)) {
        const packageJson = (await fs.readJSON(packageJsonPath)) as { version?: string; name?: string }
        const baseVersion = packageJson.version || '未知版本'
        const nodeVersion = process.version
        const packageName = packageJson.name || PACKAGE_NAMES.LEGACY

        return `${baseVersion} (${packageName}@${baseVersion}, Node.js ${nodeVersion})`
      }
    } catch (error) {
      logger.warn('无法读取版本信息:', (error as Error).message)
    }
    return '未知版本'
  }

  /**
   * 直接验证项目路径（避免依赖 ProjectManager 实例）
   */
  async validateProjectPathDirectly(projectPath: string): Promise<ProjectError | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const os = require('os') as typeof import('os')

      // 检查路径是否存在
      const exists = await fs.pathExists(projectPath)
      if (!exists) {
        return {
          type: 'not_exists',
          path: projectPath,
          message: '目录不存在',
        }
      }

      // 基础检查：路径存在且为目录
      const stat = await fs.stat(projectPath)
      if (!stat.isDirectory()) {
        return {
          type: 'not_directory',
          path: projectPath,
          message: '提供的路径是文件而不是目录',
        }
      }

      // 简单检查：避免明显错误的路径
      const resolved = path.resolve(projectPath)
      const homeDir = os.homedir()

      // 不允许是用户主目录
      if (resolved === homeDir) {
        return {
          type: 'is_home',
          path: projectPath,
          message: '不能使用用户主目录作为项目目录',
        }
      }

      return null // 路径有效
    } catch (error) {
      return {
        type: 'access_error',
        path: projectPath,
        message: (error as Error).message || '无法访问目录',
      }
    }
  }

  /**
   * 检测IDE类型
   */
  detectIdeType(): string {
    // 检测常见的IDE环境变量
    const ideStrategies = [
      // Claude IDE
      { name: 'claude', vars: ['WORKSPACE_FOLDER_PATHS'] },
      // Cursor
      { name: 'cursor', vars: ['CURSOR_USER', 'CURSOR_SESSION_ID'] },
      // VSCode
      { name: 'vscode', vars: ['VSCODE_WORKSPACE_FOLDER', 'VSCODE_CWD', 'TERM_PROGRAM'] },
      // JetBrains IDEs
      { name: 'jetbrains', vars: ['IDEA_INITIAL_DIRECTORY', 'PYCHARM_HOSTED'] },
      // Vim/Neovim
      { name: 'vim', vars: ['VIM', 'NVIM'] },
    ]

    for (const strategy of ideStrategies) {
      for (const envVar of strategy.vars) {
        if (process.env[envVar]) {
          // 特殊处理VSCode的TERM_PROGRAM
          if (envVar === 'TERM_PROGRAM' && process.env[envVar] === 'vscode') {
            return 'vscode'
          }
          // 其他环境变量存在即认为是对应IDE
          if (envVar !== 'TERM_PROGRAM') {
            return strategy.name
          }
        }
      }
    }

    // 检测进程名称
    const processTitle = process.title || ''
    if (processTitle.includes('cursor')) return 'cursor'
    if (processTitle.includes('code')) return 'vscode'
    if (processTitle.includes('claude')) return 'claude'

    // 检测命令行参数
    const argv = process.argv.join(' ')
    if (argv.includes('cursor')) return 'cursor'
    if (argv.includes('code')) return 'vscode'
    if (argv.includes('claude')) return 'claude'

    return 'unknown'
  }
}

export default ProjectCommand
