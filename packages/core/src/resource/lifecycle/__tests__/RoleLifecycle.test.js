/**
 * RoleLifecycle Test Suite
 *
 * 覆盖：
 * - V1 archive/unarchive/isV1Archived/listArchivedV1 单文件 + 目录式两种形态
 * - V2 archive/unarchive 通过 bridge.retire/rehire
 * - resolveVersion 前缀分发
 * - 统一 archive/unarchive 接口（v1: 无前缀 / v2: 带 v2: 前缀）
 * - 批量操作的串行 + 单条失败隔离
 *
 * 真实文件系统：用 mkdtempSync 建独立 tmp 目录，测试间隔离。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { fileURLToPath } from 'node:url'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// --- Mocks (hoisted so they're available in DI factory) ---

const hoisted = vi.hoisted(() => {
  const bridgeCalls = { retire: [], rehire: [], die: [] }
  return {
    bridgeCalls,
    retireMock: vi.fn(async (id) => {
      bridgeCalls.retire.push(id)
      return `Individual "${id}" retired.`
    }),
    rehireMock: vi.fn(async (id) => {
      bridgeCalls.rehire.push(id)
      return `Individual "${id}" rehired.`
    }),
    dieMock: vi.fn(async (id) => {
      bridgeCalls.die.push(id)
      return `Individual "${id}" died.`
    }),
  }
})

const require = createRequire(import.meta.url)
const RoleLifecycle = require('../../lifecycle/RoleLifecycle')
const { setRolexBridgeFactory, resetRolexBridgeFactory } = RoleLifecycle

// --- Helpers ---

let homeDir

function setUpFakeHome () {
  homeDir = mkdtempSync(path.join(tmpdir(), 'role-lifecycle-'))
  // mock os.homedir() 返回 homeDir
  const os = require('os')
  vi.spyOn(os, 'homedir').mockReturnValue(homeDir)
  // 注入 DI mock：archiveV2/unarchiveV2/deleteV2 通过 _getRolexBridge() 拿 mock
  setRolexBridgeFactory(() => ({
    retire: hoisted.retireMock,
    rehire: hoisted.rehireMock,
    die: hoisted.dieMock,
  }))
}

function tearDownFakeHome () {
  vi.restoreAllMocks()
  if (homeDir && existsSync(homeDir)) {
    rmSync(homeDir, { recursive: true, force: true })
  }
  resetRolexBridgeFactory()
  hoisted.bridgeCalls.retire = []
  hoisted.bridgeCalls.rehire = []
  hoisted.bridgeCalls.die = []
  hoisted.retireMock.mockClear()
  hoisted.rehireMock.mockClear()
  hoisted.dieMock.mockClear()
}

function makeV1SingleFile (roleId) {
  const roleFile = path.join(homeDir, '.perseng', 'resource', 'role', `${roleId}.role.md`)
  mkdirSync(path.dirname(roleFile), { recursive: true })
  writeFileSync(roleFile, '<role>test</role>')
  return roleFile
}

function makeV1DirStyle (roleId) {
  const roleDir = path.join(homeDir, '.perseng', 'resource', 'role', roleId)
  mkdirSync(path.join(roleDir, 'thought'), { recursive: true })
  writeFileSync(path.join(roleDir, `${roleId}.role.md`), '<role>test</role>')
  writeFileSync(path.join(roleDir, 'thought', 'sample.thought.md'), '<thought>...</thought>')
  return roleDir
}

function markerPath (roleId) {
  return path.join(homeDir, '.perseng', 'resource', 'role', `${roleId}.archived`)
}

function dirMarkerPath (roleId) {
  return path.join(homeDir, '.perseng', 'resource', 'role', roleId, '.archived')
}

// ============================================================
// V1 单文件形态
// ============================================================

describe('RoleLifecycle / V1 单文件形态', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('archiveV1 creates .archived marker next to .role.md', async () => {
    makeV1SingleFile('luban')

    const result = await RoleLifecycle.archiveV1('luban')
    expect(result.ok).toBe(true)
    expect(result.alreadyArchived).toBe(false)
    expect(existsSync(markerPath('luban'))).toBe(true)
  })

  it('archiveV1 is idempotent (already archived)', async () => {
    makeV1SingleFile('luban')
    await RoleLifecycle.archiveV1('luban')

    const result = await RoleLifecycle.archiveV1('luban')
    expect(result.ok).toBe(true)
    expect(result.alreadyArchived).toBe(true)
  })

  it('archiveV1 forces marker even when role does not exist (recovery)', async () => {
    // 角色文件不存在时仍允许创建标记（恢复旧版本场景）
    const result = await RoleLifecycle.archiveV1('ghost-role')
    expect(result.ok).toBe(true)
    expect(existsSync(markerPath('ghost-role'))).toBe(true)
  })

  it('unarchiveV1 removes .archived marker', async () => {
    makeV1SingleFile('luban')
    await RoleLifecycle.archiveV1('luban')

    const result = await RoleLifecycle.unarchiveV1('luban')
    expect(result.ok).toBe(true)
    expect(result.alreadyActive).toBe(false)
    expect(existsSync(markerPath('luban'))).toBe(false)
  })

  it('unarchiveV1 is idempotent (not archived)', async () => {
    const result = await RoleLifecycle.unarchiveV1('luban')
    expect(result.ok).toBe(true)
    expect(result.alreadyActive).toBe(true)
  })

  it('isV1Archived reflects state', async () => {
    makeV1SingleFile('luban')
    expect(await RoleLifecycle.isV1Archived('luban')).toBe(false)

    await RoleLifecycle.archiveV1('luban')
    expect(await RoleLifecycle.isV1Archived('luban')).toBe(true)

    await RoleLifecycle.unarchiveV1('luban')
    expect(await RoleLifecycle.isV1Archived('luban')).toBe(false)
  })
})

// ============================================================
// V1 目录式形态（带 thought/execution/knowledge 子目录）
// ============================================================

describe('RoleLifecycle / V1 目录式形态', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('archiveV1 places marker inside role directory', async () => {
    makeV1DirStyle('dayu')

    const result = await RoleLifecycle.archiveV1('dayu')
    expect(result.ok).toBe(true)
    expect(existsSync(dirMarkerPath('dayu'))).toBe(true)
    // 不应在父目录放 <id>.archived
    expect(existsSync(markerPath('dayu'))).toBe(false)
  })

  it('archiveV1 + unarchiveV1 目录式', async () => {
    makeV1DirStyle('dayu')
    await RoleLifecycle.archiveV1('dayu')
    expect(existsSync(dirMarkerPath('dayu'))).toBe(true)

    await RoleLifecycle.unarchiveV1('dayu')
    expect(existsSync(dirMarkerPath('dayu'))).toBe(false)
    // role 文件仍在
    expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'dayu', 'dayu.role.md'))).toBe(true)
  })

  it('isV1Archived detects 目录式 marker', async () => {
    makeV1DirStyle('dayu')
    expect(await RoleLifecycle.isV1Archived('dayu')).toBe(false)
    await RoleLifecycle.archiveV1('dayu')
    expect(await RoleLifecycle.isV1Archived('dayu')).toBe(true)
  })
})

// ============================================================
// listArchivedV1 两种形态混合
// ============================================================

describe('RoleLifecycle / listArchivedV1', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('lists mixed single-file and dir-style archived roles', async () => {
    // 单文件 V1 归档
    makeV1SingleFile('luban')
    await RoleLifecycle.archiveV1('luban')

    // 目录式 V1 归档
    makeV1DirStyle('dayu')
    await RoleLifecycle.archiveV1('dayu')

    // 未归档的 V1
    makeV1SingleFile('nuwa')

    const list = await RoleLifecycle.listArchivedV1()
    expect(list.sort()).toEqual(['dayu', 'luban'])
  })

  it('returns empty array when no archived roles', async () => {
    makeV1SingleFile('luban') // 未归档
    const list = await RoleLifecycle.listArchivedV1()
    expect(list).toEqual([])
  })

  it('returns empty array when ~/.perseng/resource/role does not exist', async () => {
    // 不创建任何文件
    const list = await RoleLifecycle.listArchivedV1()
    expect(list).toEqual([])
  })
})

// ============================================================
// V2 操作（走 bridge mock）
// ============================================================

describe('RoleLifecycle / V2 操作', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('archiveV2 calls bridge.retire', async () => {
    const result = await RoleLifecycle.archiveV2('foo')
    expect(result.ok).toBe(true)
    expect(hoisted.bridgeCalls.retire).toEqual(['foo'])
  })

  it('unarchiveV2 calls bridge.rehire', async () => {
    const result = await RoleLifecycle.unarchiveV2('foo')
    expect(result.ok).toBe(true)
    expect(hoisted.bridgeCalls.rehire).toEqual(['foo'])
  })

  it('archiveV2 returns ok=false when bridge throws', async () => {
    // 替换 mock 抛错
    hoisted.retireMock.mockRejectedValueOnce(new Error('rolexjs db locked'))

    const result = await RoleLifecycle.archiveV2('foo')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('rolexjs db locked')
  })
})

// ============================================================
// 统一接口 resolveVersion + archive/unarchive
// ============================================================

describe('RoleLifecycle / 统一接口', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('resolveVersion parses v2: prefix', () => {
    expect(RoleLifecycle.resolveVersion('v2:luban')).toEqual({ version: 'v2', id: 'luban' })
    expect(RoleLifecycle.resolveVersion('luban')).toEqual({ version: 'v1', id: 'luban' })
    expect(RoleLifecycle.resolveVersion('v2:foo:bar')).toEqual({ version: 'v2', id: 'foo:bar' })
    expect(RoleLifecycle.resolveVersion('')).toEqual({ version: 'v1', id: '' })
  })

  it('archive(roleId) without prefix dispatches to V1', async () => {
    makeV1SingleFile('luban')
    const result = await RoleLifecycle.archive('luban')
    expect(result.version).toBe('v1')
    expect(result.ok).toBe(true)
    expect(existsSync(markerPath('luban'))).toBe(true)
  })

  it('archive("v2:foo") dispatches to V2', async () => {
    const result = await RoleLifecycle.archive('v2:foo')
    expect(result.version).toBe('v2')
    expect(result.id).toBe('foo')
    expect(result.ok).toBe(true)
    expect(hoisted.bridgeCalls.retire).toEqual(['foo'])
  })

  it('unarchive("v2:foo") dispatches to V2', async () => {
    const result = await RoleLifecycle.unarchive('v2:foo')
    expect(result.version).toBe('v2')
    expect(hoisted.bridgeCalls.rehire).toEqual(['foo'])
  })

  it('isArchived returns false for V2 (not directly queryable in rolexjs 1.6.3)', async () => {
    expect(await RoleLifecycle.isArchived('v2:foo')).toBe(false)
  })
})

// ============================================================
// 批量操作
// ============================================================

describe('RoleLifecycle / 批量操作', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('archiveBatch handles mixed V1 + V2 + failures', async () => {
    makeV1SingleFile('luban')
    makeV1SingleFile('nuwa')

    // 让 v2:foo 归档失败（mock retire 抛错）
    hoisted.retireMock.mockRejectedValueOnce(new Error('boom'))

    const results = await RoleLifecycle.archiveBatch(['luban', 'v2:foo', 'nuwa'])
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ version: 'v1', id: 'luban', ok: true })
    expect(results[1]).toMatchObject({ version: 'v2', id: 'foo', ok: false, error: 'boom' })
    expect(results[2]).toMatchObject({ version: 'v1', id: 'nuwa', ok: true })
    // 单条失败不影响其他
    expect(existsSync(markerPath('luban'))).toBe(true)
    expect(existsSync(markerPath('nuwa'))).toBe(true)
  })

  it('archiveBatch returns empty for non-array input', async () => {
    const results = await RoleLifecycle.archiveBatch(null)
    expect(results).toEqual([])
  })

  it('unarchiveBatch serial execution', async () => {
    makeV1SingleFile('luban')
    makeV1SingleFile('nuwa')
    await RoleLifecycle.archiveV1('luban')
    await RoleLifecycle.archiveV1('nuwa')

    const results = await RoleLifecycle.unarchiveBatch(['luban', 'nuwa'])
    expect(results.every(r => r.ok && r.version === 'v1')).toBe(true)
    expect(await RoleLifecycle.isV1Archived('luban')).toBe(false)
    expect(await RoleLifecycle.isV1Archived('nuwa')).toBe(false)
  })
})

// ============================================================
// 边界场景
// ============================================================

describe('RoleLifecycle / 边界场景', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('空字符串 roleId 不抛错', async () => {
    const r1 = await RoleLifecycle.archive('')
    expect(r1.ok).toBe(false)
    expect(r1.error).toBe('empty roleId')
  })

  it('null roleId 不抛错', async () => {
    const r1 = await RoleLifecycle.archive(null)
    expect(r1.version).toBe('v1')
    expect(r1.id).toBe('')
  })

  it('isArchived 区分 V1 / V2 解析', async () => {
    makeV1SingleFile('luban')
    expect(await RoleLifecycle.isArchived('luban')).toBe(false)
    await RoleLifecycle.archive('luban')
    expect(await RoleLifecycle.isArchived('luban')).toBe(true)
    // V2 永远返回 false
    expect(await RoleLifecycle.isArchived('v2:foo')).toBe(false)
  })
})

// ============================================================
// Hardening 1: 物理删除 + 系统角色护栏
// ============================================================

describe('RoleLifecycle / Hardening / 物理删除 delete()', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('delete V1 单文件角色（不可恢复）', async () => {
    makeV1SingleFile('myrole')
    const before = path.join(homeDir, '.perseng', 'resource', 'role', 'myrole.role.md')
    expect(existsSync(before)).toBe(true)

    const result = await RoleLifecycle.delete('myrole')
    expect(result.ok).toBe(true)
    expect(result.protected).toBeUndefined()
    expect(existsSync(before)).toBe(false)
  })

  it('delete V1 目录式角色', async () => {
    makeV1DirStyle('myrole')
    const before = path.join(homeDir, '.perseng', 'resource', 'role', 'myrole', 'myrole.role.md')
    expect(existsSync(before)).toBe(true)

    const result = await RoleLifecycle.delete('myrole')
    expect(result.ok).toBe(true)
    expect(existsSync(before)).toBe(false)
  })

  it('delete 时连同 .archived 标记文件一起清除', async () => {
    makeV1SingleFile('myrole')
    await RoleLifecycle.archive('myrole')
    expect(existsSync(markerPath('myrole'))).toBe(true)

    const result = await RoleLifecycle.delete('myrole')
    expect(result.ok).toBe(true)
    expect(existsSync(markerPath('myrole'))).toBe(false)
    expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'myrole.role.md'))).toBe(false)
  })

  it('delete V1 不存在的角色返回 ok=false', async () => {
    const result = await RoleLifecycle.delete('ghost-role')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/does not exist/)
  })

  it('delete V2 角色（bridge.die mock）', async () => {
    const result = await RoleLifecycle.delete('v2:foo')
    expect(result.version).toBe('v2')
    expect(result.id).toBe('foo')
    expect(result.ok).toBe(true)
  })

  it('delete V2 时 bridge.die 抛错降级为 ok=false', async () => {
    setRolexBridgeFactory(() => ({
      die: async () => {
        throw new Error('rolexjs SQLite locked')
      },
    }))
    const result = await RoleLifecycle.delete('v2:foo')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('SQLite locked')
  })
})

describe('RoleLifecycle / Hardening / 系统角色护栏', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  // PROTECTED_ROLES 包含的 5 个内置角色（2026-07-05 清理后）
  const protectedNames = ['luban', 'nuwa', 'dayu', 'jiangziya', 'sean']

  protectedNames.forEach((roleId) => {
    it(`默认拒绝删除系统角色 "${roleId}"`, async () => {
      makeV1SingleFile(roleId)
      const result = await RoleLifecycle.delete(roleId)
      expect(result.ok).toBe(false)
      expect(result.protected).toBe(true)
      expect(result.error).toContain('system-protected')
      // role 文件应当仍然存在（被拒绝，未删除）
      expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', `${roleId}.role.md`))).toBe(true)
    })

    it(`force=true 可绕过护栏删除 "${roleId}"`, async () => {
      makeV1SingleFile(roleId)
      const result = await RoleLifecycle.delete(roleId, { force: true })
      expect(result.ok).toBe(true)
      expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', `${roleId}.role.md`))).toBe(false)
    })

    it(`default 拒绝删 v2:${roleId}`, async () => {
      const result = await RoleLifecycle.delete(`v2:${roleId}`)
      expect(result.ok).toBe(false)
      expect(result.protected).toBe(true)
    })

    it(`force=true 可绕过删 v2:${roleId}`, async () => {
      const result = await RoleLifecycle.delete(`v2:${roleId}`, { force: true })
      expect(result.version).toBe('v2')
      expect(result.id).toBe(roleId)
      expect(result.ok).toBe(true)
    })
  })

  it('非保护角色未被错误拦截', async () => {
    makeV1SingleFile('my-custom-role')
    const result = await RoleLifecycle.delete('my-custom-role')
    expect(result.ok).toBe(true)
    expect(result.protected).toBeUndefined()
  })

  it('空角色 ID 返回 ok=false（不进入护栏）', async () => {
    const result = await RoleLifecycle.delete('')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('empty roleId')
  })
})

describe('RoleLifecycle / Hardening / deleteBatch', () => {
  beforeEach(setUpFakeHome)
  afterEach(tearDownFakeHome)

  it('混合 protected + 自建 + 不存在', async () => {
    makeV1SingleFile('myrole')
    makeV1SingleFile('luban')

    const results = await RoleLifecycle.deleteBatch(['myrole', 'luban', 'ghost'], { force: false })
    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ version: 'v1', id: 'myrole', ok: true })
    expect(results[1]).toMatchObject({ version: 'v1', id: 'luban', ok: false, protected: true })
    expect(results[2]).toMatchObject({ version: 'v1', id: 'ghost', ok: false })
    // myrole 真删，luban 仍存在
    expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'myrole.role.md'))).toBe(false)
    expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.role.md'))).toBe(true)
  })

  it('force=true 批量删混合角色全部成功', async () => {
    makeV1SingleFile('luban')
    makeV1SingleFile('myrole')

    const results = await RoleLifecycle.deleteBatch(['luban', 'myrole'], { force: true })
    expect(results.every(r => r.ok)).toBe(true)
    expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'luban.role.md'))).toBe(false)
    expect(existsSync(path.join(homeDir, '.perseng', 'resource', 'role', 'myrole.role.md'))).toBe(false)
  })

  it('非数组输入返回空数组', async () => {
    const results = await RoleLifecycle.deleteBatch(null, { force: true })
    expect(results).toEqual([])
  })
})
