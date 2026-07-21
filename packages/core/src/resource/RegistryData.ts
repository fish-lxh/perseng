/**
 * RegistryData - 注册表数据管理器 v2.0
 * 基于ResourceData数组的全新架构，严格区分资源来源(source)和资源种类(protocol)
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace，
 * 旧 .js 消费者 (resourceManager.js, FilePatternDiscovery.js, PackageDiscovery.js,
 * UserDiscovery.js) 直接 `require('./RegistryData')` 当 class 用 (`RegistryData.createEmpty()`,
 * `instanceof RegistryData`)。
 */
import fs from 'fs-extra'
import path from 'path'
import ResourceDataModule = require('./ResourceData')

type ResourceData = InstanceType<typeof ResourceDataModule>
type ResourceDataInit = Parameters<typeof ResourceDataModule.fromRawData>[0]

interface RegistryMetadata {
  version: string
  description: string
  createdAt: string
  updatedAt: string
  resourceCount?: number
  [k: string]: unknown
}

class RegistryData {
  public source: string
  public filePath: string | null
  public resources: ResourceData[]
  public metadata: RegistryMetadata
  public cache: Map<string, unknown>

  constructor(
    source: string,
    filePath: string | null,
    resources: ResourceData[] = [],
    metadata: Record<string, unknown> = {},
  ) {
    this.source = source
    this.filePath = filePath
    this.resources = resources.map((r) =>
      r instanceof ResourceDataModule ? r : ResourceDataModule.fromRawData(r as unknown as ResourceDataInit),
    )
    this.metadata = {
      version: '2.0.0',
      description: `${source} 级资源注册表`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...metadata,
    }
    this.cache = new Map()
  }

  /**
   * 从文件加载注册表数据
   */
  static async fromFile(source: string, filePath: string): Promise<RegistryData> {
    try {
      const data = (await fs.readJSON(filePath)) as {
        version?: string
        resources?: unknown
        timestamp?: string
      }

      // 处理新格式（v2.0）
      if (data.version === '2.0.0' && Array.isArray(data.resources)) {
        return new RegistryData(
          source,
          filePath,
          data.resources as ResourceData[],
          data as unknown as Record<string, unknown>,
        )
      }

      // 处理旧格式（v1.0）- 自动转换
      if (data.resources && typeof data.resources === 'object') {
        const resources: ResourceData[] = []
        for (const [protocol, resourcesOfType] of Object.entries(data.resources)) {
          if (resourcesOfType && typeof resourcesOfType === 'object') {
            for (const [_id, reference] of Object.entries(resourcesOfType as Record<string, string>)) {
              const ref = reference.replace(/^@\w+:\/\//, '')
              const resourceData = ResourceDataModule.fromFilePath(ref, source, protocol, reference)
              if (resourceData) {
                // 防御 null/undefined
                resources.push(resourceData)
              }
            }
          }
        }
        return new RegistryData(source, filePath, resources, {
          migratedFrom: 'v1.0.0',
          originalTimestamp: data.timestamp,
        })
      }

      throw new Error(`Unsupported registry format in ${filePath}`)
    } catch (error) {
      throw new Error(`Failed to load ${source} registry from ${filePath}: ${(error as Error).message}`)
    }
  }

  /**
   * 创建空的注册表数据
   */
  static createEmpty(source: string, filePath: string | null): RegistryData {
    return new RegistryData(source, filePath, [], {
      description: `${source} 级资源注册表`,
      createdAt: new Date().toISOString(),
    })
  }

  /**
   * 添加资源
   */
  addResource(resource: ResourceData | ResourceDataInit): void {
    if (!resource) return
    const resourceData = resource instanceof ResourceDataModule
      ? resource
      : ResourceDataModule.fromRawData(resource as ResourceDataInit)
    if (!resourceData) return

    // 对于merged类型的注册表，保持原始来源信息
    // 只有在非merged注册表中才强制统一来源
    if (this.source !== 'merged' && resourceData.source !== this.source) {
      resourceData.source = this.source
    }

    // 检查是否已存在相同ID的资源
    const existingIndex = this.resources.findIndex(
      (r) => r.id === resourceData.id && r.protocol === resourceData.protocol,
    )

    if (existingIndex >= 0) {
      // 更新现有资源
      this.resources[existingIndex] = resourceData
    } else {
      // 添加新资源
      this.resources.push(resourceData)
    }

    this._updateMetadata()
    this.cache.clear()
  }

  /**
   * 移除资源
   */
  removeResource(id: string, protocol: string): boolean {
    const initialLength = this.resources.length
    this.resources = this.resources.filter((r) => !(r.id === id && r.protocol === protocol))

    const removed = this.resources.length < initialLength
    if (removed) {
      this._updateMetadata()
      this.cache.clear()
    }

    return removed
  }

  /**
   * 查找资源
   */
  findResources(filters: Record<string, unknown> = {}): ResourceData[] {
    return this.resources.filter((resource) => {
      if (!resource) return false
      return resource.matches(filters)
    })
  }

  /**
   * 根据ID查找资源
   */
  findResourceById(id: string, protocol: string | null = null): ResourceData | null {
    return (
      this.resources.find((r) => {
        if (!r) return false
        if (protocol) {
          return r.id === id && r.protocol === protocol
        }
        return r.id === id
      }) ?? null
    )
  }

  /**
   * 获取指定协议类型的所有资源
   */
  getResourcesByProtocol(protocol: string): ResourceData[] {
    return this.resources.filter((r) => r && r.protocol === protocol)
  }

  /**
   * 获取资源Map（兼容旧接口）
   */
  getResourceMap(includeSourcePrefix: boolean = true): Map<string, string> {
    const cacheKey = `resourceMap_${includeSourcePrefix}`
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as Map<string, string>
    }

    const registry = new Map<string, string>()

    for (const resource of this.resources) {
      if (!resource) continue
      if (includeSourcePrefix) {
        registry.set(resource.getFullId(), resource.reference)
        registry.set(resource.getBaseId(), resource.reference)
      } else {
        registry.set(resource.getBaseId(), resource.reference)
      }
    }

    this.cache.set(cacheKey, registry)
    return registry
  }

