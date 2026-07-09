/**
 * RolexActionDispatcher.archive / unarchive / born+archiveV1 测试
 *
 * 覆盖：
 * - dispatch('archive', { roleIds }) → RoleLifecycle.archiveBatch
 * - dispatch('unarchive', { roleIds }) → RoleLifecycle.unarchiveBatch
 * - dispatch('born', { ..., archiveV1 }) 成功后自动归档 V1，失败不阻断
 * - missing/invalid args 抛错
 *
 * Mock 策略（避开 vitest 4 CJS mock 在 require() 上的拦截失效）：
 * - 用 RoleLifecycle.setRolexBridgeFactory() 注入 mock bridge
 *   → dispatcher.dispatch('archive', { roleIds: ['v2:foo'] }) 会走 RoleLifecycle.archiveV2
 *     → RoleLifecycle 调 _getRolexBridge() 拿到 factory 注入的 mock
 * - 用 process.env.USERPROFILE 重定向 os.homedir() 到 fake homeDir
 *   → RoleLifecycle.js (CJS `require('os')` 走不动 vi.mock) 的 v1RoleRoot()
 *     拿到 fake homeDir，确保 fs 操作在临时目录里发生
 * - dispatcher.bridge 只为 _born 等其他 RoleX 方法存在（这里 born 已 mock）
 *
 * P0 step 0B.3: 迁 .js → .ts (用 ESM import, vitest extensionAlias 把 .js 解析到 .ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { RolexActionDispatcher } from '../RolexActionDispatcher.js'
import {
  setRolexBridgeFactory,
  resetRolexBridgeFactory,
} from '../../resource/lifecycle/RoleLifecycle.js'

// --- Mocks ---

interface HoistedMocks {
  calls: {
    born: unknown[]
    activate: string[]
    retire: string[]
    rehire: string[]
    die: string[]
    listV2Roles: Array<{ includeRetired?: boolean }>
    listRetiredV2: number[]
  }
  bornMock: ReturnType<typeof vi.fn>
  dieMock: ReturnType<typeof vi.fn>
  listV2RolesMock: ReturnType<typeof vi.fn>
  listRetiredV2Mock: ReturnType<typeof vi.fn>
  rehireMock: ReturnType<typeof vi.fn>
}

const hoisted: HoistedMocks = vi.hoisted(() => {
  const calls: HoistedMocks['calls'] = {
    born: [],
    activate: [],
    retire: [],
    rehire: [],
    die: [],
    listV2Roles: [],
    listRetiredV2: [],
  }
  return {
    calls,
    bornMock: vi.fn(async (name: string, source: string) => {
      calls.born.push({ name, source })
      return `Individual "${name}" born.`
    }),
    dieMock: vi.fn(async (id: string) => {
      calls.die.push(id)
      return `Individual "${id}" died.`
    }),
    listV2RolesMock: vi.fn(async (opts?: { includeRetired?: boolean }) => {
      calls.listV2Roles.push({ includeRetired: opts?.includeRetired })
      return []
    }),
    listRetiredV2Mock: vi.fn(async () => {
      calls.listRetiredV2.push(1)
      return []
    }),
    rehireMock: vi.fn(async (id: string) => {
      calls.rehire.push(id)
      return `Individual "${id}" rehired.`
    }),
  } as unknown as HoistedMocks
})

// --- Helpers ---

let homeDir: string

function makeV1SingleFile(roleId: string): string {
  const file = path.join(homeDir, '.perseng', 'resource', 'role', `${roleId}.role.md`)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '<role>test</role>')
  return file
}

/** 构造 dispatcher + 注入 mock bridge（基础版，仅 born/activate，存量测试用） */
function makeDispatcher(): RolexActionDispatcher {
  const dispatcher = new RolexActionDispatcher()
  // dispatcher.bridge 也覆盖（_born 走这里）
  dispatcher.bridge = {
    born: hoisted.bornMock,
    activate: async (id: string) => `Activated ${id}`,
  } as unknown as typeof dispatcher.bridge
  return dispatcher
}

