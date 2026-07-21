/**
 * 包级资源发现器 - 从 @promptx/resource 包加载系统内置资源
 * 新版本：直接从 npm 包加载，不再依赖文件系统扫描
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE: require('@promptx/resource') 保留 inline (外部包 + asar 兼容)
 */
import path from 'path'
import logger from '@promptx/logger'
import BaseDiscovery = require('./BaseDiscovery')
import RegistryDataModule = require('../RegistryData')
import ResourceDataModule = require('../ResourceData')

type RegistryData = InstanceType<typeof RegistryDataModule>
type ResourceData = InstanceType<typeof ResourceDataModule>

interface PackageResource {
  id: string
  protocol?: string
  reference?: string
  name?: string
  description?: string
  metadata?: {
    path?: string
    modified?: string
    size?: number
    [k: string]: unknown
  }
}

interface PackageRegistry {
  resources?: PackageResource[]
}

interface PackageModule {
  registry?: PackageRegistry
}

class PackageDiscovery extends BaseDiscovery {
  public resourceManager: unknown

  constructor(resourceManager?: unknown) {
    super('PACKAGE')
    this.resourceManager = resourceManager
  }

  async discover(): Promise<Array<{ id: string; reference: string; metadata: Record<string, unknown> }>> {
    try {
      const { registry } = require('@promptx/resource') as PackageModule

      if (!registry) {
        logger.warn('[PackageDiscovery] @promptx/resource 注册表未正确加载')
        return []
      }
      const resources: Array<{ id: string; reference: string; metadata: Record<string, unknown> }> = []

      if (Array.isArray(registry.resources)) {
        for (const resource of registry.resources) {
          resources.push({
            id: resource.id,
            reference: resource.metadata?.path || resource.reference || '',
            metadata: {
              type: resource.protocol ?? '',
              name: resource.name || resource.id,
              description: resource.description,
              modified: resource.metadata?.modified,
              size: resource.metadata?.size,
              source: 'package',
              packageName: '@promptx/resource',
            },
          })
        }
      }

      logger.info(`[PackageDiscovery]  从 @promptx/resource 加载了 ${resources.length} 个系统资源`)
      return resources
    } catch (error) {
      logger.warn(`[PackageDiscovery]  加载 @promptx/resource 失败: ${(error as Error).message}`)
      return []
    }
  }

  async discoverRegistry(): Promise<Map<string, string>> {
    try {
      const { registry } = require('@promptx/resource') as PackageModule

      if (!registry) {
        logger.warn('[PackageDiscovery] @promptx/resource 注册表未正确加载')
        return new Map()
      }

      const registryMap = new Map<string, string>()

      if (Array.isArray(registry.resources)) {
        for (const resource of registry.resources) {
          const reference = resource.reference || `@package://resources/${resource.metadata?.path}`
          registryMap.set(resource.id, reference)
          registryMap.set(`package:${resource.id}`, reference)
        }
      }

      if (registryMap.size > 0) {
        logger.info(`[PackageDiscovery]  从 @promptx/resource 加载了 ${registryMap.size / 2} 个系统资源到注册表`)
      }

      return registryMap
    } catch (error) {
      logger.warn(`[PackageDiscovery]  系统资源注册表加载失败: ${(error as Error).message}`)
      return new Map()
    }
  }

  async getPackageRoot(): Promise<string> {
    try {
      const resourcePackagePath = require.resolve('@promptx/resource')

      let currentDir = path.dirname(resourcePackagePath)
      while (currentDir !== path.dirname(currentDir)) {
        const packageJsonPath = path.join(currentDir, 'package.json')
        try {
          const packageJson = require(packageJsonPath) as { name?: string }
          if (packageJson.name === '@promptx/resource') {
            return currentDir
          }
        } catch {
          // 继续向上查找
        }
        currentDir = path.dirname(currentDir)
      }

      throw new Error('无法找到 @promptx/resource 包的根目录')
    } catch (error) {
      logger.error(`[PackageDiscovery]  获取包根目录失败: ${(error as Error).message}`)
      throw error
    }
  }

  async getRegistryData(): Promise<RegistryData> {
    try {
      logger.info('[PackageDiscovery] Starting getRegistryData...')
      const { registry } = require('@promptx/resource') as PackageModule
      logger.info('[PackageDiscovery] @promptx/resource loaded successfully')

      if (!registry) {
        logger.warn('[PackageDiscovery] Registry is empty')
        return new RegistryDataModule('package', '', [])
      }

      logger.info(`[PackageDiscovery] Registry loaded with ${registry.resources?.length || 0} resources`)
      const resources: ResourceData[] = []

      if (Array.isArray(registry.resources)) {
        for (const resource of registry.resources) {
          resources.push(new ResourceDataModule({
            id: resource.id,
            source: 'package',
            protocol: resource.protocol ?? '',
            name: resource.name || resource.id,
            description: resource.description || '',
            reference: resource.reference ?? '',
            metadata: resource.metadata || {},
          }))
        }
      }

      logger.info(`[PackageDiscovery] Successfully created ${resources.length} ResourceData objects`)
      return new RegistryDataModule('package', '@promptx/resource', resources)
    } catch (error) {
      logger.error(`[PackageDiscovery] Error in getRegistryData: ${(error as Error).message}`)
      logger.error(`[PackageDiscovery] Stack trace: ${(error as Error).stack ?? ''}`)
      logger.warn(`[PackageDiscovery] 获取注册表数据失败: ${(error as Error).message}`)
      return new RegistryDataModule('package', '', [])
    }
  }

  getEnvironmentInfo(): { type: string; source: string; loaded: boolean } {
    return {
      type: 'PackageDiscovery',
      source: '@promptx/resource',
      loaded: this._tryRequirePackage() !== null,
    }
  }

  _tryRequirePackage(): { registry: PackageRegistry } | null {
    try {
      const { registry } = require('@promptx/resource') as PackageModule
      return registry ? { registry } : null
    } catch {
      return null
    }
  }
}

export = PackageDiscovery