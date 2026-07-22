/**
 * ToolModuleImport - 智能模块导入管理器
 *
 * 负责处理工具沙箱中的所有模块导入需求。
 * 实现智能降级策略，自动适配各种模块格式。
 *
 * 核心功能：
 * 1. 预装包优先加载
 * 2. 智能模块格式识别
 * 3. 降级策略链处理
 * 4. 模块缓存管理
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import logger from '@promptx/logger'
import path from 'path'
import { pathToFileURL } from 'url'
import NormalizeIndexModule = require('./normalize')

const { createDefaultNormalizer } = NormalizeIndexModule as unknown as {
  createDefaultNormalizer: () => {
    normalize: (module: unknown, moduleName: string, context?: Record<string, unknown>) => Promise<unknown>
  }
}

type ImportFn = (
  moduleName: string,
  options?: { parentURL?: string; cache?: boolean; loader?: string; [k: string]: unknown },
) => Promise<unknown>

interface PreinstalledManagerLike {
  getPreinstalledModule: (name: string) => Promise<unknown> | unknown
}

interface CacheStats {
  toolId: string
  cachedModules: string[]
  cacheSize: number
}

class ToolModuleImport {
  public toolId: string
  public sandboxPath: string
  public moduleCache: Map<string, unknown>
  public importxFn: ImportFn | null
  public preinstalledManager: PreinstalledManagerLike | null
  public normalizer: ReturnType<typeof createDefaultNormalizer>

  constructor(toolId: string, sandboxPath: string) {
    this.toolId = toolId
    this.sandboxPath = sandboxPath
    this.moduleCache = new Map() // 缓存已加载的模块
    this.importxFn = null // 延迟加载的 importx 函数
    this.preinstalledManager = null // 预装依赖管理器
    this.normalizer = createDefaultNormalizer() // 使用责任链规范化器
  }

  /**
   * 主入口 - 智能导入模块
   */
  async import(moduleName: string): Promise<unknown> {
    try {
      // 1. 缓存检查
      if (this.moduleCache.has(moduleName)) {
        logger.debug(`[ToolModuleImport] Using cached module: ${moduleName}`)
        return this.moduleCache.get(moduleName)
      }

      logger.debug(`[ToolModuleImport] Loading module: ${moduleName}`)

      // 2. 尝试预装包
      const preinstalledModule = await this.tryPreinstalled(moduleName)
      if (preinstalledModule) {
        logger.debug(`[ToolModuleImport] Using preinstalled module: ${moduleName}`)
        const normalized = await this.normalizer.normalize(preinstalledModule, moduleName, {
          toolId: this.toolId,
          source: 'preinstalled',
        })
        this.moduleCache.set(moduleName, normalized)
        return normalized
      }

      // 3. 从沙箱加载用户安装的包
      logger.debug(`[ToolModuleImport] Loading user-installed module: ${moduleName}`)
      const sandboxModule = await this.loadFromSandbox(moduleName)
      const normalized = await this.normalizer.normalize(sandboxModule, moduleName, {
        toolId: this.toolId,
        source: 'sandbox',
        sandboxPath: this.sandboxPath,
      })
      this.moduleCache.set(moduleName, normalized)
      return normalized
    } catch (error) {
      logger.error(`[ToolModuleImport] Failed to import ${moduleName}: ${(error as Error).message}`)

      // 提供更友好的错误信息
      const enhancedError = new Error(
        `Cannot load module '${moduleName}': ${(error as Error).message}`,
      )
      ;(enhancedError as Error & { code?: string; module?: string; toolId?: string }).code = 'MODULE_IMPORT_FAILED'
      ;(enhancedError as Error & { code?: string; module?: string; toolId?: string }).module = moduleName
      ;(enhancedError as Error & { code?: string; module?: string; toolId?: string }).toolId = this.toolId
      throw enhancedError
    }
  }

  /**
   * 尝试从预装包加载（私有）
   */
  async tryPreinstalled(moduleName: string): Promise<unknown> {
    try {
      // 延迟加载预装管理器
      if (!this.preinstalledManager) {
        // KNUTH-NOTE: @promptx/resource 是跨包入口，运行时 require
        // 不导入类型以避免 composite 下游类型污染。
        const resourceModule = (require('@promptx/resource') as unknown) as {
          getPreinstalledDependenciesManager: () => PreinstalledManagerLike
        }
        this.preinstalledManager = resourceModule.getPreinstalledDependenciesManager()
      }

      // 使用 getPreinstalledModule 方法直接获取模块
      const module = await Promise.resolve(this.preinstalledManager.getPreinstalledModule(moduleName))
      if (module) {
        logger.debug(`[ToolModuleImport] Found preinstalled: ${moduleName}`)
        return module
      }
    } catch (error) {
      // 预装包加载失败不是错误，继续尝试其他方式
      logger.debug(`[ToolModuleImport] Preinstalled not available: ${moduleName} - ${(error as Error).message}`)
    }
    return null
  }

  /**
   * 从沙箱加载模块（私有）
   */
  async loadFromSandbox(moduleName: string): Promise<unknown> {
    // 延迟加载 importx
    if (!this.importxFn) {
      const mod = (await import('importx')) as { import: ImportFn }
      this.importxFn = mod.import
    }

    // 构建沙箱的 parentURL
    const packageJsonPath = path.join(this.sandboxPath, 'package.json')
    const parentURL = pathToFileURL(packageJsonPath).href

    // 使用 importx 加载
    return await this.importxFn(moduleName, {
      parentURL,
      cache: true,
      loader: 'auto',
    })
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.moduleCache.clear()
    logger.debug(`[ToolModuleImport] Module cache cleared for tool: ${this.toolId}`)
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): CacheStats {
    return {
      toolId: this.toolId,
      cachedModules: Array.from(this.moduleCache.keys()),
      cacheSize: this.moduleCache.size,
    }
  }
}

export = ToolModuleImport