/**
 * 构造 dispatcher + 注入含 census 检测的 mock bridge（orphan cleanup 测试用）
 *
 * 默认返回：
 *   listV2Roles     → []   (空 active 集合 → 走 orphan 探测分支)
 *   listRetiredV2   → []   (空 past 集合 → 全新角色分支)
 *   rehire          → vi.fn
 *
 * 测试通过 setCensusMocks() 在 beforeEach 里按场景切换返回值。
 */
function makeDispatcherWithCensus(): RolexActionDispatcher {
  const dispatcher = new RolexActionDispatcher()
  dispatcher.bridge = {
    born: hoisted.bornMock,
    activate: async (id: string) => `Activated ${id}`,
    listV2Roles: hoisted.listV2RolesMock,
    listRetiredV2: hoisted.listRetiredV2Mock,
    rehire: hoisted.rehireMock,
  } as unknown as typeof dispatcher.bridge
  return dispatcher
}

/** 重置 census mocks 调用记录与默认返回 */
function resetCensusMocks(): void {
  hoisted.listV2RolesMock.mockReset()
  hoisted.listRetiredV2Mock.mockReset()
  hoisted.rehireMock.mockReset()
  hoisted.calls.listV2Roles = []
  hoisted.calls.listRetiredV2 = []
  hoisted.calls.rehire = []
  hoisted.listV2RolesMock.mockImplementation(async (opts?: { includeRetired?: boolean }) => {
    hoisted.calls.listV2Roles.push({ includeRetired: opts?.includeRetired })
    return []
  })
  hoisted.listRetiredV2Mock.mockImplementation(async () => {
    hoisted.calls.listRetiredV2.push(1)
    return []
  })
  hoisted.rehireMock.mockImplementation(async (id: string) => {
    hoisted.calls.rehire.push(id)
    return `Individual "${id}" rehired.`
  })
}

function setUpFakeHome(): void {
  homeDir = mkdtempSync(path.join(tmpdir(), 'role-dispatcher-'))
  // 关键：os.homedir() 在 Windows 上读 USERPROFILE，在 Unix 上读 HOME。
  // 设两个 env 都行，就一保险。
  process.env.USERPROFILE = homeDir
  process.env.HOME = homeDir
  // 注入 RoleLifecycle 的 DI factory：覆盖所有 bridge 方法
  setRolexBridgeFactory(() => ({
    born: hoisted.bornMock,
    activate: async (id: string) => {
      hoisted.calls.activate.push(id)
      return `Activated ${id}`
    },
    retire: async (id: string) => {
      hoisted.calls.retire.push(id)
      return `Retired ${id}`
    },
    rehire: async (id: string) => {
      hoisted.calls.rehire.push(id)
      return `Rehired ${id}`
    },
    die: hoisted.dieMock,
  }))
}

function tearDownFakeHome(): void {
  vi.restoreAllMocks()
  if (homeDir && existsSync(homeDir)) {
    rmSync(homeDir, { recursive: true, force: true })
  }
  delete process.env.USERPROFILE
  delete process.env.HOME
  resetRolexBridgeFactory()
  hoisted.calls.born = []
  hoisted.calls.activate = []
  hoisted.calls.retire = []
  hoisted.calls.rehire = []
  hoisted.calls.die = []
  hoisted.bornMock.mockClear()
  hoisted.dieMock.mockClear()
  resetCensusMocks()
}

// ============================================================
// dispatch('archive', ...)
// ============================================================

