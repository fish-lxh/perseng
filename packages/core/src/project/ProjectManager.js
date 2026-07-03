const fs = require('fs-extra')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const logger = require('@promptx/logger')
const ProjectDiscovery = require('./ProjectDiscovery')

/**
 * 统一项目管理器 - 新架构
 * 核心原则：一次设置，全程使用
 * 负责当前项目状态管理和多项目配置持久化
 */
class ProjectManager {
  constructor() {
    this.persengHomeDir = path.join(os.homedir(), '.perseng')
    this.projectsDir = path.join(this.persengHomeDir, 'project')
  }

  // 🎯 新架构：当前项目状态管理
  static currentProject = {
    workingDirectory: null,
    mcpId: null,
    ideType: null,
    initialized: false
  }

  /**
   * 获取当前MCP ID
   * @returns {string} MCP进程ID
   */
  static getCurrentMcpId() {
    return `mcp-${process.pid}`
  }

  /**
   * 设置当前项目（init时调用）
   * @param {string} workingDirectory - 项目工作目录绝对路径
   * @param {string} mcpId - MCP进程ID
   * @param {string} ideType - IDE类型
   */
  static setCurrentProject(workingDirectory, mcpId, ideType) {
    this.currentProject = {
      workingDirectory: path.resolve(workingDirectory),
      mcpId,
      ideType,
      initialized: true
    }
  }

  /**
   * 获取当前项目路径（@project协议使用）
   * @returns {string} 当前项目工作目录
   */
  static getCurrentProjectPath() {
    logger.debug(`[ProjectManager DEBUG] getCurrentProjectPath被调用`)
    logger.debug(`[ProjectManager DEBUG] currentProject.initialized: ${this.currentProject.initialized}`)
    logger.debug(`[ProjectManager DEBUG] currentProject状态:`, JSON.stringify(this.currentProject, null, 2))
    
    // 输出完整的调用栈，包含文件名和行号
    const stack = new Error().stack
    const stackLines = stack.split('\n').slice(1, 8) // 取前7层调用栈
    logger.error(`[ProjectManager DEBUG] 完整调用栈:`)
    stackLines.forEach((line, index) => {
      logger.error(`[ProjectManager DEBUG]   ${index + 1}. ${line.trim()}`)
    })
    
    if (!this.currentProject.initialized) {
      logger.error(`[ProjectManager DEBUG]  项目未初始化，将抛出错误`)
      throw new Error('项目未初始化，请先调用 init 命令')
    }
    
    logger.debug(`[ProjectManager DEBUG]  返回项目路径: ${this.currentProject.workingDirectory}`)
    return this.currentProject.workingDirectory
  }

  /**
   * 获取当前项目信息
   * @returns {Object} 当前项目完整信息
   */
  static getCurrentProject() {
    logger.debug(`[ProjectManager DEBUG] getCurrentProject被调用`)
    logger.debug(`[ProjectManager DEBUG] currentProject.initialized: ${this.currentProject.initialized}`)
    logger.debug(`[ProjectManager DEBUG] currentProject状态:`, JSON.stringify(this.currentProject, null, 2))
    
    if (!this.currentProject.initialized) {
      logger.error(`[ProjectManager DEBUG]  项目未初始化，将抛出错误`)
      throw new Error('项目未初始化，请先调用 init 命令')
    }
    
    logger.debug(`[ProjectManager DEBUG]  返回项目信息`)
    return { ...this.currentProject }
  }

  /**
   * 检查项目是否已初始化
   * @returns {boolean} 是否已初始化
   */
  static isInitialized() {
    return this.currentProject.initialized
  }

  /**
   * 注册项目到MCP实例 - 使用Hash目录结构
   * @param {string} projectPath - 项目绝对路径
   * @param {string} mcpId - MCP进程ID
   * @param {string} ideType - IDE类型（cursor/vscode等）
   * @returns {Promise<Object>} 项目配置对象
   */
  async registerProject(projectPath, mcpId, ideType) {
    // 验证项目路径
    if (!await this.validateProjectPath(projectPath)) {
      throw new Error(`无效的项目路径: ${projectPath}`)
    }

    // 生成项目配置
    const projectConfig = {
      mcpId: mcpId,
      ideType: ideType.toLowerCase(),
      projectPath: path.resolve(projectPath),
      projectHash: this.generateProjectHash(projectPath)
    }

    // 生成项目Hash目录
    const projectHash = this.generateProjectHash(projectPath)
    const projectConfigDir = path.join(this.projectsDir, projectHash)

    // 🎯 确保Hash目录和.perseng子目录存在
    await fs.ensureDir(projectConfigDir)
    await fs.ensureDir(path.join(projectConfigDir, '.perseng'))
    await fs.ensureDir(path.join(projectConfigDir, '.perseng', 'memory'))
    await fs.ensureDir(path.join(projectConfigDir, '.perseng', 'resource'))

    // 生成配置文件名并保存到Hash目录下
    const fileName = this.generateConfigFileName(mcpId, ideType, projectPath)
    const configPath = path.join(projectConfigDir, fileName)
    
    await fs.writeJson(configPath, projectConfig, { spaces: 2 })
    
    return projectConfig
  }

