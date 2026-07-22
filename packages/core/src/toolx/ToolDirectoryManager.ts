/**
 * ToolDirectoryManager - 基于协议的工具目录管理器
 *
 * 负责管理工具相关的所有目录：
 * - working dir (process.cwd() 基底)
 * - toolbox (依赖安装隔离目录)
 * - dependencies (node_modules)
 * - cache + temp
 *
 * 基于 ResourceManager 的协议系统，支持跨平台路径解析。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import path from 'path'
import fs from 'fs/promises'
import logger from '@promptx/logger'

type DirectoryKey = 'working' | 'toolbox' | 'dependencies' | 'cache' | 'temp'

interface ProtocolResolutionResult {
  success: boolean
  protocol?: string
  path?: string
  queryParams?: Map<string, unknown>
  error?: string
}

interface ResourceManagerLike {
  resolveProtocolReference: (protocolPath: string) => Promise<ProtocolResolutionResult>
  protocols: Map<string, ResourceProtocolLike>
}

interface ResourceProtocolLike {
  resolvePath?: (path: string, queryParams: Map<string, unknown>) => Promise<string>
}

class ToolDirectoryManager {
  public toolId: string
  public resourceManager: ResourceManagerLike
  public directories: Record<DirectoryKey, string>
  public resolvedPaths: Partial<Record<DirectoryKey, string>>

  constructor(toolId: string, resourceManager: ResourceManagerLike) {
    this.toolId = toolId
    this.resourceManager = resourceManager

    // 使用协议定义目录
    this.directories = {
      working: '@user://.perseng',
      toolbox: `@user://.perseng/toolbox/${toolId}`,
      dependencies: `@user://.perseng/toolbox/${toolId}/node_modules`,
      cache: `@user://.perseng/cache/${toolId}`,
      temp: `@user://.perseng/temp/${toolId}`,
    }

    this.resolvedPaths = {}
  }

  /**
   * 初始化所有路径（通过协议解析）
   */
  async initialize(): Promise<void> {
    for (const [key, protocolPath] of Object.entries(this.directories)) {
      this.resolvedPaths[key as DirectoryKey] = await this.resolveProtocolPath(protocolPath)
    }
    logger.debug(`[ToolDirectoryManager] Initialized paths: ${JSON.stringify(this.resolvedPaths)}`)
  }

  /**
   * 通过协议解析路径
   */
  async resolveProtocolPath(protocolPath: string): Promise<string> {
    const result = await this.resourceManager.resolveProtocolReference(protocolPath)

    if (!result.success) {
      throw new Error(`Failed to resolve protocol path ${protocolPath}: ${result.error}`)
    }

    const protocol = this.resourceManager.protocols.get(result.protocol || '')
    if (!protocol) {
      throw new Error(`Protocol ${result.protocol} not supported`)
    }

    if (typeof protocol.resolvePath === 'function') {
      return await protocol.resolvePath(result.path || '', result.queryParams || new Map())
    }
    throw new Error(`Protocol ${result.protocol} does not support path resolution`)
  }

  /**
   * 5 个 getter — 返回解析后的实际路径
   */
  getWorkingPath(): string {
    return this.resolvedPaths.working || ''
  }

  getToolboxPath(): string {
    return this.resolvedPaths.toolbox || ''
  }

  getDependenciesPath(): string {
    return this.resolvedPaths.dependencies || ''
  }

  getCachePath(): string {
    return this.resolvedPaths.cache || ''
  }

  getTempPath(): string {
    return this.resolvedPaths.temp || ''
  }

  /**
   * 获取 package.json 路径
   */
  getPackageJsonPath(): string {
    return path.join(this.getToolboxPath(), 'package.json')
  }

  /**
   * 确保必要的目录存在
   */
  async ensureDirectories(): Promise<void> {
    if (this.resolvedPaths.working) {
      await this.ensureDirectory(this.resolvedPaths.working)
    }
    if (this.resolvedPaths.toolbox) {
      await this.ensureDirectory(this.resolvedPaths.toolbox)
    }
  }

  /**
   * 确保单个目录存在
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath)
    } catch (error) {
      const errCode = (error as NodeJS.ErrnoException).code
      if (errCode === 'ENOENT') {
        await fs.mkdir(dirPath, { recursive: true })
        logger.debug(`[ToolDirectoryManager] Created directory: ${dirPath}`)
      } else {
        throw error
      }
    }
  }

  /**
   * 检查目录是否存在
   */
  async directoryExists(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 检查工具箱目录是否存在
   */
  async toolboxExists(): Promise<boolean> {
    return await this.directoryExists(this.getToolboxPath())
  }

  /**
   * 清理临时文件
   */
  async cleanupTemp(): Promise<void> {
    const tempPath = this.getTempPath()
    if (tempPath && (await this.directoryExists(tempPath))) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rmdir } = require('fs').promises
      await rmdir(tempPath, { recursive: true })
      logger.debug(`[ToolDirectoryManager] Cleaned up temp directory: ${tempPath}`)
    }
  }

  /**
   * 删除工具箱目录（用于强制重建）
   */
  async deleteToolbox(): Promise<void> {
    const toolboxPath = this.getToolboxPath()
    if (toolboxPath && (await this.toolboxExists())) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { rmdir } = require('fs').promises
      await rmdir(toolboxPath, { recursive: true })
      logger.debug(`[ToolDirectoryManager] Deleted toolbox directory: ${toolboxPath}`)
    }
  }

  /**
   * 获取协议路径（用于日志或调试）
   */
  getProtocolPath(key: DirectoryKey): string {
    return this.directories[key]
  }

  /**
   * 支持自定义协议路径
   */
  async setCustomDirectory(key: DirectoryKey, protocolPath: string): Promise<void> {
    this.directories[key] = protocolPath
    this.resolvedPaths[key] = await this.resolveProtocolPath(protocolPath)
  }
}

export = ToolDirectoryManager