describe("RolexActionDispatcher / dispatch('archive')", () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('archives V1 role when roleIds has no prefix', async () => {
    makeV1SingleFile('luban')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('archive', { roleIds: ['luban'] })) as {
      operation: string
      total: number
      failed: number
      results: Array<{ version: string; id: string; ok: boolean }>
    }
    expect(result.operation).toBe('archive')
    expect(result.total).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0]).toMatchObject({ version: 'v1', id: 'luban', ok: true })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.archived')),
    ).toBe(true)
  })

  it('archives V2 role when roleIds has v2: prefix (via factory mock retire)', async () => {
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('archive', { roleIds: ['v2:foo'] })) as {
      results: Array<{ version: string; id: string; ok: boolean }>
    }
    expect(result.results[0]).toMatchObject({ version: 'v2', id: 'foo', ok: true })
    expect(hoisted.calls.retire).toEqual(['foo'])
  })

  it('mixes V1 + V2 in single batch', async () => {
    makeV1SingleFile('luban')
    makeV1SingleFile('nuwa')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('archive', {
      roleIds: ['luban', 'v2:foo', 'nuwa'],
    })) as { total: number; results: Array<{ ok: boolean }> }
    expect(result.total).toBe(3)
    expect(result.results.filter((r) => r.ok).length).toBe(3)
    expect(hoisted.calls.retire).toEqual(['foo'])
  })

  it('throws on missing roleIds', async () => {
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch('archive', {})).rejects.toThrow(/roleIds/)
  })

  it('throws on empty roleIds array', async () => {
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch('archive', { roleIds: [] })).rejects.toThrow(/roleIds/)
  })
})

// ============================================================
// dispatch('unarchive', ...)
// ============================================================

describe("RolexActionDispatcher / dispatch('unarchive')", () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('unarchives V1 role (archive then unarchive)', async () => {
    makeV1SingleFile('luban')
    const dispatcher = makeDispatcher()

    await dispatcher.dispatch('archive', { roleIds: ['luban'] })
    const result = (await dispatcher.dispatch('unarchive', { roleIds: ['luban'] })) as {
      operation: string
      results: Array<{ version: string; id: string; ok: boolean }>
    }
    expect(result.operation).toBe('unarchive')
    expect(result.results[0]).toMatchObject({ version: 'v1', id: 'luban', ok: true })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.archived')),
    ).toBe(false)
  })

  it('unarchives V2 role via factory mock rehire', async () => {
    const dispatcher = makeDispatcher()

    await dispatcher.dispatch('archive', { roleIds: ['v2:foo'] })
    const result = (await dispatcher.dispatch('unarchive', { roleIds: ['v2:foo'] })) as {
      results: Array<{ version: string; id: string; ok: boolean }>
    }
    expect(result.results[0]).toMatchObject({ version: 'v2', id: 'foo', ok: true })
    expect(hoisted.calls.rehire).toEqual(['foo'])
  })

  it('throws on missing roleIds', async () => {
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch('unarchive', {})).rejects.toThrow(/roleIds/)
  })
})

// ============================================================
// dispatch('born', { archiveV1 })
// ============================================================

