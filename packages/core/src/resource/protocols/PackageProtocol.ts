/**
 * 包协议实现
 * 实现@package://协议，智能检测并访问NPM包资源
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE:
 * - ~/ 别名在 packages/core 不工作, 用相对路径 ../utils/DirectoryService
 * - getDirectoryService() 仍是 .js, 类型 unknown
 * - require('@promptx/resource') 保留 inline — 外部包 + asar 兼容
 */
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')
import logger from '@promptx/logger'
import { getDirectoryService } from '../../utils/DirectoryService'

type QueryParams = InstanceType<typeof typesModule.QueryParams>

interface DirectoryServiceLike {
  [k: string]: unknown
}

interface PackageResourceApi {
  resolvePath: (relativePath: string) => string
  exists: (relativePath: string) => boolean
}

class PackageProtocol extends ResourceProtocol {
  public directoryService: DirectoryServiceLike
  public registry: Record<string, unknown>

  constructor(options: { enableCache?: boolean; [k: string]: unknown } = {}) {
    super('package', options)
    this.directoryService = getDirectoryService() as unknown as DirectoryServiceLike
    this.registry = {}
  }

  setRegistry(registry: Record<string, unknown>): void {
    this.registry = registry || {}
  }

  getProtocolInfo(): { name: string; description: string; examples: string[]; installModes: string[] } {
    return {
      name: this.name,
      description: '包协议 - 智能访问NPM包资源，支持多种安装模式',
      examples: [
        '@package://package.json',
        '@package://src/index.js',
        '@package://docs/README.md',
        '@package://resource/core/thought.md',
        '@package://templates/basic/template.md',
      ],
      installModes: [
        'development',
        'local',
        'global',
        'npx',
        'monorepo',
        'link',
      ],
    }
  }

  async getPackageRoot(): Promise<string> {
    try {
      const resourcePath = require.resolve('@promptx/resource')
      logger.info(`[PackageProtocol] require.resolve('@promptx/resource') returned: ${resourcePath}`)

      const distDir = path.dirname(resourcePath)
      logger.info(`[PackageProtocol] Using dist directory as package root: ${distDir}`)

      const resourcesDir = path.join(distDir, 'resources')
      logger.info(`[PackageProtocol] Resources directory path: ${resourcesDir}`)
      logger.info(`[PackageProtocol] Resources directory exists: ${fs.existsSync(resourcesDir)}`)

      return distDir
    } catch (error) {
      logger.error(`[PackageProtocol] Cannot locate @promptx/resource package: ${(error as Error).message}`)
      logger.error(`[PackageProtocol] Error stack: ${(error as Error).stack ?? ''}`)
      logger.error(`[PackageProtocol] This is a critical system error, @promptx/resource must exist and be accessible via require`)
      throw error
    }
  }

  async resolvePath(relativePath: string, _params: QueryParams | null = null): Promise<string> {
    logger.info(`[PackageProtocol] Resolving path: ${relativePath}`)

    try {
      const resourceModule = require('@promptx/resource') as { packageResource: PackageResourceApi }
      logger.info(`[PackageProtocol] Resource module loaded: ${Object.keys(resourceModule).join(',')}`)
      const { packageResource } = resourceModule
      logger.info(`[PackageProtocol] PackageResource type: ${typeof packageResource}`)
      logger.debug(`[PackageProtocol] Successfully loaded PackageResource`)

      const cleanPath = relativePath.replace(/^\/+/, '')
      logger.debug(`[PackageProtocol] Cleaned path: ${cleanPath}`)

      const fullPath = packageResource.resolvePath(cleanPath)
      logger.info(`[PackageProtocol] PackageResource resolved path: ${fullPath}`)

      const exists = packageResource.exists(cleanPath)
      logger.info(`[PackageProtocol] File exists: ${exists} (path: ${fullPath})`)

      if (!exists) {
        logger.error(`[PackageProtocol] Resource file not found: ${fullPath}`)
        throw new Error(`Resource file not found: ${fullPath}`)
      }

      return fullPath
    } catch (error) {
      logger.error(`[PackageProtocol] Failed to resolve resource path: ${(error as Error).message}`)
      logger.error(`[PackageProtocol] Error stack: ${(error as Error).stack ?? ''}`)
      throw error
    }
  }

  validateFileAccess(_packageRoot: string, relativePath: string): void {
    logger.debug(`[PackageProtocol] Validating file access for: ${relativePath}`)
  }

  async exists(resourcePath: string, queryParams: QueryParams | undefined): Promise<boolean> {
    try {
      const resolvedPath = await this.resolvePath(resourcePath, queryParams ?? null)
      await fsPromises.promises.access(resolvedPath)
      return true
    } catch (error) {
      return false
    }
  }

  async loadContent(resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      await fsPromises.promises.access(resolvedPath)
      const content = await fsPromises.promises.readFile(resolvedPath, 'utf8')
      const stats = await fsPromises.promises.stat(resolvedPath)
      const packageRoot = await this.getPackageRoot()
      void stats
      void packageRoot
      return content
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Package resource not found: ${resolvedPath}`)
      }
      throw new Error(`Failed to load package resource: ${(error as Error).message}`)
    }
  }

  getDebugInfo(): Promise<{ protocol: string; packageRoot: string; currentWorkingDirectory: string; moduleDirectory: string; cacheSize: number }> {
    return (async () => ({
      protocol: this.name,
      packageRoot: await this.getPackageRoot(),
      currentWorkingDirectory: process.cwd(),
      moduleDirectory: __dirname,
      cacheSize: this.cache.size,
    }))()
  }

  clearCache(): void {
    super.clearCache()
  }
}

export = PackageProtocol