  /**
   * 根据MCP ID获取单个项目配置（假设只有一个项目）
   * @param {string} mcpId - MCP进程ID
   * @returns {Promise<Object|null>} 项目配置对象
   */
  async getProjectByMcpId(mcpId) {
    const projects = await this.getProjectsByMcpId(mcpId)
    return projects.length > 0 ? projects[0] : null
  }

  /**
   * 根据MCP ID获取所有绑定的项目配置 - 支持Hash目录结构
   * @param {string} mcpId - MCP进程ID
   * @returns {Promise<Array>} 项目配置数组
   */
  async getProjectsByMcpId(mcpId) {
    if (!await fs.pathExists(this.projectsDir)) {
      return []
    }

    const hashDirs = await fs.readdir(this.projectsDir)
    const projects = []

    for (const hashDir of hashDirs) {
      const hashDirPath = path.join(this.projectsDir, hashDir)
      
      // 🎯 只处理Hash目录（忽略旧的平铺文件）
      if (!(await fs.stat(hashDirPath)).isDirectory()) {
        continue
      }
      
      try {
        const configFiles = await fs.readdir(hashDirPath)
        for (const file of configFiles) {
          // 查找MCP配置文件
          if (file.startsWith('mcp-') && file.endsWith('.json')) {
            try {
              const configPath = path.join(hashDirPath, file)
              const config = await fs.readJson(configPath)
              if (config.mcpId === mcpId) {
                projects.push(config)
              }
            } catch (error) {
              // 忽略损坏的配置文件
              logger.warn(`跳过损坏的配置文件: ${file}`)
            }
          }
        }
      } catch (error) {
        // 忽略无法读取的目录
        logger.warn(`跳过无法读取的目录: ${hashDir}`)
      }
    }

    return projects
  }

  /**
   * 获取特定项目的所有实例（不同IDE/MCP的绑定） - 支持Hash目录结构
   * @param {string} projectPath - 项目路径
   * @returns {Promise<Array>} 项目实例数组
   */
  async getProjectInstances(projectPath) {
    if (!await fs.pathExists(this.projectsDir)) {
      return []
    }

    const projectHash = this.generateProjectHash(projectPath)
    const projectConfigDir = path.join(this.projectsDir, projectHash)
    
    // 检查Hash目录是否存在
    if (!await fs.pathExists(projectConfigDir)) {
      return []
    }

    const instances = []
    
    try {
      const configFiles = await fs.readdir(projectConfigDir)
      
      for (const file of configFiles) {
        // 查找MCP配置文件
        if (file.startsWith('mcp-') && file.endsWith('.json')) {
          try {
            const configPath = path.join(projectConfigDir, file)
            const config = await fs.readJson(configPath)
            if (config.projectHash === projectHash) {
              instances.push(config)
            }
          } catch (error) {
            logger.warn(`跳过损坏的配置文件: ${file}`)
          }
        }
      }
    } catch (error) {
      logger.warn(`无法读取项目配置目录: ${projectConfigDir}`)
    }

    return instances
  }

  /**
   * 删除项目绑定 - 支持Hash目录结构
   * @param {string} mcpId - MCP进程ID
   * @param {string} ideType - IDE类型
   * @param {string} projectPath - 项目路径
   * @returns {Promise<boolean>} 是否删除成功
   */
  async removeProject(mcpId, ideType, projectPath) {
    const projectHash = this.generateProjectHash(projectPath)
    const projectConfigDir = path.join(this.projectsDir, projectHash)
    const fileName = this.generateConfigFileName(mcpId, ideType, projectPath)
    const configPath = path.join(projectConfigDir, fileName)
    
    if (await fs.pathExists(configPath)) {
      await fs.remove(configPath)
      
      // 🎯 检查Hash目录是否为空，如果为空则删除整个目录
      try {
        const remainingFiles = await fs.readdir(projectConfigDir)
        const mcpConfigFiles = remainingFiles.filter(file => file.startsWith('mcp-') && file.endsWith('.json'))
        
        if (mcpConfigFiles.length === 0) {
          // 没有其他MCP配置文件，删除整个Hash目录
          await fs.remove(projectConfigDir)
        }
      } catch (error) {
        // 目录可能已经被删除，忽略错误
      }
      
      return true
    }
    
    return false
  }

