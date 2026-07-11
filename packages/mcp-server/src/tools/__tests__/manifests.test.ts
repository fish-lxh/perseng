/**
 * Manifests 聚合单测 (3.7 P2)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 * 验证：
 * - ALL_MANIFESTS 9 个工具全覆盖
 * - findManifestsByCapability 按标签筛选
 * - createAllTools(enableV2=true) 数量 == 9
 * - createAllTools(enableV2=false) 排除 V2（= 6）
 */

import { describe, it, expect } from 'vitest'
import { ALL_MANIFESTS, findManifestsByCapability } from '../manifests.js'
import { createAllTools } from '../index.js'

describe('ALL_MANIFESTS', () => {
  it('M-1: 9 个 manifest（discover / action / recall / remember / toolx / timeline / lifecycle / learning / organization）', () => {
    expect(ALL_MANIFESTS).toHaveLength(9)
    const names = ALL_MANIFESTS.map((m) => m.name)
    expect(names).toEqual([
      'discover',
      'action',
      'recall',
      'remember',
      'toolx',
      'timeline',
      'lifecycle',
      'learning',
      'organization',
    ])
  })

  it('M-2: 每个 manifest 有 name / version / capabilities / dependencies / schemaVersion', () => {
    for (const m of ALL_MANIFESTS) {
      expect(m.name).toBeTypeOf('string')
      expect(m.version).toBeTypeOf('string')
      expect(Array.isArray(m.capabilities)).toBe(true)
      expect(Array.isArray(m.dependencies)).toBe(true)
      expect(m.schemaVersion).toBe(1)
    }
  })

  it('M-3: 每个 manifest name 唯一', () => {
    const names = ALL_MANIFESTS.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('findManifestsByCapability', () => {
  it('F-1: 找 role:activate → 仅 action', () => {
    const found = findManifestsByCapability('role:activate')
    expect(found).toHaveLength(1)
    expect(found[0]!.name).toBe('action')
  })

  it('F-2: 找 memory:recall → 仅 recall', () => {
    const found = findManifestsByCapability('memory:recall')
    expect(found[0]!.name).toBe('recall')
  })

  it('F-3: 找 lifecycle:* → 仅 lifecycle', () => {
    const found = findManifestsByCapability('lifecycle:plan')
    expect(found[0]!.name).toBe('lifecycle')
  })

  it('F-4: 不存在的 capability → 空数组', () => {
    expect(findManifestsByCapability('nope:nope')).toEqual([])
  })
})

describe('createAllTools integration', () => {
  it('C-1: enableV2=true → 9 工具', () => {
    const tools = createAllTools(true)
    expect(tools).toHaveLength(9)
  })

  it('C-2: enableV2=false → 6 工具（排除 V2）', () => {
    const tools = createAllTools(false)
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('lifecycle')
    expect(names).not.toContain('learning')
    expect(names).not.toContain('organization')
    // 期望剩下 discover / action / recall / remember / toolx / timeline
    expect(tools).toHaveLength(6)
  })

  it('C-3: 工具 name 唯一', () => {
    const tools = createAllTools(true)
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})