/**
 * PersengResourceRepository — @promptx/core/pouch DiscoverCommand 的
 * 适配器实现 — KNUTH-FEAT 2026-07-11 G2.2.
 *
 * 从 apps/desktop/src/main/infrastructure/PersengResourceRepository.ts
 * 抽出。Repository 把 Perseng runtime 的角色 + 工具资源 (v1 + v2)
 * 适配成统一 Resource 接口。5 秒 TTL 缓存。
 *
 * 注意: 只 import @promptx/core/pouch 子路径 (Phase 3 落地后), 不再
 * 走 core.pouch.commands 这种三连兼容链。
 */

import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'fs-extra'
import { createRequire } from 'node:module'

import type {
  GroupedResources,
  Resource,
  ResourceRepository,
  ResourceSource,
  ResourceStatistics,
  ResourceType,
} from './domain/Resource.js'

// KNUTH-FEAT 2026-07-11 G2.2: tsup.config shims=true 让 import.meta.url 在 CJS bundle
// 里指向真实的 file URL; createRequire 才能解析 @promptx/core/pouch 这样的 cross-workspace 包。
const _require = createRequire(import.meta.url)
const { DiscoverCommand } = _require('@promptx/core/pouch') as {
  DiscoverCommand: new () => {
    refreshAllResources(): Promise<void>
    loadRoleRegistry(): Promise<CategorizedRegistry>
    loadToolRegistry(): Promise<CategorizedRegistry>
    categorizeBySource(registry: CategorizedRegistry): CategorizedRegistry
  }
}

interface CategorizedRegistry {
  system?: unknown[]
  project?: unknown[]
  user?: unknown[]
  rolex?: unknown[]
}

interface PersengResourceRaw {
  id?: string
  resourceId?: string
  name?: string
  title?: string
  description?: string
  brief?: string
  category?: string
  tags?: string[]
  version?: 'v1' | 'v2'
  personality?: string
  manual?: string
  parameters?: unknown
}

export class PersengResourceRepository implements ResourceRepository {
  private resourcesCache: Resource[] | null = null
  private cacheTimestamp = 0
  private readonly CACHE_TTL = 5000 // 5 seconds
  private discoverCommand: unknown = null

  async findAll(): Promise<Resource[]> {
    return this.getResourcesWithCache()
  }

  async findById(id: string): Promise<Resource | null> {
    const resources = await this.getResourcesWithCache()
    return resources.find((r) => r.id === id) ?? null
  }

  async findByType(type: ResourceType): Promise<Resource[]> {
    const resources = await this.getResourcesWithCache()
    return resources.filter((r) => r.type === type)
  }

  async findBySource(source: ResourceSource): Promise<Resource[]> {
    const resources = await this.getResourcesWithCache()
    return resources.filter((r) => r.source === source)
  }

  async search(query: string): Promise<Resource[]> {
    const resources = await this.getResourcesWithCache()
    const lowerQuery = query.toLowerCase()

    return resources.filter(
      (resource) =>
        resource.name.toLowerCase().includes(lowerQuery) ||
        resource.description.toLowerCase().includes(lowerQuery) ||
        resource.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    )
  }

  async getGroupedBySource(): Promise<GroupedResources> {
    const resources = await this.getResourcesWithCache()

    const grouped: GroupedResources = {
      system: { roles: [], tools: [] },
      project: { roles: [], tools: [] },
      user: { roles: [], tools: [] },
    }

    for (const resource of resources) {
      const sourceGroup = grouped[resource.source]
      if (!sourceGroup) continue
      if (resource.type === 'role') {
        sourceGroup.roles.push(resource)
      } else {
        sourceGroup.tools.push(resource)
      }
    }

    return grouped
  }

  async getStatistics(): Promise<ResourceStatistics> {
    const grouped = await this.getGroupedBySource()

    return {
      totalRoles:
        grouped.system.roles.length +
        grouped.project.roles.length +
        grouped.user.roles.length,
      totalTools:
        grouped.system.tools.length +
        grouped.project.tools.length +
        grouped.user.tools.length,
      systemRoles: grouped.system.roles.length,
      systemTools: grouped.system.tools.length,
      projectRoles: grouped.project.roles.length,
      projectTools: grouped.project.tools.length,
      userRoles: grouped.user.roles.length,
      userTools: grouped.user.tools.length,
    }
  }

  invalidateCache(): void {
    this.resourcesCache = null
    this.cacheTimestamp = 0
  }

