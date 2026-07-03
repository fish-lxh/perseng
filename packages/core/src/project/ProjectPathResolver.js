const path = require('path')
const ProjectManager = require('./ProjectManager')

/**
 * 项目路径解析器 - 新架构
 * 轻量级的@project协议路径解析，基于当前项目状态
 * 替代复杂的.perseng目录查找逻辑
 */
class ProjectPathResolver {
  constructor() {
    // 支持的项目结构目录映射
    this.projectDirs = {
      root: '', // 项目根目录
      src: 'src', // 源代码目录
      lib: 'lib', // 库目录
      build: 'build', // 构建输出目录
      dist: 'dist', // 分发目录
      docs: 'docs', // 文档目录
      test: 'test', // 测试目录
      tests: 'tests', // 测试目录（复数）
      spec: 'spec', // 规范测试目录
      config: 'config', // 配置目录
      scripts: 'scripts', // 脚本目录
      assets: 'assets', // 资源目录
      public: 'public', // 公共资源目录
      static: 'static', // 静态资源目录
      templates: 'templates', // 模板目录
      examples: 'examples', // 示例目录
      tools: 'tools', // 工具目录
      '.perseng': '.perseng' // Perseng 配置目录
    }
  }

  /**
   * 解析@project://协议路径
   * @param {string} resourcePath - 资源路径，如 "src/index.js" 或 ".perseng/resource/..."
   * @returns {string} 解析后的绝对路径
   */
  resolvePath(resourcePath) {
    // 🎯 新架构：直接获取当前项目路径，无需查找
    const projectRoot = ProjectManager.getCurrentProjectPath()

    // 特殊处理：.perseng开头的路径直接相对于项目根目录
    if (resourcePath.startsWith('.perseng/')) {
      const fullPath = path.join(projectRoot, resourcePath)
      return this._validatePath(fullPath, projectRoot)
    }

    // 标准路径处理逻辑
    const parts = resourcePath.split('/')
    const dirType = parts[0]
    const relativePath = parts.slice(1).join('/')

    // 验证目录类型
    if (!this.projectDirs.hasOwnProperty(dirType)) {
      throw new Error(`不支持的项目目录类型: ${dirType}。支持的类型: ${Object.keys(this.projectDirs).join(', ')}`)
    }

    // 构建目标目录路径
    const projectDirPath = this.projectDirs[dirType]
    const targetDir = projectDirPath ? path.join(projectRoot, projectDirPath) : projectRoot

    // 如果没有相对路径，返回目录本身
    if (!relativePath) {
      return targetDir
    }

    // 拼接完整路径
    const fullPath = path.join(targetDir, relativePath)
    return this._validatePath(fullPath, projectRoot)
  }

  /**
   * 获取项目根目录
   * @returns {string} 当前项目根目录
   */
  getProjectRoot() {
    return ProjectManager.getCurrentProjectPath()
  }

  /**
   * 获取 Perseng 配置目录路径
   * @returns {string} .perseng 目录路径
   */
  getPersengDirectory() {
    const projectRoot = ProjectManager.getCurrentProjectPath()
    return path.join(projectRoot, '.perseng')
  }

  /**
   * 获取项目资源目录路径
   * @returns {string} 项目资源目录路径
   */
  getResourceDirectory() {
    const persengDir = this.getPersengDirectory()
    return path.join(persengDir, 'resource')
  }

  /**
   * 获取项目注册表文件路径
   * @returns {string} 注册表文件路径
   */
  getRegistryPath() {
    const resourceDir = this.getResourceDirectory()
    return path.join(resourceDir, 'project.registry.json')
  }

  /**
   * 获取记忆目录路径
   * @returns {string} 记忆目录路径
   */
  getMemoryDirectory() {
    const persengDir = this.getPersengDirectory()
    return path.join(persengDir, 'memory')
  }

  /**
   * 验证路径安全性
   * @param {string} fullPath - 完整路径
   * @param {string} projectRoot - 项目根目录
   * @returns {string} 验证后的路径
   * @private
   */
  _validatePath(fullPath, projectRoot) {
    // 安全检查：确保路径在项目目录内
    const resolvedPath = path.resolve(fullPath)
    const resolvedProjectRoot = path.resolve(projectRoot)

    if (!resolvedPath.startsWith(resolvedProjectRoot)) {
      throw new Error(`安全错误：路径超出项目目录范围: ${resolvedPath}`)
    }

    return resolvedPath
  }

  /**
   * 获取支持的目录类型
   * @returns {Array<string>} 支持的目录类型列表
   */
  getSupportedDirectories() {
    return Object.keys(this.projectDirs)
  }

  /**
   * 检查目录类型是否支持
   * @param {string} dirType - 目录类型
   * @returns {boolean} 是否支持
   */
  isSupportedDirectory(dirType) {
    return this.projectDirs.hasOwnProperty(dirType)
  }
}

// 创建全局单例实例
let globalProjectPathResolver = null

/**
 * 获取全局ProjectPathResolver单例
 * @returns {ProjectPathResolver} 全局ProjectPathResolver实例
 */
function getGlobalProjectPathResolver() {
  if (!globalProjectPathResolver) {
    globalProjectPathResolver = new ProjectPathResolver()
  }
  return globalProjectPathResolver
}

module.exports = ProjectPathResolver
module.exports.getGlobalProjectPathResolver = getGlobalProjectPathResolver