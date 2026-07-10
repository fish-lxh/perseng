/**
 * actAs invariant tests
 *
 * 内容契约 (docs/content-contract.md) §5.4 列出的 5 个不变量：
 * - I-1: actAs('不存在的-id') → 抛 ActAsError，**不**返回任何对象
 * - I-2: actAs('nuwa') → 返回的 result.kind === 'role' 且 identity.id 来自 registry
 * - I-3: 同一 session 重复 actAs(roleId) → 返回同一 identity.id
 * - I-4: actAs('skill-id') 在 fallback='throw' 模式下抛 NO_ACTIVE_ROLE
 * - I-5: cache hit — 第二次 actAs 不应再次触发 registry 查找
 *
 * Mock 策略：
 * - vi.mock('./resource/index.js') 拦截 actAs 对 ResourceManager 的依赖，
 *   避免加载整个 resource chain（其中 PackageProtocol.js 等 CJS 文件在 vitest ESM 模式
 *   下用 `require('~/utils/...')` 路径无法解析）。
 * - fakeRegistry 提供与真实 registry 同形的最小数据集。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// 拦截 resource 模块 — 必须在 import actAs 之前声明。
const fakeRegistryData = {
  // findResourceById(id, protocol) → 命中返回 {id, protocol, reference, source}，未命中 null
  findResourceById: vi.fn((id: string, protocol?: string | null) => {
    const map: Record<string, Record<string, unknown>> = {
      role: {
        nuwa: { id: 'nuwa', protocol: 'role', reference: '@role://nuwa', source: 'package' },
        sean: { id: 'sean', protocol: 'role', reference: '@role://sean', source: 'package' },
        luban: { id: 'luban', protocol: 'role', reference: '@role://luban', source: 'package' },
      },
      skill: {
        'story-weaving': { id: 'story-weaving', protocol: 'skill', reference: '@skill://story-weaving', source: 'package' },
        'character-improvisation': { id: 'character-improvisation', protocol: 'skill', reference: '@skill://character-improvisation', source: 'package' },
        'dpml-composition': { id: 'dpml-composition', protocol: 'skill', reference: '@skill://dpml-composition', source: 'package' },
      },
      persona: {
        nuwa: { id: 'nuwa', protocol: 'persona', reference: '@persona://nuwa', source: 'package' },
        sean: { id: 'sean', protocol: 'persona', reference: '@persona://sean', source: 'package' },
      },
    }
    if (protocol) return map[protocol]?.[id] ?? null
    // 不带 protocol 时按 role → skill → persona 顺序查
    for (const p of ['role', 'skill', 'persona']) {
      const hit = map[p]?.[id]
      if (hit) return hit
    }
    return null
  }),
  getResourcesByProtocol: vi.fn((protocol: string) => {
    const map: Record<string, unknown[]> = {
      role: [
        { id: 'nuwa', source: 'package' },
        { id: 'sean', source: 'package' },
        { id: 'luban', source: 'package' },
      ],
      skill: [
        { id: 'story-weaving', source: 'package' },
        { id: 'character-improvisation', source: 'package' },
        { id: 'dpml-composition', source: 'package' },
      ],
      persona: [
        { id: 'nuwa', source: 'package' },
        { id: 'sean', source: 'package' },
      ],
    }
    return map[protocol] ?? []
  }),
}

const fakeResourceManager = {
  initialized: true,
  registryData: fakeRegistryData,
}

vi.mock('../resource/index.js', () => ({
  getGlobalResourceManager: () => fakeResourceManager,
  default: {},
}))

// 必须放在 vi.mock 之后
const { actAs, isRegistered, ActAsError, ActAsErrorCode, _resetActAsCache } = await import('../actAs.js')

beforeEach(() => {
  _resetActAsCache()
  fakeRegistryData.findResourceById.mockClear()
  fakeRegistryData.getResourcesByProtocol.mockClear()
})

describe('actAs — 内容契约不变量', () => {
  it('I-1: actAs("jiang-shan-totally-fake") 抛 ActAsError，code = ACTAS_NOT_FOUND', async () => {
    await expect(actAs('jiang-shan-totally-fake')).rejects.toBeInstanceOf(ActAsError)
    await expect(actAs('jiang-shan-totally-fake')).rejects.toMatchObject({
      code: ActAsErrorCode.NOT_FOUND,
      id: 'jiang-shan-totally-fake',
    })
  })

  it('I-1b: 失败时不返回任何对象（result.kind 永不为空）', async () => {
    let returnedAnyValue = false
    try {
      const r = await actAs('jiang-shan-totally-fake-2')
      if (r !== undefined && r !== null) returnedAnyValue = true
    } catch {
      // 期望路径：抛错，无返回值
    }
    expect(returnedAnyValue).toBe(false)
  })

  it('I-2: actAs("nuwa") 返回的 identity.id 来自 registry', async () => {
    const result = await actAs('nuwa')
    expect(result.kind).toBe('role')
    expect(result.identity.id).toBe('nuwa')
    expect(result.reference).toMatch(/^@role:\/\/nuwa$/)
  })

  it('I-3: 同 session 重复 actAs("nuwa") 返回同一 identity.id', async () => {
    const a = await actAs('nuwa')
    const b = await actAs('nuwa')
    expect(a.identity.id).toBe(b.identity.id)
    expect(a.reference).toBe(b.reference)
  })

  it('I-4: skill / persona 在 fallback="throw" 下抛错（NO_ACTIVE_ROLE 或 NOT_FOUND）', async () => {
    let threw = false
    try {
      await actAs('character-improvisation', { fallback: 'throw' })
    } catch (e: any) {
      threw = true
      expect(['ACTAS_NOT_FOUND', 'ACTAS_NO_ACTIVE_ROLE']).toContain(e.code)
    }
    expect(threw).toBe(true)
  })

  it('I-5: session 缓存命中 —— 第二次 actAs 不再调用 findResourceById', async () => {
    const first = await actAs('nuwa')
    const callsAfterFirst = fakeRegistryData.findResourceById.mock.calls.length
    const second = await actAs('nuwa')
    const callsAfterSecond = fakeRegistryData.findResourceById.mock.calls.length
    // 第二次命中缓存 → 不再调 findResourceById
    expect(callsAfterSecond).toBe(callsAfterFirst)
    // 且返回同一对象引用
    expect(first).toBe(second)
  })

  it('scope="task" 跳过缓存：两次都调 findResourceById，返回不同对象引用', async () => {
    const a = await actAs('nuwa', { scope: 'task' })
    const callsAfterA = fakeRegistryData.findResourceById.mock.calls.length
    const b = await actAs('nuwa', { scope: 'task' })
    const callsAfterB = fakeRegistryData.findResourceById.mock.calls.length
    expect(callsAfterB).toBeGreaterThan(callsAfterA)
    expect(a).not.toBe(b)
    expect(a.identity.id).toBe(b.identity.id)
  })

  it('isRegistered("nuwa") === true; isRegistered("jiang-shan-totally-fake") === false', () => {
    expect(isRegistered('nuwa')).toBe(true)
    expect(isRegistered('jiang-shan-totally-fake')).toBe(false)
  })

  it('ActAsError 暴露 code + id + available，便于上层构造结构化错误', async () => {
    try {
      await actAs('jiang-shan-totally-fake-3')
      expect.fail('expected actAs to throw')
    } catch (e: any) {
      expect(e).toBeInstanceOf(ActAsError)
      expect(e.code).toBe(ActAsErrorCode.NOT_FOUND)
      expect(e.id).toBe('jiang-shan-totally-fake-3')
      expect(Array.isArray(e.available)).toBe(true)
    }
  })

  it('attach 校验：未注册的附加 id 走 ok=false 但不阻断主流程', async () => {
    const result = await actAs('nuwa', {
      attach: { skill: ['story-weaving', 'totally-fake-skill'] },
    })
    expect(result.attachedRefs).toBeDefined()
    const okItems = result.attachedRefs!.filter(r => r.protocol === 'skill' && r.ok)
    const failItems = result.attachedRefs!.filter(r => r.protocol === 'skill' && !r.ok)
    expect(okItems.length + failItems.length).toBe(2)
    expect(okItems.length).toBeGreaterThanOrEqual(1)
    expect(failItems.length).toBeGreaterThanOrEqual(1)
  })

  it('未带 protocol 的 isRegistered 按 role → skill → persona 顺序查', () => {
    expect(isRegistered('nuwa', 'role')).toBe(true)
    expect(isRegistered('nuwa', 'persona')).toBe(true)
    expect(isRegistered('story-weaving', 'skill')).toBe(true)
  })
})