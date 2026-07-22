/**
 * DiscoveryManager - 资源发现管理器
 *
 * 统一管理多个资源发现器，按照文档架构设计：
 * 1. 按优先级排序发现器 (数字越小优先级越高)
 * 2. 并行执行资源发现
 * 3. 收集并合并所有发现的资源
 * 4. 提供容错机制，单个发现器失败不影响整体
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import logger from '@promptx/logger'
import PackageDiscovery = require('./PackageDiscovery')
import ProjectDiscovery = require('../../project/ProjectDiscovery')
import UserDiscovery = require('./UserDiscovery')

interface DiscoveryLike {
  source?: string
  priority?: number
  discover?: () => Promise<unknown>
  discoverRegistry?: () => Promise<Map<string, string>>
  getDiscoveryInfo?: () => { source: string; priority: number; description: string }
  clearCache?: () => void
}

class DiscoveryManager {
  public discoveries: DiscoveryLike[]

  constructor(discoveries: DiscoveryLike[] | null = null) {
    if (discoveries) {
      this.discoveries = [...discoveries]
    } else {
      // 默认发现器配置：包含包级、项目级和用户级发现
      this.discoveries = [
        new PackageDiscovery(),  // 优先级: 1
        new ProjectDiscovery(),  // 优先级: 2
        new UserDiscovery(),     // 优先级: 3 (最高)
      ]
    }

    // 按优先级排序
    this._sortDiscoveriesByPriority()
  }

  /**
   * 添加发现器
   */
  addDiscovery(discovery: DiscoveryLike): void {
    if (!discovery || typeof discovery.discover !== 'function') {
      throw new Error('Discovery must implement discover method')
    }

    this.discoveries.push(discovery)
    this._sortDiscoveriesByPriority()
  }

  /**
   * 移除发现器
   */
  removeDiscovery(source: string): void {
    this.discoveries = this.discoveries.filter((discovery) => discovery.source !== source)
  }

  /**
   * 发现所有资源（并行模式）
   * @returns {Promise<Array>} 所有发现的资源列表
   */
  async discoverAll(): Promise<unknown[]> {
    const discoveryPromises = this.discoveries.map(async (discovery) => {
      try {
        if (typeof discovery.discover !== 'function') return []
        const resources = await discovery.discover()
        return Array.isArray(resources) ? resources : []
      } catch (error) {
        logger.warn(`[DiscoveryManager] ${discovery.source} discovery failed: ${(error as Error).message}`)
        return []
      }
    })

    // 并行执行所有发现器
    const discoveryResults = await Promise.allSettled(discoveryPromises)

    // 收集所有成功的结果
    const allResources: unknown[] = []
    discoveryResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const value = result.value
        if (Array.isArray(value)) {
          allResources.push(...value)
        }
      } else {
        const discovery = this.discoveries[index]
        if (discovery) {
          logger.warn(`[DiscoveryManager] ${discovery.source} discovery rejected: ${String(result.reason)}`)
        }
      }
    })

    return allResources
  }

  /**
   * 发现并合并所有注册表（RegistryData架构）
   * @returns {Promise<Map>} 合并后的资源注册表 Map<resourceId, reference>
   */
  async discoverRegistries(): Promise<Map<string, string>> {
    const registryPromises = this.discoveries.map(async (discovery) => {
      try {
        // 优先使用新的discoverRegistry方法
        if (typeof discovery.discoverRegistry === 'function') {
          const registry = await discovery.discoverRegistry()
          return registry instanceof Map ? registry : new Map<string, string>()
        }
        // 向后兼容：将discover()结果转换为注册表格式
        if (typeof discovery.discover === 'function') {
          const resources = await discovery.discover()
          const registry = new Map<string, string>()
          if (Array.isArray(resources)) {
            resources.forEach((resource) => {
              const r = resource as { id?: string; reference?: string }
              if (r.id && r.reference) {
                registry.set(r.id, r.reference)
              }
            })
          }
          return registry
        }
        return new Map<string, string>()
      } catch (error) {
        logger.warn(`[DiscoveryManager] ${discovery.source} registry discovery failed: ${(error as Error).message}`)
        return new Map<string, string>()
      }
    })

    // 并行执行所有发现器
    const registryResults = await Promise.allSettled(registryPromises)

    // 收集所有成功的注册表
    const registries: Map<string, string>[] = []
    registryResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        registries.push(result.value)
      } else {
        const discovery = this.discoveries[index]
        if (discovery) {
          logger.warn(`[DiscoveryManager] ${discovery.source} registry discovery rejected: ${String(result.reason)}`)
        }
        registries.push(new Map<string, string>())
      }
    })

    // 按发现器优先级合并注册表
    return this._mergeRegistries(registries)
  }

  /**
   * 按源类型发现注册表
   * @returns {Promise<Map>} 指定源的资源注册表
   */
  async discoverRegistryBySource(source: string): Promise<Map<string, string>> {
    const discovery = this._findDiscoveryBySource(source)
    if (!discovery) {
      throw new Error(`Discovery source ${source} not found`)
    }

    if (typeof discovery.discoverRegistry === 'function') {
      return await discovery.discoverRegistry()
    }
    // 向后兼容：将discover()结果转换为注册表格式
    if (typeof discovery.discover === 'function') {
      const resources = await discovery.discover()
      const registry = new Map<string, string>()
      if (Array.isArray(resources)) {
        resources.forEach((resource) => {
          const r = resource as { id?: string; reference?: string }
          if (r.id && r.reference) {
            registry.set(r.id, r.reference)
          }
        })
      }
      return registry
    }
    return new Map<string, string>()
  }

  /**
   * 按源类型发现资源
   * @returns {Promise<Array>} 指定源的资源列表
   */
  async discoverBySource(source: string): Promise<unknown> {
    const discovery = this._findDiscoveryBySource(source)
    if (!discovery) {
      throw new Error(`Discovery source ${source} not found`)
    }

    if (typeof discovery.discover !== 'function') {
      return []
    }
    return await discovery.discover()
  }

  /**
   * 获取所有发现器信息
   */
  getDiscoveryInfo(): Array<{ source: string; priority: number; description: string }> {
    return this.discoveries.map((discovery) => {
      if (typeof discovery.getDiscoveryInfo === 'function') {
        return discovery.getDiscoveryInfo()
      }
      return {
        source: discovery.source || 'UNKNOWN',
        priority: discovery.priority || 0,
        description: 'No description available',
      }
    })
  }

  /**
   * 清理所有发现器缓存
   */
  clearCache(): void {
    this.discoveries.forEach((discovery) => {
      if (typeof discovery.clearCache === 'function') {
        discovery.clearCache()
      }
    })
  }

  /**
   * 获取发现器数量
   */
  getDiscoveryCount(): number {
    return this.discoveries.length
  }

  /**
   * 合并多个注册表（支持分层级资源管理）
   * @param registries 注册表数组，按优先级排序（数字越小优先级越高）
   * @returns 合并后的注册表
   */
  _mergeRegistries(registries: Array<Map<string, string>>): Map<string, string> {
    const mergedRegistry = new Map<string, string>()

    // 第一阶段：收集所有资源（包括带前缀的）
    for (let i = registries.length - 1; i >= 0; i--) {
      const registry = registries[i]
      if (registry instanceof Map) {
        for (const [key, value] of registry) {
          mergedRegistry.set(key, value)
        }
      }
    }

    // 第二阶段：处理优先级覆盖 - 高优先级的无前缀版本覆盖低优先级的
    const priorityLevels = ['package', 'project', 'user'] // 优先级：package < project < user

    // 为每个基础资源ID找到最高优先级的版本
    interface BaseResourceInfo {
      source: string
      reference: string
      priority: number
      fullId: string
    }
    const baseResourceMap = new Map<string, BaseResourceInfo>() // baseId -> {source, reference, priority}

    for (const [fullId, reference] of mergedRegistry) {
      // 解析资源ID：可能是 "source:resourceId" 或 "resourceId"
      const colonIndex = fullId.indexOf(':')
      let source = 'unknown'
      let baseId = fullId

      if (colonIndex !== -1) {
        const possibleSource = fullId.substring(0, colonIndex)
        if (priorityLevels.includes(possibleSource)) {
          source = possibleSource
          baseId = fullId.substring(colonIndex + 1)
        }
      }

      const currentPriority = priorityLevels.indexOf(source)
      const existing = baseResourceMap.get(baseId)

      if (!existing || currentPriority > existing.priority) {
        baseResourceMap.set(baseId, {
          source,
          reference,
          priority: currentPriority,
          fullId,
        })
      }
    }

    // 第三阶段：构建最终注册表
    const finalRegistry = new Map<string, string>()

    // 1. 添加所有带前缀的资源（用于明确指定级别）
    for (const [key, value] of mergedRegistry) {
      if (key.includes(':') && priorityLevels.includes(key.split(':')[0] ?? '')) {
        finalRegistry.set(key, value)
      }
    }

    // 2. 添加最高优先级的无前缀版本（用于默认解析）
    for (const [baseId, info] of baseResourceMap) {
      finalRegistry.set(baseId, info.reference)
    }

    return finalRegistry
  }

  /**
   * 按优先级排序发现器
   */
  _sortDiscoveriesByPriority(): void {
    this.discoveries.sort((a, b) => {
      const priorityA = a.priority || 0
      const priorityB = b.priority || 0
      return priorityA - priorityB // 升序排序，数字越小优先级越高
    })
  }

  /**
   * 根据源类型查找发现器
   * @returns 找到的发现器或undefined
   */
  _findDiscoveryBySource(source: string): DiscoveryLike | undefined {
    return this.discoveries.find((discovery) => discovery.source === source)
  }
}

export = DiscoveryManager