  async updateMetadata(
    id: string,
    updates: { name?: string; description?: string }
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // Only user-source resources support metadata update
      const resource = await this.findById(id)
      if (!resource) return { success: false, message: '资源不存在' }
      if (resource.source !== 'user') {
        return { success: false, message: '仅支持修改用户资源的元数据' }
      }

      const resourceDir = path.join(
        os.homedir(),
        '.perseng',
        'resource',
        resource.type,
        id
      )
      const metadataFile = path.join(resourceDir, 'metadata.json')

      const exists = await fs.pathExists(resourceDir)
      if (!exists) return { success: false, message: '资源目录不存在' }

      let metadata: Record<string, unknown> = {}
      if (await fs.pathExists(metadataFile)) {
        try {
          metadata = (await fs.readJson(metadataFile)) as Record<string, unknown>
        } catch {
          metadata = {}
        }
      }

      if (updates.name !== undefined) metadata.name = updates.name
      if (updates.description !== undefined) metadata.description = updates.description
      metadata.updatedAt = new Date().toISOString()

      await fs.writeJson(metadataFile, metadata, { spaces: 2 })
      // invalidate cache so next read sees fresh data
      this.resourcesCache = null

      return { success: true, message: '元数据更新成功' }
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新元数据失败'
      console.error('Failed to update resource metadata:', message)
      return { success: false, message }
    }
  }

  private async getResourcesWithCache(): Promise<Resource[]> {
    const now = Date.now()

    if (this.resourcesCache && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.resourcesCache
    }

    this.resourcesCache = await this.fetchResourcesFromPerseng()
    this.cacheTimestamp = now
    return this.resourcesCache
  }

  private getDiscoverCommand(): {
    refreshAllResources(): Promise<void>
    loadRoleRegistry(): Promise<CategorizedRegistry>
    loadToolRegistry(): Promise<CategorizedRegistry>
    categorizeBySource(registry: CategorizedRegistry): CategorizedRegistry
  } {
    if (!this.discoverCommand) {
      this.discoverCommand = new DiscoverCommand()
    }
    return this.discoverCommand as ReturnType<typeof this.getDiscoverCommand>
  }

  private async fetchResourcesFromPerseng(): Promise<Resource[]> {
    try {
      const discoverCommand = this.getDiscoverCommand()

      await discoverCommand.refreshAllResources()
      const roleRegistry = await discoverCommand.loadRoleRegistry()
      const toolRegistry = await discoverCommand.loadToolRegistry()

      const roleCategories = discoverCommand.categorizeBySource(roleRegistry)
      const toolCategories = discoverCommand.categorizeBySource(toolRegistry)

      const resources: Resource[] = []
      await this.processRoles(roleCategories, resources)
      await this.processTools(toolCategories, resources)

      return resources
    } catch (error) {
      console.error('Failed to fetch resources from Perseng:', error)
      return []
    }
  }

  private async processRoles(
    categories: CategorizedRegistry,
    resources: Resource[]
  ): Promise<void> {
    if (categories.system) {
      for (const role of categories.system as PersengResourceRaw[]) {
        const resource = await this.convertToResource(role, 'role', 'system')
        if (role.version === 'v2') resource.version = 'v2'
        resources.push(resource)
      }
    }
    if (categories.project) {
      for (const role of categories.project as PersengResourceRaw[]) {
        resources.push(await this.convertToResource(role, 'role', 'project'))
      }
    }
    if (categories.user) {
      for (const role of categories.user as PersengResourceRaw[]) {
        resources.push(await this.convertToResource(role, 'role', 'user'))
      }
    }
    if (categories.rolex) {
      for (const role of categories.rolex as PersengResourceRaw[]) {
        const resource = await this.convertToResource(role, 'role', 'user')
        resource.version = 'v2'
        resources.push(resource)
      }
    }
  }

  private async processTools(
    categories: CategorizedRegistry,
    resources: Resource[]
  ): Promise<void> {
    if (categories.system) {
      for (const tool of categories.system as PersengResourceRaw[]) {
        resources.push(await this.convertToResource(tool, 'tool', 'system'))
      }
    }
    if (categories.project) {
      for (const tool of categories.project as PersengResourceRaw[]) {
        resources.push(await this.convertToResource(tool, 'tool', 'project'))
      }
    }
    if (categories.user) {
      for (const tool of categories.user as PersengResourceRaw[]) {
        resources.push(await this.convertToResource(tool, 'tool', 'user'))
      }
    }
  }

  private async convertToResource(
    persengResource: PersengResourceRaw,
    type: ResourceType,
    source: ResourceSource
  ): Promise<Resource> {
    const resourceId =
      persengResource.id || persengResource.resourceId || 'unknown'

    // For user resources, try to read custom metadata
    let customMetadata: { name?: string; description?: string; updatedAt?: string } = {}
    if (source === 'user') {
      try {
        const isV2Role = type === 'role' && persengResource.version === 'v2'
        const resourceDir = isV2Role
          ? path.join(os.homedir(), '.rolex', 'roles', resourceId)
          : path.join(os.homedir(), '.perseng', 'resource', type, resourceId)
        const metadataFile = path.join(resourceDir, 'metadata.json')

        if (await fs.pathExists(metadataFile)) {
          customMetadata = await fs.readJson(metadataFile)
        }
      } catch (error) {
        console.warn(
          `Failed to read custom metadata for ${resourceId}:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    const resource: Resource = {
      id: resourceId,
      name:
        customMetadata.name ||
        persengResource.name ||
        persengResource.title ||
        resourceId ||
        'Unknown',
      description:
        customMetadata.description ||
        persengResource.description ||
        persengResource.brief ||
        '暂无描述',
      type,
      source,
      category: persengResource.category || 'general',
      tags: persengResource.tags || [],
      createdAt: new Date(),
      updatedAt: customMetadata.updatedAt
        ? new Date(customMetadata.updatedAt)
        : new Date(),
    }

    if (type === 'role' && persengResource.personality) {
      resource.personality = persengResource.personality
    }
    if (type === 'tool') {
      if (persengResource.manual) resource.manual = persengResource.manual
      if (persengResource.parameters) resource.parameters = persengResource.parameters
    }

    return resource
  }
}
