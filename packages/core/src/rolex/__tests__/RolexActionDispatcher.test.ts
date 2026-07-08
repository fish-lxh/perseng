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
  calls: { born: unknown[]; activate: string[]; retire: string[]; rehire: string[]; die: string[] }
  bornMock: ReturnType<typeof vi.fn>
  dieMock: ReturnType<typeof vi.fn>
}

const hoisted: HoistedMocks = vi.hoisted(() => {
  const calls: HoistedMocks['calls'] = {
    born: [],
    activate: [],
    retire: [],
    rehire: [],
    die: [],
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

/** 构造 dispatcher + 注入 mock bridge */
function makeDispatcher(): RolexActionDispatcher {
  const dispatcher = new RolexActionDispatcher()
  // dispatcher.bridge 也覆盖（_born 走这里）
  dispatcher.bridge = {
    born: hoisted.bornMock,
    activate: async (id: string) => `Activated ${id}`,
  } as unknown as typeof dispatcher.bridge
  return dispatcher
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