  /**
   * 清理过期的项目配置 - 支持Hash目录结构
   * @returns {Promise<number>} 清理的配置文件数量
   */
  async cleanupExpiredProjects() {
    if (!await fs.pathExists(this.projectsDir)) {
      return 0
    }

    const hashDirs = await fs.readdir(this.projectsDir)
    let cleanedCount = 0

    for (const hashDir of hashDirs) {
      const hashDirPath = path.join(this.projectsDir, hashDir)
      
      // 只处理Hash目录
      if (!(await fs.stat(hashDirPath)).isDirectory()) {
        continue
      }
      
      try {
        const configFiles = await fs.readdir(hashDirPath)
        let hasValidConfig = false
        
        for (const file of configFiles) {
          if (file.startsWith('mcp-') && file.endsWith('.json')) {
            try {
              const configPath = path.join(hashDirPath, file)
              const config = await fs.readJson(configPath)
              
              // 检查项目路径是否仍然存在
              if (!await fs.pathExists(config.projectPath)) {
                await fs.remove(configPath)
                cleanedCount++
                logger.info(`清理过期项目配置: ${file}`)
              } else {
                hasValidConfig = true
              }
            } catch (error) {
              // 清理损坏的配置文件
              await fs.remove(path.join(hashDirPath, file))
              cleanedCount++
              logger.info(`清理损坏配置文件: ${file}`)
            }
          }
        }
        
        // 如果Hash目录中没有有效的配置文件，删除整个目录
        if (!hasValidConfig) {
          await fs.remove(hashDirPath)
          logger.info(`清理空的项目Hash目录: ${hashDir}`)
        }
      } catch (error) {
        // 清理无法访问的目录
        await fs.remove(hashDirPath)
        cleanedCount++
        logger.info(`清理无法访问的目录: ${hashDir}`)
      }
    }

    return cleanedCount
  }

  /**
   * 生成多项目环境下的AI提示词
   * @param {string} contextType - 上下文类型：'list'/'action'/'learn'
   * @param {string} mcpId - MCP进程ID
   * @param {string} ideType - IDE类型
   * @returns {Promise<string>} 格式化的AI提示词
   */
  async generateTopLevelProjectPrompt(contextType = 'list', mcpId, ideType) {
    const projects = await this.getProjectsByMcpId(mcpId)
    
    if (projects.length === 0) {
      // 未绑定项目，但这是正常的，不需要特别提示
      return ''
    }
    
    if (projects.length === 1) {
      // 单项目环境（保持现有体验）
      const project = projects[0]
      const basePrompt = `🛑 **项目环境验证** 🛑
📍 当前绑定项目: ${project.projectPath}
🔗 MCP实例: ${mcpId} (${ideType})

⚠️ **执行前确认**：上述路径是否为你当前工作的项目？`

      switch (contextType) {
        case 'action':
          return `${basePrompt}
如不一致，立即停止所有操作并使用 \`perseng_init\` 更新！

💥 **严重警告**：在错误项目路径下操作将导致不可预知的错误！`
        
        case 'learn':
          return `${basePrompt}
错误环境将导致知识关联失效！

💥 **严重警告**：项目环境不匹配将影响学习效果！`
        
        default:
          return `${basePrompt}
如不一致，必须使用 \`perseng_init\` 更新正确路径！

💥 **严重警告**：错误的项目环境将导致服务异常！`
      }
    }
    
    // 多项目环境
    const projectList = projects.map((proj, index) => 
      `${index + 1}. ${path.basename(proj.projectPath)} (${proj.projectPath})`
    ).join('\n')
    
    return `🎯 **多项目环境检测** 🎯
📍 当前MCP实例(${mcpId})已绑定 ${projects.length} 个项目：

${projectList}

⚠️ **请明确指定**：你要在哪个项目中执行操作？
💡 **建议**：在对话中明确说明项目名称或路径`
  }

  /**
   * 验证路径是否为有效的项目目录
   * @param {string} projectPath - 要验证的路径
   * @returns {Promise<boolean>} 是否为有效项目目录
   */
  async validateProjectPath(projectPath) {
    try {
      // 基础检查：路径存在且为目录
      const stat = await fs.stat(projectPath)
      if (!stat.isDirectory()) {
        return false
      }

      // 简单检查：避免明显错误的路径
      const resolved = path.resolve(projectPath)
      const homeDir = os.homedir()
      
      // 不允许是用户主目录
      if (resolved === homeDir) {
        return false
      }

      return true
    } catch (error) {
      return false
    }
  }

