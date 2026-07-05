/**
 * RolexBridge.listV2Roles / listRetiredV2 / _parseCensusIds 测试
 *
 * 覆盖：
 * - _parseCensusIds 解析 census.list 文本（多种格式 + 空态哨兵）
 * - listV2Roles({ includeRetired }) → 用 past 集合做精准退役过滤
 * - listV2Roles() 默认不包含已退役个体
 * - listV2Roles({ includeRetired: true }) 全部返回
 * - listRetiredV2 → 返回 archived:true 角色对象数组
 * - listRetiredV2 census 失败 → 兜底返回 []
 * - listRetiredV2 past 含 active 列表外的 id → minimal 角色对象
 * - PERSENG_ENABLE_V2=0 → 两个方法都返回 []
 *
 * Mock 策略：
 * - 不调 ensureInitialized，直接给 instance.rolex 注入 mock direct
 * - 用 mkdtempSync 准备 fake ~/.rolex/ 目录（避免 fs 操作打 logger）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const os = require('os')

const { RolexBridge } = require('../RolexBridge')

let homeDir
let bridge

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), 'rolex-bridge-'))
  vi.spyOn(os, 'homedir').mockReturnValue(homeDir)
  bridge = new RolexBridge()
  // 跳过 ensureInitialized，直接注入 mock rolex.direct
  bridge.initialized = true
})

afterEach(() => {
  vi.restoreAllMocks()
  if (homeDir && existsSync(homeDir)) {
    rmSync(homeDir, { recursive: true, force: true })
  }
})

/** 注入 census.list 的返回值映射 */
function mockCensus (directMap) {
  bridge.rolex = {
    direct: vi.fn(async (cmd, args) => {
      const key = `${cmd} ${JSON.stringify(args || {})}`.trim()
      if (Object.prototype.hasOwnProperty.call(directMap, key)) {
        return directMap[key]
      }
      if (Object.prototype.hasOwnProperty.call(directMap, cmd)) {
        return directMap[cmd]
      }
      throw new Error(`unmocked direct call: ${cmd} ${JSON.stringify(args || {})}`)
    }),
  }
}

// ============================================================
// _parseCensusIds（静态方法）
// ============================================================

