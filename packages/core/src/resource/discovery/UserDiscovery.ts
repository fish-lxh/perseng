/**
 * UserDiscovery - User 级资源发现器
 *
 * 核心设计原则：
 * 1. 基于 @user 协议，扫描 ~/.perseng/resource 目录
 * 2. 优先使用注册表，fallback 到动态扫描
 * 3. 与 ProjectDiscovery 保持相同的目录结构和扫描逻辑
 * 4. User 级资源具有最高优先级（priority = 3）
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE: 循环依赖风险 — UserDiscovery 通过 inline require('../../resource')
 * 拿 getGlobalResourceManager(), 避免顶层 import 循环。
 */
import fs from 'fs-extra'
import path from 'path'
import logger from '@promptx/logger'
import BaseDiscovery = require('./BaseDiscovery')
import RegistryDataModule = require('../RegistryData')
import ResourceDataModule = require('../ResourceData')

type RegistryData = InstanceType<typeof RegistryDataModule>

interface UserProtocolLike {
  resolvePath: (subPath: string) => Promise<string>
}

interface DiscoveredResource {
  id: string
  protocol: string
  reference: string
  source: string
}

class UserDiscovery extends BaseDiscovery {
  public userProtocol: UserProtocolLike | null

  constructor() {
    super('USER', 3)
    this.userProtocol = null
  }

