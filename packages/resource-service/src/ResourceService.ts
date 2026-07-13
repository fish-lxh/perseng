/**
 * ResourceService — 应用层服务 — KNUTH-FEAT 2026-07-11 G2.2.
 *
 * 从 apps/desktop/src/main/application/ResourceService.ts 抽出。
 * 业务规则在 Repository 之上: 激活角色权限校验、错误消息格式化、
 * 缓存控制等。host 提供 Repository + ActivationAdapter, Service 不关心。
 */

import type {
  GroupedResources,
  Resource,
  ResourceRepository,
  ResourceSource,
  ResourceStatistics,
  ResourceType,
} from './domain/Resource.js'
import type { ActivationAdapter } from './domain/ActivationAdapter.js'

export class ResourceService {
  constructor(
    private readonly repository: ResourceRepository,
    private readonly activationAdapter: ActivationAdapter
  ) {}

  async getAllResources(): Promise<Resource[]> {
    return this.repository.findAll()
  }

  async getResourcesByType(type: ResourceType): Promise<Resource[]> {
    return this.repository.findByType(type)
  }

  async getResourcesBySource(source: ResourceSource): Promise<Resource[]> {
    return this.repository.findBySource(source)
  }

  async getGroupedResources(): Promise<GroupedResources> {
    return this.repository.getGroupedBySource()
  }

  async getStatistics(): Promise<ResourceStatistics> {
    return this.repository.getStatistics()
  }

  async searchResources(query: string): Promise<Resource[]> {
    return this.repository.search(query)
  }

  async activateRole(
    roleId: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const resource = await this.repository.findById(roleId)
      if (!resource) return { success: false, message: '角色不存在' }
      if (resource.type !== 'role') {
        return { success: false, message: '只能激活角色类型的资源' }
      }

      return await this.activationAdapter.activate(roleId)
    } catch (error) {
      const message = error instanceof Error ? error.message : '激活失败'
      return { success: false, message }
    }
  }

  async updateResourceMetadata(
    id: string,
    updates: { name?: string; description?: string }
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const resource = await this.repository.findById(id)
      if (!resource) return { success: false, message: '资源不存在' }
      if (resource.source !== 'user') {
        return { success: false, message: '仅支持修改用户资源的元数据' }
      }
      return await this.repository.updateMetadata(id, updates)
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新失败'
      return { success: false, message }
    }
  }

  invalidateCache(): void {
    this.repository.invalidateCache()
  }
}
