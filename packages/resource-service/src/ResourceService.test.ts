/**
 * ResourceService 单元测试 — KNUTH-FEAT 2026-07-11 G2.2.
 *
 * 用内存 mock 仓库 + mock adapter 覆盖纯业务规则:
 *  - getAllResources / find / search / grouped / stats 走 repository 直接转发
 *  - activateRole: 不存在的 id / 非 role 类型 / 成功路径
 *  - updateResourceMetadata: 不存在的 id / 非 user source / 成功路径
 *  - invalidateCache 透传到 repository
 *
 * PersengResourceRepository 跟 @promptx/core/pouch DiscoverCommand 集成,
 * 集成测试在 desktop 端 (ResourceListWindow.ts 入口) 跑, 这里只验 Service 逻辑。
 */

import { describe, it, expect, vi } from 'vitest'
import { ResourceService } from './ResourceService.js'
import type {
  Resource,
  ResourceRepository,
  ResourceStatistics,
  GroupedResources,
} from './domain/Resource.js'
import type {
  ActivationAdapter,
  ActivationResult,
} from './domain/ActivationAdapter.js'

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 'r1',
    name: 'test-role',
    description: 'a test resource',
    type: 'role',
    source: 'user',
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

interface MockRepo extends ResourceRepository {
  _store: Resource[]
  _statsOverride?: ResourceStatistics
}

function makeMockRepo(initial: Resource[] = []): MockRepo {
  const repo: MockRepo = {
    _store: initial,
    _statsOverride: undefined,
    async findAll() {
      return [...this._store]
    },
    async findById(id) {
      return this._store.find((r) => r.id === id) ?? null
    },
    async findByType(type) {
      return this._store.filter((r) => r.type === type)
    },
    async findBySource(source) {
      return this._store.filter((r) => r.source === source)
    },
    async search(query) {
      const q = query.toLowerCase()
      return this._store.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.tags.some((t) => t.toLowerCase().includes(q))
      )
    },
    async getGroupedBySource(): Promise<GroupedResources> {
      const grouped: GroupedResources = {
        system: { roles: [], tools: [] },
        project: { roles: [], tools: [] },
        user: { roles: [], tools: [] },
      }
      for (const r of this._store) {
        const slot = grouped[r.source]
        if (!slot) continue
        if (r.type === 'role') slot.roles.push(r)
        else slot.tools.push(r)
      }
      return grouped
    },
    async getStatistics(): Promise<ResourceStatistics> {
      if (this._statsOverride) return this._statsOverride
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
    },
    async updateMetadata(id, updates) {
      const r = this._store.find((x) => x.id === id)
      if (!r) return { success: false, message: '资源不存在' }
      if (updates.name !== undefined) r.name = updates.name
      if (updates.description !== undefined) r.description = updates.description
      return { success: true, message: 'ok' }
    },
    invalidateCache() {
      /* noop */
    },
  }
  return repo
}

function makeMockAdapter(
  behavior: (id: string) => Promise<ActivationResult>
): ActivationAdapter {
  return { activate: vi.fn(behavior) }
}

describe('ResourceService - passthrough queries', () => {
  it('getAllResources forwards to repository', async () => {
    const r1 = makeResource({ id: 'r1' })
    const r2 = makeResource({ id: 'r2' })
    const repo = makeMockRepo([r1, r2])
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))

    expect(await svc.getAllResources()).toHaveLength(2)
  })

  it('searchResources filters by name/description/tag', async () => {
    const repo = makeMockRepo([
      makeResource({ id: 'a', name: 'reader', tags: ['other'] }),
      makeResource({ id: 'b', name: 'writer', description: 'A markdown helper for file processing', tags: [] }),
      makeResource({ id: 'c', name: 'helper', tags: ['unrelated'] }),
    ])
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))

    const found = await svc.searchResources('markdown')
    // 'writer' has 'markdown' in description (matches); 'reader'/'helper' don't
    expect(found.map((r) => r.id)).toEqual(['b'])
  })

  it('getStatistics aggregates from grouped', async () => {
    const repo = makeMockRepo([
      makeResource({ id: 'r1', source: 'system', type: 'role' }),
      makeResource({ id: 'r2', source: 'project', type: 'role' }),
      makeResource({ id: 'r3', source: 'user', type: 'tool' }),
    ])
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))

    const stats = await svc.getStatistics()
    expect(stats.totalRoles).toBe(2)
    expect(stats.totalTools).toBe(1)
    expect(stats.systemRoles).toBe(1)
    expect(stats.userTools).toBe(1)
  })

  it('invalidateCache forwards to repository', () => {
    const repo = makeMockRepo()
    const spy = vi.spyOn(repo, 'invalidateCache')
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))
    svc.invalidateCache()
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('ResourceService - activateRole', () => {
  it('returns failure when role not found', async () => {
    const repo = makeMockRepo()
    const adapter = makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() }))
    const svc = new ResourceService(repo, adapter)
    const res = await svc.activateRole('nonexistent')
    expect(res.success).toBe(false)
    expect(res.message).toContain('不存在')
    expect(adapter.activate).not.toHaveBeenCalled()
  })

  it('returns failure when resource is tool, not role', async () => {
    const repo = makeMockRepo([makeResource({ id: 't1', type: 'tool' })])
    const adapter = makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() }))
    const svc = new ResourceService(repo, adapter)
    const res = await svc.activateRole('t1')
    expect(res.success).toBe(false)
    expect(res.message).toContain('只能激活角色')
    expect(adapter.activate).not.toHaveBeenCalled()
  })

  it('forwards valid role activation to adapter', async () => {
    const repo = makeMockRepo([makeResource({ id: 'r1', type: 'role' })])
    const adapter = makeMockAdapter(async (id) => ({
      success: true, roleId: id, message: `activated ${id}`, timestamp: new Date(),
    }))
    const svc = new ResourceService(repo, adapter)
    const res = await svc.activateRole('r1')
    expect(res.success).toBe(true)
    expect(adapter.activate).toHaveBeenCalledWith('r1')
  })

  it('catches adapter errors and returns failure', async () => {
    const repo = makeMockRepo([makeResource({ id: 'r1', type: 'role' })])
    const adapter = makeMockAdapter(async () => { throw new Error('cli crash') })
    const svc = new ResourceService(repo, adapter)
    const res = await svc.activateRole('r1')
    expect(res.success).toBe(false)
    expect(res.message).toContain('cli crash')
  })
})

describe('ResourceService - updateResourceMetadata', () => {
  it('rejects non-existent id', async () => {
    const repo = makeMockRepo()
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))
    const res = await svc.updateResourceMetadata('nope', { name: 'x' })
    expect(res.success).toBe(false)
  })

  it('rejects non-user source', async () => {
    const repo = makeMockRepo([makeResource({ id: 'r1', source: 'system' })])
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))
    const res = await svc.updateResourceMetadata('r1', { name: 'x' })
    expect(res.success).toBe(false)
    expect(res.message).toContain('仅支持修改用户资源')
  })

  it('forwards user-source update to repository', async () => {
    const r1 = makeResource({ id: 'r1', source: 'user', name: 'old' })
    const repo = makeMockRepo([r1])
    const spy = vi.spyOn(repo, 'updateMetadata')
    const svc = new ResourceService(repo, makeMockAdapter(async () => ({ success: true, roleId: '', message: '', timestamp: new Date() })))
    const res = await svc.updateResourceMetadata('r1', { name: 'new' })
    expect(res.success).toBe(true)
    expect(spy).toHaveBeenCalledWith('r1', { name: 'new' })
  })
})