  getUserProtocol(): UserProtocolLike {
    if (!this.userProtocol) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getGlobalResourceManager } = require('../../resource') as {
        getGlobalResourceManager: () => { protocols: Map<string, UserProtocolLike> }
      }
      const resourceManager = getGlobalResourceManager()
      const userProtocol = resourceManager.protocols.get('user')
      if (!userProtocol) {
        throw new Error('UserProtocol not registered in resource manager')
      }
      this.userProtocol = userProtocol
    }
    return this.userProtocol
  }

  async discoverRegistry(): Promise<Map<string, string>> {
    try {
      const registryMap = await this.loadFromRegistry()
      if (registryMap.size > 0) {
        logger.debug(`UserDiscovery 从注册表加载 ${registryMap.size} 个资源`)
        return registryMap
      }

      logger.debug('UserDiscovery 注册表不存在，使用动态扫描')
      const resources = await this.scanUserResources()
      return this.buildRegistryFromResources(resources)
    } catch (error) {
      logger.warn(`[UserDiscovery] Registry discovery failed: ${(error as Error).message}`)
      return new Map()
    }
  }

  async loadFromRegistry(): Promise<Map<string, string>> {
    try {
      const protocol = this.getUserProtocol()
      const registryPath = await protocol.resolvePath('.perseng/resource/user.registry.json')

      if (!(await fs.pathExists(registryPath))) {
        return new Map()
      }

      const registryData = await RegistryDataModule.fromFile('user', registryPath)
      return registryData.getResourceMap(true)
    } catch (error) {
      logger.warn(`[UserDiscovery] Failed to load registry: ${(error as Error).message}`)
      return new Map()
    }
  }

  async scanUserResources(): Promise<DiscoveredResource[]> {
    try {
      const protocol = this.getUserProtocol()
      const resourceDir = await protocol.resolvePath('.perseng/resource')

      if (!(await fs.pathExists(resourceDir))) {
        logger.debug('UserDiscovery User 资源目录不存在')
        return []
      }

      const tempRegistry = RegistryDataModule.createEmpty('user', null)

      await this._scanDirectory(resourceDir, tempRegistry)

      const resources: DiscoveredResource[] = []
      for (const resource of tempRegistry.resources) {
        resources.push({
          id: resource.id,
          protocol: resource.protocol,
          reference: resource.reference,
          source: resource.source,
        })
      }

      logger.info(`[UserDiscovery] User 扫描完成，发现 ${resources.length} 个资源`)
      return resources
    } catch (error) {
      logger.warn(`[UserDiscovery] 扫描 User 资源失败: ${(error as Error).message}`)
      return []
    }
  }

  async _scanDirectory(resourcesDir: string, registryData: RegistryData): Promise<void> {
    try {
      await this._recursiveScan(resourcesDir, '', registryData)
    } catch (error) {
      logger.warn(`[UserDiscovery] 扫描资源目录失败: ${(error as Error).message}`)
    }
  }

  async _recursiveScan(currentPath: string, relativePath: string, registryData: RegistryData): Promise<void> {
    try {
      const items = await fs.readdir(currentPath)

      for (const item of items) {
        const itemPath = path.join(currentPath, item)
        const stat = await fs.stat(itemPath)
        const newRelativePath = relativePath ? `${relativePath}/${item}` : item

        if (stat.isDirectory()) {
          await this._recursiveScan(itemPath, newRelativePath, registryData)
        } else {
          await this._processFile(itemPath, newRelativePath, registryData)
        }
      }
    } catch (error) {
      logger.warn(`[UserDiscovery] 扫描${currentPath}失败: ${(error as Error).message}`)
    }
  }

  async _processFile(filePath: string, relativePath: string, registryData: RegistryData): Promise<void> {
    const fileName = path.basename(filePath)
    let protocol: string | null = null
    let resourceId: string | null = null

    logger.debug(`[UserDiscovery._processFile] Processing: ${relativePath} (file: ${fileName})`)

    if (fileName.endsWith('.role.md')) {
      protocol = 'role'
      resourceId = path.basename(fileName, '.role.md')
    } else if (fileName.endsWith('.thought.md')) {
      protocol = 'thought'
      resourceId = path.basename(fileName, '.thought.md')
    } else if (fileName.endsWith('.execution.md')) {
      protocol = 'execution'
      resourceId = path.basename(fileName, '.execution.md')
    } else if (fileName.endsWith('.knowledge.md')) {
      protocol = 'knowledge'
      resourceId = path.basename(fileName, '.knowledge.md')
    } else if (fileName.endsWith('.tool.js')) {
      protocol = 'tool'
      resourceId = path.basename(fileName, '.tool.js')
    } else if (fileName.endsWith('.manual.md')) {
      protocol = 'manual'
      resourceId = path.basename(fileName, '.manual.md')
    }

    if (protocol && resourceId) {
      logger.info(`[UserDiscovery._processFile] Found ${protocol} resource: ${resourceId}`)

      if (await this._validateResourceFile(filePath, protocol)) {
        const reference = `@user://.perseng/resource/${relativePath}`

        const resourceData = new ResourceDataModule({
          id: resourceId,
          source: 'user',
          protocol: protocol,
          name: ResourceDataModule._generateDefaultName(resourceId, protocol),
          description: ResourceDataModule._generateDefaultDescription(resourceId, protocol),
          reference: reference,
          metadata: {
            scannedAt: new Date().toISOString(),
            path: relativePath,
          },
        })

        registryData.addResource(resourceData)
        logger.info(`[UserDiscovery] 成功添加${protocol}资源: ${resourceId} at ${relativePath}`)
      }
    }
  }

  async _validateResourceFile(filePath: string, protocol: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')

      if (!content || typeof content !== 'string') {
        return false
      }

      const trimmedContent = content.trim()
      if (trimmedContent.length === 0) {
        return false
      }

      switch (protocol) {
        case 'role':
          return /<role[\s>]/.test(trimmedContent) && trimmedContent.includes('</role>')
        case 'execution':
          return /<execution[\s>]/.test(trimmedContent) && trimmedContent.includes('</execution>')
        case 'thought':
          return /<thought[\s>]/.test(trimmedContent) && trimmedContent.includes('</thought>')
        case 'knowledge':
          return true
        case 'manual':
          return /<manual[\s>]/.test(trimmedContent) && trimmedContent.includes('</manual>')
        case 'tool':
          return true
        default:
          return false
      }
    } catch (error) {
      logger.warn(`[UserDiscovery] Failed to validate ${filePath}: ${(error as Error).message}`)
      return false
    }
  }

  buildRegistryFromResources(resources: DiscoveredResource[]): Map<string, string> {
    const registryMap = new Map<string, string>()

    resources.forEach((resource) => {
      const key = `user:${resource.id}`
      registryMap.set(key, resource.reference)
    })

    return registryMap
  }

  async generateRegistry(): Promise<RegistryData> {
    try {
      const protocol = this.getUserProtocol()
      const registryPath = await protocol.resolvePath('.perseng/resource/user.registry.json')

      const registryData = RegistryDataModule.createEmpty('user', registryPath)

      const resourceDir = await protocol.resolvePath('.perseng/resource')

      if (await fs.pathExists(resourceDir)) {
        await this._scanDirectory(resourceDir, registryData)
      }

      await fs.ensureDir(path.dirname(registryPath))
      await registryData.save()

      logger.info(`[UserDiscovery] User 注册表生成完成，发现 ${registryData.size} 个资源`)
      return registryData
    } catch (error) {
      logger.error(`[UserDiscovery] 生成注册表失败: ${(error as Error).message}`)
      return RegistryDataModule.createEmpty('user', null)
    }
  }

  async getRegistryData(): Promise<RegistryData> {
    try {
      const protocol = this.getUserProtocol()
      const registryPath = await protocol.resolvePath('.perseng/resource/user.registry.json')

      if (await fs.pathExists(registryPath)) {
        const registryData = await RegistryDataModule.fromFile('user', registryPath)

        if (registryData.size > 0) {
          logger.info(`[UserDiscovery] 从注册表加载 ${registryData.size} 个资源`)
          return registryData
        }
      }

      logger.info(`[UserDiscovery] User 注册表无效，重新生成`)
      return await this.generateRegistry()
    } catch (error) {
      logger.error(`[UserDiscovery] 获取注册表数据失败: ${(error as Error).message}`)
      return RegistryDataModule.createEmpty('user', null)
    }
  }

  async discover(): Promise<Array<{ id: string; reference: string; metadata: Record<string, unknown> }>> {
    const registryMap = await this.discoverRegistry()
    const resources: Array<{ id: string; reference: string; metadata: Record<string, unknown> }> = []

    for (const [key, reference] of registryMap) {
      const [source, id] = key.split(':')
      if (source === 'user' && id) {
        resources.push({
          id,
          reference,
          metadata: { source: 'user' },
        })
      }
    }

    return resources
  }
}

export = UserDiscovery