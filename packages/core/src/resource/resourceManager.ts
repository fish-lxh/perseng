/**
 * ResourceManager - 资源管理器门面
 *
 * 统一编排：
 * 1. RegistryData（v2.0 合并注册表）
 * 2. ResourceProtocolParser（DPML @protocol://path?params 解析）
 * 3. DiscoveryManager（package / project / user 三级发现）
 * 4. 13 个协议处理器（基础 4 + 逻辑 9）
 *
 * KNUTH-FIX 2026-07-22: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import logger from '@promptx/logger'
import RegistryDataModule = require('./RegistryData')
import ResourceProtocolParserModule = require('./resourceProtocolParser')
import DiscoveryManagerModule = require('./discovery/DiscoveryManager')
import PackageProtocolModule = require('./protocols/PackageProtocol')
import ProjectProtocolModule = require('./protocols/ProjectProtocol')
import RoleProtocolModule = require('./protocols/RoleProtocol')
import ThoughtProtocolModule = require('./protocols/ThoughtProtocol')
import ExecutionProtocolModule = require('./protocols/ExecutionProtocol')
import KnowledgeProtocolModule = require('./protocols/KnowledgeProtocol')
import ToolProtocolModule = require('./protocols/ToolProtocol')
import ManualProtocolModule = require('./protocols/ManualProtocol')
import SkillProtocolModule = require('./protocols/SkillProtocol')
import PersonaProtocolModule = require('./protocols/PersonaProtocol')
import UserProtocolModule = require('./protocols/UserProtocol')
import FileProtocolModule = require('./protocols/FileProtocol')
import typesModule = require('./types')

type RegistryData = InstanceType<typeof RegistryDataModule>
type ResourceProtocolParser = InstanceType<typeof ResourceProtocolParserModule>
type DiscoveryManager = InstanceType<typeof DiscoveryManagerModule>
type QueryParams = InstanceType<typeof typesModule.QueryParams>

type ResourceProtocolLike = {
  resolve: (path: string, queryParams: QueryParams) => Promise<string | { content?: string; [k: string]: unknown }>
  setRegistryManager?: (manager: unknown) => void
}

interface ParsedReference {
  protocol: string
  path: string
  queryParams: QueryParams
}

interface LoadResourceResult {
  success: boolean
  content?: string
  resourceId: string
  reference?: string
  error?: Error
}

interface ProtocolResolveResult {
  success: boolean
  protocol?: string
  path?: string
  queryParams?: QueryParams
  reference?: string
  error?: string
}

interface RegistryStats {
  bySource?: Record<string, number>
  byProtocol?: Record<string, number>
}

class ResourceManager {
  public registryData: RegistryData
  public protocolParser: ResourceProtocolParser
  public parser: ResourceProtocolParser
  public discoveryManager: DiscoveryManager
  public protocols: Map<string, ResourceProtocolLike>
  public _initialized: boolean

  constructor() {
    // 新架构：统一的资源注册表
    this.registryData = RegistryDataModule.createEmpty('merged', null)

    // 协议解析器
    this.protocolParser = new ResourceProtocolParserModule()
    this.parser = new ResourceProtocolParserModule() // 向后兼容别名

    // 资源发现管理器
    this.discoveryManager = new DiscoveryManagerModule()

    // 初始化协议处理器
    this.protocols = new Map()
    this._initialized = false
    this.initializeProtocols()
  }

  /**
   * 初始化所有协议处理器
   */
  initializeProtocols(): void {
    // 基础协议 - 直接文件系统映射
    this.protocols.set('package', new PackageProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('project', new ProjectProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('file', new FileProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('user', new UserProtocolModule() as unknown as ResourceProtocolLike)

    // 逻辑协议 - 需要注册表查询
    this.protocols.set('role', new RoleProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('thought', new ThoughtProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('execution', new ExecutionProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('knowledge', new KnowledgeProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('tool', new ToolProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('manual', new ManualProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('skill', new SkillProtocolModule() as unknown as ResourceProtocolLike)
    this.protocols.set('persona', new PersonaProtocolModule() as unknown as ResourceProtocolLike)
  }

  /**
   * 新架构初始化方法
   */
  async initializeWithNewArchitecture(): Promise<void> {
    try {
      logger.info('[ResourceManager] Starting initialization...')

      // 1. 清空现有注册表
      this.registryData.clear()
      logger.info('[ResourceManager] Cleared existing registry')

      // 2. 清除发现器缓存
      if (this.discoveryManager && typeof this.discoveryManager.clearCache === 'function') {
        this.discoveryManager.clearCache()
        logger.info('[ResourceManager] Cleared discovery cache')
      }

      // 3. 填充新的RegistryData
      logger.info('[ResourceManager] Populating registry data...')
      await this.populateRegistryData()

      // 4. 为逻辑协议设置注册表引用
      this.setupLogicalProtocols()

      // 5. 设置初始化状态
      this._initialized = true

      // 记录初始化完成的统计信息
      const stats = this.registryData.getStats() as RegistryStats
      logger.info(`[ResourceManager] Initialization complete: total=${this.registryData.size} bySource=${JSON.stringify(stats.bySource)} byProtocol=${JSON.stringify(stats.byProtocol)}`)
    } catch (error) {
      logger.warn(`ResourceManager new architecture initialization failed: ${(error as Error).message}`)
      logger.warn('ResourceManager continuing with empty registry')
      this._initialized = true // 即使失败也标记为已初始化，避免重复尝试
    }
  }

  /**
   * 填充新的RegistryData
   */
  async populateRegistryData(): Promise<void> {
    // 清空现有数据
    this.registryData.clear()

    logger.info(`[ResourceManager] Discovery managers: count=${this.discoveryManager.discoveries.length} sources=${JSON.stringify(this.discoveryManager.discoveries.map((d) => d.source))}`)

    // 从各个发现器获取RegistryData并合并
    for (const discovery of this.discoveryManager.discoveries) {
      try {
        logger.info(`[ResourceManager] Loading from ${discovery.source} discovery...`)

        const discoveryAny = discovery as unknown as {
          getRegistryData?: () => Promise<RegistryData | null | undefined>
        }
        if (typeof discoveryAny.getRegistryData === 'function') {
          const registryData = await discoveryAny.getRegistryData()
          if (registryData && (registryData as { resources?: unknown[] }).resources) {
            const resourceCount = (registryData as { size?: number }).size || 0
            logger.info(`[ResourceManager] Found ${resourceCount} resources from ${discovery.source}`)

            // 合并资源到主注册表
            this.registryData.merge(registryData, true) // 允许覆盖

            logger.info(`[ResourceManager] After merging ${discovery.source}, total: ${this.registryData.size}`)
          } else {
            logger.info(`[ResourceManager] No resources found from ${discovery.source}`)
          }
        } else {
          logger.info(`[ResourceManager] ${discovery.source} does not support getRegistryData`)
        }
      } catch (error) {
        logger.warn(`Failed to get RegistryData from ${discovery.source}: ${(error as Error).message}`)
      }
    }

    logger.info(`[ResourceManager] Registry population complete, total resources: ${this.registryData.size}`)
  }

  /**
   * 为逻辑协议设置注册表引用
   */
  setupLogicalProtocols(): void {
    // 将统一注册表传递给逻辑协议处理器
    const logicalProtocolNames = ['role', 'execution', 'thought', 'knowledge', 'tool', 'manual', 'skill', 'persona']

    for (const name of logicalProtocolNames) {
      const protocol = this.protocols.get(name)
      if (protocol && typeof protocol.setRegistryManager === 'function') {
        protocol.setRegistryManager(this)
      }
    }
  }

  /**
   * 通过协议解析加载资源内容
   */
  async loadResourceByProtocol(reference: string): Promise<string> {
    // 1. 使用ResourceProtocolParser解析DPML语法
    const parsed = this.protocolParser.parse(reference) as ParsedReference

    // 2. 获取对应的协议处理器
    const protocol = this.protocols.get(parsed.protocol)
    if (!protocol) {
      throw new Error(`不支持的协议: ${parsed.protocol}`)
    }

    // 3. 委托给协议处理器解析并加载内容
    const result = await protocol.resolve(parsed.path, parsed.queryParams)

    // 4. 确保返回字符串内容，解包可能的对象格式
    if (typeof result === 'string') {
      return result
    }
    if (result && typeof result === 'object' && typeof result.content === 'string') {
      return result.content
    }
    throw new Error(`协议${parsed.protocol}返回了无效的内容格式`)
  }

  async loadResource(resourceId: string): Promise<LoadResourceResult> {
    try {
      // 确保ResourceManager已初始化
      if (!this._initialized) {
        logger.info('[ResourceManager] Initializing resource manager...')
        await this.initializeWithNewArchitecture()
      }

      // 处理@开头的DPML格式（如 @file://path, @!role://java-developer）
      if (resourceId.startsWith('@')) {
        const parsed = this.protocolParser.parse(resourceId) as ParsedReference

        // 对于基础协议（file, user, package, project），直接通过协议处理器加载
        const basicProtocols = ['file', 'user', 'package', 'project']
        if (basicProtocols.includes(parsed.protocol)) {
          const content = await this.loadResourceByProtocol(resourceId)
          return {
            success: true,
            content,
            resourceId,
            reference: resourceId,
          }
        }

        // 对于逻辑协议，从RegistryData查找资源
        logger.debug(`[ResourceManager] Finding resource: protocol=${parsed.protocol}, id=${parsed.path}`)
        const resourceData = this.registryData.findResourceById(parsed.path, parsed.protocol) as
          | { id: string; source: string; reference: string }
          | undefined
        if (!resourceData) {
          throw new Error(`Resource not found: ${parsed.protocol}:${parsed.path}`)
        }
        logger.debug(`[ResourceManager] Found resource: ${resourceData.id} from ${resourceData.source}`)

        // 通过协议解析加载内容
        const content = await this.loadResourceByProtocol(resourceData.reference)

        return {
          success: true,
          content,
          resourceId,
          reference: resourceData.reference,
        }
      }

      // 处理URL格式（如 thought://systematic-testing）
      const urlMatch = resourceId.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\/\/(.+)$/)
      if (urlMatch) {
        const protocol = urlMatch[1]
        const id = urlMatch[2]
        if (!protocol || !id) {
          throw new Error(`Invalid resource URL: ${resourceId}`)
        }
        const resourceData = this.registryData.findResourceById(id, protocol) as
          | { reference: string }
          | undefined
        if (!resourceData) {
          throw new Error(`Resource not found: ${resourceId}`)
        }

        // 通过协议解析加载内容
        const content = await this.loadResourceByProtocol(resourceData.reference)

        return {
          success: true,
          content,
          resourceId,
          reference: resourceData.reference,
        }
      }

      // 处理传统格式（如 role:java-developer）
      let reference: string | null = null

      // 如果包含协议前缀（如 thought:remember）
      if (resourceId.includes(':')) {
        const [protocol, id] = resourceId.split(':', 2)
        if (protocol && id) {
          const resourceData = this.registryData.findResourceById(id, protocol) as
            | { reference: string }
            | undefined
          if (resourceData) {
            reference = resourceData.reference
          }
        }
      } else {
        // 如果没有协议前缀，尝试查找任意协议的资源
        const resourceData = this.registryData.findResourceById(resourceId) as
          | { reference: string }
          | undefined
        if (resourceData) {
          reference = resourceData.reference
        }
      }

      if (!reference) {
        throw new Error(`Resource not found: ${resourceId}`)
      }

      // 通过协议解析加载内容
      const content = await this.loadResourceByProtocol(reference)

      return {
        success: true,
        content,
        resourceId,
        reference,
      }
    } catch (error) {
      logger.debug(`ResourceManager.loadResource failed for ${resourceId}: ${(error as Error).message}`)
      return {
        success: false,
        error: error as Error,
        resourceId,
      }
    }
  }

  /**
   * 解析协议引用并返回相关信息
   */
  async resolveProtocolReference(reference: string): Promise<ProtocolResolveResult> {
    try {
      const parsed = this.protocolParser.parse(reference) as ParsedReference

      return {
        success: true,
        protocol: parsed.protocol,
        path: parsed.path,
        queryParams: parsed.queryParams,
        reference,
      }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        reference,
      }
    }
  }

  /**
   * 获取所有可用的协议列表
   */
  getAvailableProtocols(): string[] {
    return Array.from(this.protocols.keys())
  }

  /**
   * 检查是否支持指定协议
   */
  supportsProtocol(protocol: string): boolean {
    return this.protocols.has(protocol)
  }

  /**
   * 设置初始化状态
   */
  set initialized(value: boolean) {
    this._initialized = value
  }

  /**
   * 获取初始化状态
   */
  get initialized(): boolean {
    return this._initialized || false
  }

  /**
   * 解析资源URL（向后兼容接口）
   * 返回格式：{success: boolean, content?: string, error?: Error}
   */
  async resolve(resourceUrl: string): Promise<LoadResourceResult> {
    return await this.loadResource(resourceUrl)
  }

  /**
   * 获取注册表统计信息
   */
  getStats(): { totalResources: number; protocols: string[]; initialized: boolean } {
    return {
      totalResources: this.registryData.size,
      protocols: this.getAvailableProtocols(),
      initialized: this.initialized,
    }
  }

  /**
   * 刷新资源（重新发现并注册）
   */
  async refreshResources(): Promise<void> {
    try {
      // 1. 标记为未初始化
      this._initialized = false

      // 2. 清空注册表
      this.registryData.clear()

      // 3. 清除发现器缓存
      if (this.discoveryManager && typeof this.discoveryManager.clearCache === 'function') {
        this.discoveryManager.clearCache()
      }

      // 4. 重新初始化
      await this.initializeWithNewArchitecture()
    } catch (error) {
      logger.warn(`ResourceManager resource refresh failed: ${(error as Error).message}`)
      // 失败时保持注册表为空状态，下次调用时重试
    }
  }
}

export = ResourceManager