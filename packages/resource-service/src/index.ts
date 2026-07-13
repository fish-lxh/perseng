/**
 * @promptx/resource-service - public API
 *
 * KNUTH-FEAT 2026-07-11 G2.2: 从 apps/desktop/src/main/{domain,application,infrastructure}/ 抽出。
 * 任何 host (Electron / CLI / Web) 都可以直接消费:
 *   - domain.Resource / interfaces: 共享模型
 *   - domain.ActivationAdapter: 角色激活契约 (host 提供实现)
 *   - ResourceService: 业务规则层
 *   - PersengResourceRepository: 默认 Perseng 适配 (@promptx/core/pouch)
 */

export { ResourceService } from './ResourceService.js'
export { PersengResourceRepository } from './PersengResourceRepository.js'

export type {
  Resource,
  ResourceRepository,
  ResourceType,
  ResourceSource,
  ResourceVersion,
  GroupedResources,
  ResourceStatistics,
} from './domain/Resource.js'

export { ResourceStatus } from './domain/Resource.js'

export type {
  ActivationAdapter,
  ActivationResult,
} from './domain/ActivationAdapter.js'