  /**
   * 获取所有资源数据
   */
  getAllResources(): ResourceData[] {
    return [...this.resources]
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalResources: number; byProtocol: Record<string, number>; bySource: Record<string, number> } {
    const stats = {
      totalResources: this.resources.length,
      byProtocol: {} as Record<string, number>,
      bySource: {} as Record<string, number>,
    }

    for (const resource of this.resources) {
      if (!resource) continue
      stats.byProtocol[resource.protocol] = (stats.byProtocol[resource.protocol] ?? 0) + 1
      stats.bySource[resource.source] = (stats.bySource[resource.source] ?? 0) + 1
    }

    return stats
  }

  /**
   * 合并其他注册表数据
   */
  merge(otherRegistry: RegistryData, overwrite: boolean = false): void {
    for (const resource of otherRegistry.resources) {
      const existing = this.findResourceById(resource.id, resource.protocol)

      if (!existing || overwrite) {
        this.addResource(resource.clone())
      }
    }
  }

  /**
   * 保存注册表到文件
   */
  async save(): Promise<void> {
    try {
      if (!this.filePath) {
        throw new Error('Cannot save registry: filePath is null')
      }
      // 确保目录存在
      await fs.ensureDir(path.dirname(this.filePath))

      // 更新元数据
      this._updateMetadata()

      // 构建保存数据
      const saveData = {
        version: this.metadata.version,
        source: this.source,
        metadata: this.metadata,
        resources: this.resources.map((r) => r.toJSON()),
        stats: this.getStats(),
      }

      // 保存文件
      await fs.writeJSON(this.filePath, saveData, { spaces: 2 })
    } catch (error) {
      const filePath = this.filePath ?? 'unknown'
      throw new Error(`Failed to save ${this.source} registry to ${filePath}: ${(error as Error).message}`)
    }
  }

  /**
   * 更新元数据
   */
  private _updateMetadata(): void {
    this.metadata.updatedAt = new Date().toISOString()
    this.metadata.resourceCount = this.resources.length
  }

  /**
   * 获取注册表大小
   */
  get size(): number {
    return this.resources.length
  }

  /**
   * 检查注册表是否为空
   */
  isEmpty(): boolean {
    return this.resources.length === 0
  }

  /**
   * 清空所有资源
   */
  clear(): void {
    this.resources = []
    this._updateMetadata()
    this.cache.clear()
  }

  /**
   * 克隆注册表数据
   */
  clone(): RegistryData {
    const clonedResources = this.resources.map((r) => r.clone())
    return new RegistryData(this.source, this.filePath, clonedResources, { ...this.metadata })
  }

  /**
   * 转换为JSON对象
   */
  toJSON(): {
    version: string
    source: string
    metadata: RegistryMetadata
    resources: unknown[]
    stats: { totalResources: number; byProtocol: Record<string, number>; bySource: Record<string, number> }
  } {
    return {
      version: this.metadata.version,
      source: this.source,
      metadata: this.metadata,
      resources: this.resources.map((r) => r.toJSON()),
      stats: this.getStats(),
    }
  }
}

export = RegistryData