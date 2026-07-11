/**
 * ResourceRegistry + 3 builtin providers 单测 (3.3 P1)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.3 / 批次 2)
 * 验证 registry 行为 + 3 个 builtin provider 的错误路径。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MapResourceRegistry, ResourceNotFoundError } from '../ResourceRegistry.js'
import { BUILTIN_RESOURCE_PROVIDERS } from '../../resources/builtinProviders.js'

// ============================================================================
// MapResourceRegistry
// ============================================================================

describe('MapResourceRegistry', () => {
  let registry: MapResourceRegistry

  beforeEach(() => {
    registry = new MapResourceRegistry()
  })

  it('R-1: register + get 返回同一对象', () => {
    registry.register(BUILTIN_RESOURCE_PROVIDERS[0]!)
    expect(registry.get(BUILTIN_RESOURCE_PROVIDERS[0]!.uri)).toBe(BUILTIN_RESOURCE_PROVIDERS[0])
  })

  it('R-2: 同 uri 重复注册抛错', () => {
    registry.register(BUILTIN_RESOURCE_PROVIDERS[0]!)
    expect(() => registry.register(BUILTIN_RESOURCE_PROVIDERS[0]!)).toThrow(/duplicate/)
  })

  it('R-3: uri 不以 perseng:// 开头抛错', () => {
    expect(() =>
      registry.register({
        uri: 'http://bad',
        name: 'n',
        description: 'd',
        mimeType: 'application/json',
        read: async () => ({ contents: [{ uri: 'http://bad', mimeType: 'application/json', text: '' }] }),
      }),
    ).toThrow(/perseng:\/\//)
  })

  it('R-4: list 返回 uri/name/description/mimeType', () => {
    for (const p of BUILTIN_RESOURCE_PROVIDERS) registry.register(p)
    const list = registry.list()
    expect(list).toHaveLength(BUILTIN_RESOURCE_PROVIDERS.length)
    expect(list[0]!.uri).toBe('perseng://roles')
    expect(list[0]!.mimeType).toBe('application/json')
  })

  it('R-5: read 路由 — 未注册抛 ResourceNotFoundError', async () => {
    await expect(registry.read('perseng://nope')).rejects.toBeInstanceOf(ResourceNotFoundError)
  })

  it('R-6: read 路由到 provider.read', async () => {
    let called = 0
    const provider = {
      uri: 'perseng://test',
      name: 't',
      description: 'd',
      mimeType: 'application/json',
      read: async () => {
        called++
        return { contents: [{ uri: 'perseng://test', mimeType: 'application/json', text: '{"ok":true}' }] }
      },
    }
    registry.register(provider)
    const result = await registry.read('perseng://test')
    expect(called).toBe(1)
    expect((result.contents[0] as { text: string }).text).toBe('{"ok":true}')
  })

  it('R-7: read 传 args 到 provider.read', async () => {
    let receivedArgs: unknown = null
    const provider = {
      uri: 'perseng://args',
      name: 'a',
      description: 'd',
      mimeType: 'application/json',
      read: async (args?: unknown) => {
        receivedArgs = args
        return { contents: [{ uri: 'perseng://args', mimeType: 'application/json', text: '{}' }] }
      },
    }
    registry.register(provider)
    await registry.read('perseng://args', { sessionId: 's1' })
    expect(receivedArgs).toEqual({ sessionId: 's1' })
  })

  it('R-8: size / clear', () => {
    expect(registry.size()).toBe(0)
    registry.register(BUILTIN_RESOURCE_PROVIDERS[0]!)
    registry.register(BUILTIN_RESOURCE_PROVIDERS[1]!)
    expect(registry.size()).toBe(2)
    registry.clear()
    expect(registry.size()).toBe(0)
  })
})

// ============================================================================
// BUILTIN_RESOURCE_PROVIDERS
// ============================================================================

describe('BUILTIN_RESOURCE_PROVIDERS', () => {
  it('B-1: 3 个 builtin providers 的 uri', () => {
    expect(BUILTIN_RESOURCE_PROVIDERS).toHaveLength(3)
    const uris = BUILTIN_RESOURCE_PROVIDERS.map((p) => p.uri)
    expect(uris).toContain('perseng://roles')
    expect(uris).toContain('perseng://events/stats')
    expect(uris).toContain('perseng://events/recent')
  })

  it('B-2: 全部以 application/json mimeType', () => {
    for (const p of BUILTIN_RESOURCE_PROVIDERS) {
      expect(p.mimeType).toBe('application/json')
    }
  })

  it('B-3: EventsStats 不可用时不抛错（fallback JSON）', async () => {
    // BUILTIN_RESOURCE_PROVIDERS 由 import('@promptx/events').getEventStore() 等降级
    // 即便 events 模块加载失败，也应回 JSON。
    // 这里只验证它至少 return 一个 ReadResourceResult（不会 throw 给 registry）。
    const result = await EventsStatsResourceProvider.read()
    expect((result.contents[0] as { uri: string }).uri).toBe('perseng://events/stats')
    expect(() => JSON.parse((result.contents[0] as { text: string }).text)).not.toThrow()
  })

  it('B-4: RecentEvents 不可用时回 JSON', async () => {
    const result = await RecentEventsResourceProvider.read()
    expect((result.contents[0] as { uri: string }).uri).toBe('perseng://events/recent')
    expect(() => JSON.parse((result.contents[0] as { text: string }).text)).not.toThrow()
  })

  it('B-5: Roles 不可用时回 JSON', async () => {
    const result = await RolesResourceProvider.read()
    expect((result.contents[0] as { uri: string }).uri).toBe('perseng://roles')
    expect(() => JSON.parse((result.contents[0] as { text: string }).text)).not.toThrow()
  })
})

// 提供给上面的 import 解析使用
import { EventsStatsResourceProvider } from '../../resources/builtinProviders.js'
import { RecentEventsResourceProvider } from '../../resources/builtinProviders.js'
import { RolesResourceProvider } from '../../resources/builtinProviders.js'