describe("RolexActionDispatcher / dispatch('born') + archiveV1", () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('born 成功后自动归档 V1，返回 archiveV1Results', async () => {
    makeV1SingleFile('luban')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('born', {
      name: 'luban',
      source: 'source',
      archiveV1: ['luban'],
    })) as {
      archiveV1Results: Array<{ version: string; id: string; ok: boolean }>
    }
    expect(hoisted.calls.born).toEqual([{ name: 'luban', source: 'source' }])
    expect(result.archiveV1Results).toBeDefined()
    expect(result.archiveV1Results[0]).toMatchObject({ version: 'v1', id: 'luban', ok: true })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.archived')),
    ).toBe(true)
  })

  it('born without archiveV1 不触发任何归档', async () => {
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('born', {
      name: 'nuwa-v2',
      source: 'source',
    })) as string | { archiveV1Results?: unknown }
    expect(hoisted.calls.born).toEqual([{ name: 'nuwa-v2', source: 'source' }])
    expect(
      (result as { archiveV1Results?: unknown }).archiveV1Results,
    ).toBeUndefined()
    expect(result).toBe('Individual "nuwa-v2" born.')
  })

  it('archiveV1 为空数组不触发归档', async () => {
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('born', {
      name: 'foo',
      archiveV1: [],
    })) as { archiveV1Results?: unknown }
    expect(result.archiveV1Results).toBeUndefined()
  })

  it('archiveV1 含 v2:foo 且 mock retire 抛错时，结果含 error 但不阻断 born', async () => {
    // 调整 factory 让 retire 抛错
    setRolexBridgeFactory(() => ({
      born: hoisted.bornMock,
      activate: async () => 'ok',
      retire: async () => {
        throw new Error('rolex db locked')
      },
      rehire: async () => 'ok',
    }))

    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('born', {
      name: 'foo',
      source: 'source',
      archiveV1: ['v2:foo'],
    })) as {
      archiveV1Results: Array<{ version: string; id: string; ok: boolean; error?: string }>
    }
    expect(hoisted.calls.born).toHaveLength(1)
    expect(result.archiveV1Results[0]).toMatchObject({ version: 'v2', id: 'foo', ok: false })
    expect(result.archiveV1Results[0].error).toContain('rolex db locked')
  })

  it('missing name throws (born 必填 name 优先于 archiveV1)', async () => {
    const dispatcher = makeDispatcher()
    await expect(
      dispatcher.dispatch('born', { source: 's', archiveV1: ['x'] }),
    ).rejects.toThrow(/name/)
  })
})

// ============================================================
// dispatch 路由：未知 operation
// ============================================================

describe('RolexActionDispatcher / dispatch routing', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('unknown operation throws', async () => {
    const dispatcher = makeDispatcher()
    await expect(
      dispatcher.dispatch('nonsense' as Parameters<typeof dispatcher.dispatch>[0], {}),
    ).rejects.toThrow(/Unknown RoleX operation/)
  })
})

// ============================================================
// Hardening 1: dispatch('delete', ...) + force 护栏
// ============================================================

describe("RolexActionDispatcher / dispatch('delete') + system protection", () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('refuses to delete protected role luban by default', async () => {
    makeV1SingleFile('luban')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('delete', { roleIds: ['luban'] })) as {
      operation: string
      protected: number
      failed: number
      results: Array<{ protected: boolean; ok: boolean }>
    }
    expect(result.operation).toBe('delete')
    expect(result.protected).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.results[0]).toMatchObject({ protected: true, ok: false })
    // 文件应还在
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.role.md')),
    ).toBe(true)
  })

  it('force=true bypasses protection for luban', async () => {
    makeV1SingleFile('luban')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('delete', {
      roleIds: ['luban'],
      force: true,
    })) as {
      force: boolean
      protected: number
      results: Array<{ ok: boolean }>
    }
    expect(result.force).toBe(true)
    expect(result.protected).toBe(0)
    expect(result.results[0]).toMatchObject({ ok: true })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.role.md')),
    ).toBe(false)
  })

  it('deletes non-protected user role by default', async () => {
    makeV1SingleFile('my-custom-role')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('delete', {
      roleIds: ['my-custom-role'],
    })) as { results: Array<{ version: string; id: string; ok: boolean }> }
    expect(result.results[0]).toMatchObject({
      version: 'v1',
      id: 'my-custom-role',
      ok: true,
    })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'my-custom-role.role.md')),
    ).toBe(false)
  })

  it('mixed batch: protected denied, user deleted, ghost failed', async () => {
    makeV1SingleFile('luban')
    makeV1SingleFile('myrole')
    const dispatcher = makeDispatcher()

    const result = (await dispatcher.dispatch('delete', {
      roleIds: ['luban', 'myrole', 'ghost'],
    })) as {
      total: number
      results: Array<{ id: string; protected?: boolean; ok: boolean }>
    }
    expect(result.total).toBe(3)
    expect(result.results[0]).toMatchObject({ id: 'luban', protected: true, ok: false })
    expect(result.results[1]).toMatchObject({ id: 'myrole', ok: true })
    expect(result.results[2]).toMatchObject({ id: 'ghost', ok: false })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.role.md')),
    ).toBe(true)
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'myrole.role.md')),
    ).toBe(false)
  })

  it('V2 protected role default denied, force=true calls bridge.die', async () => {
    const dispatcher = makeDispatcher()

    const denied = (await dispatcher.dispatch('delete', { roleIds: ['v2:luban'] })) as {
      results: Array<{ protected?: boolean; ok: boolean }>
    }
    expect(denied.results[0]).toMatchObject({ protected: true, ok: false })

    const forced = (await dispatcher.dispatch('delete', {
      roleIds: ['v2:luban'],
      force: true,
    })) as { results: Array<{ version: string; id: string; ok: boolean }> }
    expect(forced.results[0]).toMatchObject({ version: 'v2', id: 'luban', ok: true })
  })

  it('throws on missing roleIds', async () => {
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch('delete', {})).rejects.toThrow(/roleIds/)
  })

  it('throws on empty roleIds array', async () => {
    const dispatcher = makeDispatcher()
    await expect(dispatcher.dispatch('delete', { roleIds: [] })).rejects.toThrow(/roleIds/)
  })
})

