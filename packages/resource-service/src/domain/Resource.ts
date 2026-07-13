/**
 * Resource 领域模型 + 仓储接口 — KNUTH-FEAT 2026-07-11 G2.2.
 *
 * 从 apps/desktop/src/main/domain/Resource.ts 抽出。统一的资源
 * (角色 + 工具) 表示 + 仓储契约 + 统计形态。host (Electron / CLI / Web)
 * 可以提供不同的 Repository 实现, Service 跟具体 host 解耦。
 */

export type ResourceType = 'role' | 'tool'
export type ResourceSource = 'system' | 'project' | 'user'
export type ResourceVersion = 'v1' | 'v2'

/**
 * Resource 实体 - 代表一个角色或工具
 */
export interface Resource {
  id: string
  name: string
  description: string
  type: ResourceType
  source: ResourceSource
  version?: ResourceVersion
  category?: string
  tags: string[]
  // 角色特有字段
  personality?: string
  // 工具特有字段
  manual?: string
  parameters?: unknown
  // 元数据
  createdAt: Date
  updatedAt: Date
}

/**
 * Resource 仓储接口 - 定义数据访问契约
 */
export interface ResourceRepository {
  // 基础查询
  findAll(): Promise<Resource[]>
  findById(id: string): Promise<Resource | null>
  findByType(type: ResourceType): Promise<Resource[]>
  findBySource(source: ResourceSource): Promise<Resource[]>

  // 高级查询
  search(query: string): Promise<Resource[]>
  getGroupedBySource(): Promise<GroupedResources>
  getStatistics(): Promise<ResourceStatistics>

  // 更新操作
  updateMetadata(
    id: string,
    updates: { name?: string; description?: string }
  ): Promise<{ success: boolean; message?: string }>

  // 缓存控制
  invalidateCache(): void
}

/**
 * 按来源分组的资源
 */
export interface GroupedResources {
  system: { roles: Resource[]; tools: Resource[] }
  project: { roles: Resource[]; tools: Resource[] }
  user: { roles: Resource[]; tools: Resource[] }
  [key: string]: { roles: Resource[]; tools: Resource[] }
}

/**
 * 资源统计信息
 */
export interface ResourceStatistics {
  totalRoles: number
  totalTools: number
  systemRoles: number
  systemTools: number
  projectRoles: number
  projectTools: number
  userRoles: number
  userTools: number
}

/**
 * Resource 值对象 - 资源状态
 */
export enum ResourceStatus {
  AVAILABLE = 'available',
  LOADING = 'loading',
  ERROR = 'error',
  DISABLED = 'disabled',
}