  /**
   * 生成配置文件名
   * @param {string} mcpId - MCP进程ID
   * @param {string} ideType - IDE类型
   * @param {string} projectPath - 项目路径
   * @returns {string} 配置文件名
   */
  generateConfigFileName(mcpId, ideType, projectPath) {
    const projectHash = this.generateProjectHash(projectPath)
    const projectName = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const ideTypeSafe = ideType.replace(/[^a-z0-9-]/g, '').toLowerCase() || 'unknown'
    // 格式：mcp-pid-idetype-projectname-hash.json
    return `mcp-${mcpId.replace('mcp-', '')}-${ideTypeSafe}-${projectName}-${projectHash}.json`
  }

  /**
   * 生成项目路径的Hash值
   * @param {string} projectPath - 项目路径
   * @returns {string} 8位Hash值
   */
  generateProjectHash(projectPath) {
    return crypto.createHash('md5').update(path.resolve(projectPath)).digest('hex').substr(0, 8)
  }

  /**
   * 从配置文件中获取IDE类型
   * @param {string} mcpId - MCP进程ID
   * @returns {Promise<string>} IDE类型
   */
  async getIdeType(mcpId) {
    const project = await this.getProjectByMcpId(mcpId)
    return project ? project.ideType : 'unknown'
  }

  /**
   * 生成MCP进程ID - 基于进程ID确保实例唯一
   * @param {string} ideType - IDE类型（保留参数兼容性，实际不使用）
   * @returns {string} MCP进程ID
   */
  static generateMcpId(ideType = 'unknown') {
    const serverEnv = getGlobalServerEnvironment()
    if (serverEnv.isInitialized()) {
      return serverEnv.getMcpId()
    }
    // fallback到原逻辑
    return `mcp-${process.pid}`
  }

  /**
   * 统一项目注册方法 - 新架构：设置当前项目并持久化配置
   * @param {string} workingDirectory - 项目工作目录
   * @param {string} ideType - IDE类型（可选，默认'unknown'）
   * @returns {Promise<Object>} 项目配置对象
   */
  static async registerCurrentProject(workingDirectory, ideType = 'unknown') {
    logger.debug(`[ProjectManager DEBUG] ======= registerCurrentProject开始 =======`)
    logger.debug(`[ProjectManager DEBUG] 参数 - workingDirectory: ${workingDirectory}`)
    logger.debug(`[ProjectManager DEBUG] 参数 - ideType: ${ideType}`)
    logger.debug(`[ProjectManager DEBUG] 注册前 currentProject状态:`, JSON.stringify(this.currentProject, null, 2))

    const mcpId = this.getCurrentMcpId()
    logger.debug(`[ProjectManager DEBUG] MCP ID: ${mcpId}`)

    // 🎯 新架构：设置当前项目状态
    logger.debug(`[ProjectManager DEBUG] 调用 setCurrentProject...`)
    this.setCurrentProject(workingDirectory, mcpId, ideType)
    logger.debug(`[ProjectManager DEBUG] setCurrentProject完成后 currentProject状态:`, JSON.stringify(this.currentProject, null, 2))

    // 持久化项目配置（保持多项目管理功能）
    logger.debug(`[ProjectManager DEBUG] 开始持久化项目配置...`)
    const projectManager = getGlobalProjectManager()
    const result = await projectManager.registerProject(workingDirectory, mcpId, ideType)
    logger.debug(`[ProjectManager DEBUG] 项目配置持久化完成:`, JSON.stringify(result, null, 2))

    // 扫描并注册项目资源
    logger.debug(`[ProjectManager DEBUG] 开始扫描项目资源...`)
    try {
      const discovery = new ProjectDiscovery()
      const resources = await discovery.scanProjectResources()
      if (resources && Array.isArray(resources)) {
        const resourceCount = resources.length
        logger.info(`[ProjectManager] 发现并注册了 ${resourceCount} 个项目资源`)
        result.resourcesDiscovered = resourceCount
      }
    } catch (error) {
      logger.warn(`[ProjectManager] 项目资源扫描失败: ${error.message}`)
    }

    logger.debug(`[ProjectManager DEBUG] ======= registerCurrentProject结束 =======`)

    return result
  }
}

// 创建全局单例实例
let globalProjectManager = null

/**
 * 获取全局ProjectManager单例
 * @returns {ProjectManager} 全局ProjectManager实例
 */
function getGlobalProjectManager() {
  if (!globalProjectManager) {
    globalProjectManager = new ProjectManager()
  }
  return globalProjectManager
}

module.exports = ProjectManager
module.exports.ProjectManager = ProjectManager
module.exports.getGlobalProjectManager = getGlobalProjectManager