// ============================================================
// KNUTH-FEAT 2026-07-09: pre-born orphan past 节点归位
//
// 覆盖（参照 packages/core/src/rolex/RolexActionDispatcher.ts:218-310）：
// - healthy individual 已存在 → 纯 no-op，不调 rehire
// - orphan past 节点（典型 sean bug） → rehire 归位后 born
// - 全新角色（active/past 都不在） → 不调 rehire，直接 born
// - listV2Roles 抛错 → warn + 继续，born 仍执行
// - listRetiredV2 抛错 → warn + 继续，born 仍执行
// - rehire 抛错 → warn + 继续，born 仍执行
// - 系统保护角色 sean（orphan past）→ rehire 仍工作（引擎级 bypass RoleLifecycle 护栏）
// - includeRetired=true 必须传给 listV2Roles（healthy 探测需含 archived 个体）
// - 返回结构不变（archiveV1Results / bornResult 字符串形状保留）
// ============================================================

describe("RolexActionDispatcher / dispatch('born') + prepareForBorn orphan cleanup", () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('healthy: individual 已 active → 不调 listRetiredV2/rehire，直接 born', async () => {
    // active 里已有 'luban'
    hoisted.listV2RolesMock.mockResolvedValueOnce([
      { id: 'luban', name: 'luban', description: '', source: 'system', version: 'v2', protocol: 'role', archived: false },
    ])

    const dispatcher = makeDispatcherWithCensus()
    const result = await dispatcher.dispatch('born', { name: 'luban', source: 'src' })

    // healthy 时 listV2Roles 应被调用（含 includeRetired=true），listRetiredV2 不应被触发
    expect(hoisted.listV2RolesMock.mock.calls).toEqual([[{ includeRetired: true }]])
    expect(hoisted.listRetiredV2Mock).not.toHaveBeenCalled()
    expect(hoisted.rehireMock).not.toHaveBeenCalled()
    // born 正常执行
    expect(hoisted.calls.born).toEqual([{ name: 'luban', source: 'src' }])
    expect(result).toBe('Individual "luban" born.')
  })

  it('orphan past 节点 → rehire 归位后 born（典型 sean bug 修复路径）', async () => {
    // active 空，past 里有 'sean'
    hoisted.listV2RolesMock.mockResolvedValueOnce([])
    hoisted.listRetiredV2Mock.mockResolvedValueOnce([
      { id: 'sean', name: 'sean', description: 'V2 角色 · sean (已归档)', source: 'rolex', version: 'v2', protocol: 'role', archived: true },
    ])

    const dispatcher = makeDispatcherWithCensus()
    await dispatcher.dispatch('born', { name: 'sean', source: 'src' })

    // 调用顺序：listV2Roles → listRetiredV2 → rehire → born
    expect(hoisted.listV2RolesMock.mock.calls).toEqual([[{ includeRetired: true }]])
    expect(hoisted.listRetiredV2Mock).toHaveBeenCalledTimes(1)
    expect(hoisted.rehireMock).toHaveBeenCalledWith('sean')
    expect(hoisted.calls.born).toEqual([{ name: 'sean', source: 'src' }])
  })

  it('全新角色（active/past 都无）→ 不调 rehire，直接 born', async () => {
    // active 空，past 也空（默认 mock 行为）
    const dispatcher = makeDispatcherWithCensus()
    await dispatcher.dispatch('born', { name: 'brand-new-role', source: 'src' })

    expect(hoisted.listV2RolesMock.mock.calls).toEqual([[{ includeRetired: true }]])
    expect(hoisted.listRetiredV2Mock).toHaveBeenCalledTimes(1)
    expect(hoisted.rehireMock).not.toHaveBeenCalled()
    expect(hoisted.calls.born).toEqual([{ name: 'brand-new-role', source: 'src' }])
  })

  it('listV2Roles 抛错 → warn + 继续，born 仍执行（不阻断）', async () => {
    hoisted.listV2RolesMock.mockRejectedValueOnce(new Error('census db locked'))

    const dispatcher = makeDispatcherWithCensus()
    const result = await dispatcher.dispatch('born', { name: 'foo', source: 'src' })

    // listV2Roles 抛错被 catch；不会进入 listRetiredV2 探测
    expect(hoisted.listRetiredV2Mock).not.toHaveBeenCalled()
    expect(hoisted.rehireMock).not.toHaveBeenCalled()
    // born 仍正常执行（旧行为保留）
    expect(hoisted.calls.born).toEqual([{ name: 'foo', source: 'src' }])
    expect(result).toBe('Individual "foo" born.')
  })

  it('listRetiredV2 抛错 → warn + 继续，born 仍执行（不阻断）', async () => {
    hoisted.listV2RolesMock.mockResolvedValueOnce([]) // active 空
    hoisted.listRetiredV2Mock.mockRejectedValueOnce(new Error('census past query failed'))

    const dispatcher = makeDispatcherWithCensus()
    const result = await dispatcher.dispatch('born', { name: 'foo', source: 'src' })

    expect(hoisted.rehireMock).not.toHaveBeenCalled()
    expect(hoisted.calls.born).toEqual([{ name: 'foo', source: 'src' }])
    expect(result).toBe('Individual "foo" born.')
  })

  it('rehire 抛错 → warn + 继续，born 仍执行（不阻断）', async () => {
    // 模拟 orphan past 探测到 sean 但 rehire 引擎失败
    hoisted.listV2RolesMock.mockResolvedValueOnce([])
    hoisted.listRetiredV2Mock.mockResolvedValueOnce([
      { id: 'sean', name: 'sean', description: 'x', source: 'rolex', version: 'v2', protocol: 'role', archived: true },
    ])
    hoisted.rehireMock.mockRejectedValueOnce(new Error('rt.transform failed'))

    const dispatcher = makeDispatcherWithCensus()
    const result = await dispatcher.dispatch('born', { name: 'sean', source: 'src' })

    // rehire 失败被 catch；born 仍执行（虽然会因为 rt.create 复用 past 节点可能仍有问题，
    // 但 dispatcher 层不再抛错阻断）
    expect(hoisted.rehireMock).toHaveBeenCalledWith('sean')
    expect(hoisted.calls.born).toEqual([{ name: 'sean', source: 'src' }])
    expect(result).toBe('Individual "sean" born.')
  })

  it('系统保护角色 sean (orphan past) → rehire 仍工作（不依赖 RoleLifecycle.deleteBatch）', async () => {
    // sean 在 RoleLifecycle 名单是 protected role（luban/nuwa/dayu/jiangziya/sean），
    // deleteBatch 默认拒绝；但 prepareForBorn 走的是 bridge.rehire（引擎级），
    // 不经 RoleLifecycle 护栏。验证 mock 中 rehire 被正常调用即可。
    hoisted.listV2RolesMock.mockResolvedValueOnce([])
    hoisted.listRetiredV2Mock.mockResolvedValueOnce([
      { id: 'sean', name: 'sean', description: 'x', source: 'system', version: 'v2', protocol: 'role', archived: true },
    ])

    const dispatcher = makeDispatcherWithCensus()
    await dispatcher.dispatch('born', { name: 'sean', source: 'src' })

    // 没有 deleteBatch 调用，也没有 protected 护栏拦截
    expect(hoisted.rehireMock).toHaveBeenCalledWith('sean')
    expect(hoisted.calls.born).toEqual([{ name: 'sean', source: 'src' }])
  })

  it('listV2Roles 必须用 includeRetired=true（否则 archived healthy 个体会被误判为 orphan）', async () => {
    // 模拟 archived individual：id 在 individual 集合但 listV2Roles 默认会过滤掉
    // 必须用 includeRetired=true 才能正确识别 healthy
    hoisted.listV2RolesMock.mockResolvedValueOnce([
      { id: 'sean', name: 'sean', description: 'x', source: 'system', version: 'v2', protocol: 'role', archived: true },
    ])

    const dispatcher = makeDispatcherWithCensus()
    await dispatcher.dispatch('born', { name: 'sean', source: 'src' })

    // 关键断言：listV2Roles 被调用时 includeRetired=true
    expect(hoisted.listV2RolesMock.mock.calls[0]?.[0]).toEqual({ includeRetired: true })
    // healthy 路径：不调 listRetiredV2、不调 rehire
    expect(hoisted.listRetiredV2Mock).not.toHaveBeenCalled()
    expect(hoisted.rehireMock).not.toHaveBeenCalled()
  })

  it('orphan past + archiveV1 同时存在 → rehire + born + archiveV1Results 都正常', async () => {
    makeV1SingleFile('sean')
    hoisted.listV2RolesMock.mockResolvedValueOnce([])
    hoisted.listRetiredV2Mock.mockResolvedValueOnce([
      { id: 'sean', name: 'sean', description: 'x', source: 'rolex', version: 'v2', protocol: 'role', archived: true },
    ])

    const dispatcher = makeDispatcherWithCensus()
    const result = (await dispatcher.dispatch('born', {
      name: 'sean',
      source: 'src',
      archiveV1: ['sean'],
    })) as {
      archiveV1Results: Array<{ version: string; id: string; ok: boolean }>
    }

    // 顺序：rehire → born → archiveV1
    expect(hoisted.rehireMock).toHaveBeenCalledWith('sean')
    expect(hoisted.calls.born).toEqual([{ name: 'sean', source: 'src' }])
    // 返回结构不变：archiveV1Results 字段仍存在
    expect(result.archiveV1Results).toBeDefined()
    expect(result.archiveV1Results[0]).toMatchObject({ version: 'v1', id: 'sean', ok: true })
    expect(
      existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'sean.archived')),
    ).toBe(true)
  })

  it('missing name 仍优先抛错（不被 prepareForBorn 短路）', async () => {
    const dispatcher = makeDispatcherWithCensus()
    // 没有 name → 应直接抛错，且 census mock 不应被调用
    await expect(
      dispatcher.dispatch('born', { source: 'src' }),
    ).rejects.toThrow(/name/)
    expect(hoisted.listV2RolesMock).not.toHaveBeenCalled()
    expect(hoisted.listRetiredV2Mock).not.toHaveBeenCalled()
    expect(hoisted.rehireMock).not.toHaveBeenCalled()
    expect(hoisted.calls.born).toEqual([])
  })
})