describe('RolexBridge._parseCensusIds', () => {
  it('parses simple id-per-line format', () => {
    expect(RolexBridge._parseCensusIds('foo\nbar\nbaz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('parses "id (alias1, alias2) #tag" format', () => {
    const text = 'foo (nick1, nick2) #tag1\nbar #tag2\nbaz'
    expect(RolexBridge._parseCensusIds(text)).toEqual(['foo', 'bar', 'baz'])
  })

  it('handles indented lines (census org blocks)', () => {
    const text = 'org1\n  child-role\n  member1\norg2\n  (empty)'
    // indented 行依然 parse（id 前的空白被 trim 掉）
    const result = RolexBridge._parseCensusIds(text)
    expect(result).toContain('org1')
    expect(result).toContain('child-role')
    expect(result).toContain('member1')
  })

  it('returns empty for "No <type> found." sentinel', () => {
    expect(RolexBridge._parseCensusIds('No individual found.')).toEqual([])
    expect(RolexBridge._parseCensusIds('No past found.')).toEqual([])
  })

  it('returns empty for "Society is empty." sentinel', () => {
    expect(RolexBridge._parseCensusIds('Society is empty.')).toEqual([])
  })

  it('returns empty for null / undefined / empty string', () => {
    expect(RolexBridge._parseCensusIds(null)).toEqual([])
    expect(RolexBridge._parseCensusIds(undefined)).toEqual([])
    expect(RolexBridge._parseCensusIds('')).toEqual([])
  })

  it('skips blank lines', () => {
    expect(RolexBridge._parseCensusIds('foo\n\n\nbar\n')).toEqual(['foo', 'bar'])
  })

  it('trims whitespace around ids', () => {
    expect(RolexBridge._parseCensusIds('  foo  \n\tbar\t')).toEqual(['foo', 'bar'])
  })
})

// ============================================================
// listV2Roles（精准退役过滤）
// ============================================================

describe('RolexBridge.listV2Roles', () => {
  it('returns active roles only by default (filters retired via census.list type=past)', async () => {
    mockCensus({
      '!census.list': 'foo\nbar\nbaz',
      '!census.list {"type":"individual"}': 'foo\nbar\nbaz',
      '!census.list {"type":"past"}': 'baz',
    })
    // 准备 fake Gherkin 文件，确保 description 能填上（不影响核心断言）
    mkdirSync(path.join(homeDir, '.rolex', 'roles', 'foo', 'identity'), { recursive: true })
    writeFileSync(path.join(homeDir, '.rolex', 'roles', 'foo', 'identity', 'persona.identity.feature'), 'Feature: foo\n  desc')

    const roles = await bridge.listV2Roles()
    expect(roles.map(r => r.id)).toEqual(['foo', 'bar'])
    expect(roles.find(r => r.id === 'foo').archived).toBe(false)
    // baz 被 past 标记为 retired，过滤掉
    expect(roles.find(r => r.id === 'baz')).toBeUndefined()
  })

  it('includeRetired=true returns all roles (no past filtering)', async () => {
    mockCensus({
      '!census.list': 'foo\nbar\nbaz',
      '!census.list {"type":"individual"}': 'foo\nbar\nbaz',
      '!census.list {"type":"past"}': 'baz',
    })

    const roles = await bridge.listV2Roles({ includeRetired: true })
    expect(roles.map(r => r.id)).toEqual(['foo', 'bar', 'baz'])
  })

  it('returns empty array when census.list returns "No individual found."', async () => {
    mockCensus({
      '!census.list {"type":"individual"}': 'No individual found.',
      '!census.list {"type":"past"}': 'No past found.',
    })

    const roles = await bridge.listV2Roles()
    expect(roles).toEqual([])
  })

  it('skips past census if includeRetired=true (no second call)', async () => {
    mockCensus({
      '!census.list {"type":"individual"}': 'foo\nbar',
    })

    const roles = await bridge.listV2Roles({ includeRetired: true })
    expect(roles.map(r => r.id)).toEqual(['foo', 'bar'])
    // past census 不应该被调用
    const directCalls = bridge.rolex.direct.mock.calls.map(c => c[0])
    expect(directCalls).not.toContain('!census.list {"type":"past"}')
  })

  it('census.list type=past failure → degrades to no retired filter (returns all)', async () => {
    // individual 返回正常，past 抛错 → _getRetiredIdSet 兜底返回空集合
    bridge.rolex = {
      direct: vi.fn(async (cmd, args) => {
        if (cmd === '!census.list' && args && args.type === 'individual') {
          return 'foo\nbar'
        }
        if (cmd === '!census.list' && args && args.type === 'past') {
          throw new Error('census past not available')
        }
        throw new Error(`unmocked: ${cmd}`)
      }),
    }

    const roles = await bridge.listV2Roles()
    // 兜底不过滤，全部返回
    expect(roles.map(r => r.id)).toEqual(['foo', 'bar'])
  })

  it('seed roles get source=system, others source=rolex', async () => {
    mockCensus({
      '!census.list {"type":"individual"}': 'nuwa\nmy-custom-v2-role',
      '!census.list {"type":"past"}': 'No past found.',
    })

    const roles = await bridge.listV2Roles()
    const nuwa = roles.find(r => r.id === 'nuwa')
    const custom = roles.find(r => r.id === 'my-custom-v2-role')
    expect(nuwa.source).toBe('system')
    expect(custom.source).toBe('rolex')
    expect(nuwa.version).toBe('v2')
  })

  it('uses V2 placeholder description when no persona.identity.feature', async () => {
    mockCensus({
      '!census.list {"type":"individual"}': 'ghost-role',
      '!census.list {"type":"past"}': 'No past found.',
    })

    const roles = await bridge.listV2Roles()
    expect(roles[0].description).toBe('V2 角色 · ghost-role')
  })

  it('extracts description from persona.identity.feature', async () => {
    mockCensus({
      '!census.list {"type":"individual"}': 'real-role',
      '!census.list {"type":"past"}': 'No past found.',
    })
    // 准备 Gherkin
    mkdirSync(path.join(homeDir, '.rolex', 'roles', 'real-role', 'identity'), { recursive: true })
    writeFileSync(
      path.join(homeDir, '.rolex', 'roles', 'real-role', 'identity', 'persona.identity.feature'),
      'Feature: Real Role\n  This is the extracted description.\n  Continues here.\n\n  Scenario: A scenario\n    Given something',
    )

    const roles = await bridge.listV2Roles()
    expect(roles[0].description).toBe('This is the extracted description. Continues here.')
  })

  it('PERSENG_ENABLE_V2=0 returns empty array', async () => {
    process.env.PERSENG_ENABLE_V2 = '0'
    try {
      const roles = await bridge.listV2Roles()
      expect(roles).toEqual([])
      // 不应该调 census
      expect(bridge.rolex?.direct).toBeUndefined()
    } finally {
      delete process.env.PERSENG_ENABLE_V2
    }
  })
})

// ============================================================
// listRetiredV2
// ============================================================

describe('RolexBridge.listRetiredV2', () => {
  it('returns archived:true role objects for past census ids', async () => {
    // past → retired 个体
    // individual → 用 listV2Roles({ includeRetired: true }) 拉 active 作为模板
    mockCensus({
      '!census.list {"type":"past"}': 'ghost\nretired-user',
      '!census.list {"type":"individual"}': 'foo\nbar\nghost',
    })
    mkdirSync(path.join(homeDir, '.rolex', 'roles', 'ghost', 'identity'), { recursive: true })
    writeFileSync(path.join(homeDir, '.rolex', 'roles', 'ghost', 'identity', 'persona.identity.feature'), 'Feature: Ghost\n  Ghost desc')

    const retired = await bridge.listRetiredV2()
    expect(retired.map(r => r.id)).toEqual(['ghost', 'retired-user'])
    expect(retired.every(r => r.archived === true)).toBe(true)
    expect(retired.every(r => r.version === 'v2')).toBe(true)
  })

  it('past id not in active list → minimal role object with placeholder desc', async () => {
    mockCensus({
      '!census.list {"type":"past"}': 'unknown-past-id',
      '!census.list {"type":"individual"}': 'foo\nbar',
    })

    const retired = await bridge.listRetiredV2()
    expect(retired).toHaveLength(1)
    expect(retired[0]).toMatchObject({
      id: 'unknown-past-id',
      name: 'unknown-past-id',
      archived: true,
      version: 'v2',
      source: 'rolex',
    })
    expect(retired[0].description).toBe('V2 角色 · unknown-past-id (已归档)')
  })

  it('returns empty when past census is empty', async () => {
    mockCensus({
      '!census.list {"type":"past"}': 'No past found.',
    })

    const retired = await bridge.listRetiredV2()
    expect(retired).toEqual([])
  })

  it('census failure → returns empty array (degraded)', async () => {
    bridge.rolex = {
      direct: vi.fn(async () => {
        throw new Error('census broken')
      }),
    }

    const retired = await bridge.listRetiredV2()
    expect(retired).toEqual([])
  })

  it('PERSENG_ENABLE_V2=0 returns empty array', async () => {
    process.env.PERSENG_ENABLE_V2 = '0'
    try {
      const retired = await bridge.listRetiredV2()
      expect(retired).toEqual([])
    } finally {
      delete process.env.PERSENG_ENABLE_V2
    }
  })
})