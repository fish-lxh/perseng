/**
 * PromptRegistry + 3 builtin providers 单测 (3.4 P2)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.4 / 批次 3)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MapPromptRegistry, PromptNotFoundError } from '../PromptRegistry.js'
import { BUILTIN_PROMPT_PROVIDERS, RoleActivationPrompt, ReflectCyclePrompt, LifecycleGoalPrompt } from '../../prompts/builtinProviders.js'

// ============================================================================
// MapPromptRegistry
// ============================================================================

describe('MapPromptRegistry', () => {
  let registry: MapPromptRegistry

  beforeEach(() => {
    registry = new MapPromptRegistry()
  })

  it('R-1: register + get 返回同一对象', () => {
    registry.register(BUILTIN_PROMPT_PROVIDERS[0]!)
    expect(registry.get('role-activation')).toBe(BUILTIN_PROMPT_PROVIDERS[0])
  })

  it('R-2: 同 name 重复注册抛错', () => {
    registry.register(BUILTIN_PROMPT_PROVIDERS[0]!)
    expect(() => registry.register(BUILTIN_PROMPT_PROVIDERS[0]!)).toThrow(/duplicate/)
  })

  it('R-3: name 为空抛错', () => {
    expect(() =>
      registry.register({ name: '', description: 'd', get: async () => ({} as never) }),
    ).toThrow(/non-empty/)
  })

  it('R-4: list 返回 MCP Prompt 形状（不暴露 get()）', () => {
    registry.register(BUILTIN_PROMPT_PROVIDERS[0]!)
    const list = registry.list()
    expect(list[0]!.name).toBe('role-activation')
    expect(list[0]!.description).toMatch(/Role activation/)
    expect((list[0] as { get?: unknown }).get).toBeUndefined() // 不暴露 get 闭包
  })

  it('R-5: getPrompt 路由到 provider.get(args)', async () => {
    registry.register(RoleActivationPrompt)
    const spy = vi.spyOn(RoleActivationPrompt, 'get')
    const result = await registry.getPrompt('role-activation', { role: 'luban' })
    expect(spy).toHaveBeenCalledWith({ role: 'luban' })
    expect(result.messages[0]!.content.type).toBe('text')
  })

  it('R-6: getPrompt 未注册抛 PromptNotFoundError', async () => {
    await expect(registry.getPrompt('nope', {})).rejects.toBeInstanceOf(PromptNotFoundError)
  })

  it('R-7: size / clear', () => {
    expect(registry.size()).toBe(0)
    registry.register(BUILTIN_PROMPT_PROVIDERS[0]!)
    registry.register(BUILTIN_PROMPT_PROVIDERS[1]!)
    expect(registry.size()).toBe(2)
    registry.clear()
    expect(registry.size()).toBe(0)
  })
})

// ============================================================================
// BUILTIN_PROMPT_PROVIDERS
// ============================================================================

describe('BUILTIN_PROMPT_PROVIDERS', () => {
  it('B-1: 3 个 builtin providers', () => {
    expect(BUILTIN_PROMPT_PROVIDERS).toHaveLength(3)
    const names = BUILTIN_PROMPT_PROVIDERS.map((p) => p.name)
    expect(names).toContain('role-activation')
    expect(names).toContain('reflect-cycle')
    expect(names).toContain('lifecycle-goal')
  })

  it('B-2: role-activation 注入 role → 提示文本含角色名', async () => {
    let registry = new MapPromptRegistry()
    for (const p of BUILTIN_PROMPT_PROVIDERS) registry.register(p)
    const result = await registry.getPrompt('role-activation', { role: 'luban' })
    const text = (result.messages[0]!.content as { text: string }).text
    expect(text).toMatch(/luban/)
    expect(text).toMatch(/激活/)
  })

  it('B-3: reflect-cycle 注入 experience → 提示文本含经验', async () => {
    let registry = new MapPromptRegistry()
    for (const p of BUILTIN_PROMPT_PROVIDERS) registry.register(p)
    const result = await registry.getPrompt('reflect-cycle', { role: 'nuwa', experience: 'Feature: 修复 bug' })
    const text = (result.messages[0]!.content as { text: string }).text
    expect(text).toMatch(/nuwa/)
    expect(text).toMatch(/修复 bug/)
    expect(text).toMatch(/reflect/)
    expect(text).toMatch(/realize/)
    expect(text).toMatch(/master/)
  })

  it('B-4: lifecycle-goal 注入 goal → 提示文本含 goal + 工具链', async () => {
    let registry = new MapPromptRegistry()
    for (const p of BUILTIN_PROMPT_PROVIDERS) registry.register(p)
    const result = await registry.getPrompt('lifecycle-goal', { role: 'sean', goal: '上线 Perseng 2.4.1' })
    const text = (result.messages[0]!.content as { text: string }).text
    expect(text).toMatch(/sean/)
    expect(text).toMatch(/上线 Perseng 2\.4\.1/)
    expect(text).toMatch(/want/)
    expect(text).toMatch(/plan/)
    expect(text).toMatch(/focus/)
  })

  it('B-5: 缺参数时回占位符（不抛错）', async () => {
    const result = await RoleActivationPrompt.get({})
    const text = (result.messages[0]!.content as { text: string }).text
    expect(text).toMatch(/<role-id>/) // 占位符
  })
})