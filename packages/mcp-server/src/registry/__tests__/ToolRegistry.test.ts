/**
 * ToolRegistry 单元测试
 *
 * KNUTH-FEAT 2026-07-11 (批次 1 / RFC 目标 3.1)
 * 验证 MapToolRegistry + toToolWithHandler 适配器的契约。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MapToolRegistry,
  toToolWithHandler,
  type ToolRegistration,
} from '../ToolRegistry.js'
import type { ToolHandler } from '~/interfaces/MCPServer.js'

const okHandler: ToolHandler = async () => ({
  content: [{ type: 'text', text: 'ok' }],
})

const noopHandler: ToolHandler = async () => ({
  content: [],
})

function reg(name: string, caps: string[] = [], overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    manifest: {
      name,
      version: '2.4.1',
      capabilities: caps,
      dependencies: [],
      schemaVersion: 1,
      inputSchema: { type: 'object' } as ToolRegistration['manifest']['inputSchema'],
    },
    handler: okHandler,
    ...overrides,
  }
}

describe('MapToolRegistry', () => {
  let registry: MapToolRegistry

  beforeEach(() => {
    registry = new MapToolRegistry()
  })

  it('R-1: register + get 返回同一对象', () => {
    const r = reg('action')
    registry.register(r)
    expect(registry.get('action')).toBe(r)
  })

  it('R-2: 同名重复注册抛错', () => {
    registry.register(reg('action'))
    expect(() => registry.register(reg('action'))).toThrow(/duplicate registration/)
  })

  it('R-3: 未注册名 get 返回 undefined', () => {
    expect(registry.get('nope')).toBeUndefined()
  })

  it('R-4: list 按注册顺序返回', () => {
    registry.register(reg('discover'))
    registry.register(reg('action'))
    registry.register(reg('recall'))
    const names = registry.list().map((r) => r.manifest.name)
    expect(names).toEqual(['discover', 'action', 'recall'])
  })

  it('R-5: filterByCapability 按 capability 标签筛选', () => {
    registry.register(reg('discover', ['role:discover']))
    registry.register(reg('action', ['role:activate', 'role:born']))
    registry.register(reg('lifecycle', ['role:goal']))
    const activate = registry.filterByCapability('role:activate')
    expect(activate).toHaveLength(1)
    expect(activate[0]?.manifest.name).toBe('action')
    const born = registry.filterByCapability('role:born')
    expect(born[0]?.manifest.name).toBe('action')
    const missing = registry.filterByCapability('role:nope')
    expect(missing).toHaveLength(0)
  })

  it('R-6: size / clear 行为', () => {
    expect(registry.size()).toBe(0)
    registry.register(reg('a'))
    registry.register(reg('b'))
    expect(registry.size()).toBe(2)
    registry.clear()
    expect(registry.size()).toBe(0)
    expect(registry.get('a')).toBeUndefined()
  })

  it('R-7: 空 registry list 返回空数组', () => {
    expect(registry.list()).toEqual([])
  })
})

describe('toToolWithHandler', () => {
  it('A-1: 把 manifest.name 透传到 ToolWithHandler.name', () => {
    const r = reg('action')
    const t = toToolWithHandler(r)
    expect(t.name).toBe('action')
  })

  it('A-2: handler 透传', () => {
    const r = reg('action')
    const t = toToolWithHandler(r)
    expect(t.handler).toBe(r.handler)
  })

  it('A-3: description 是非空字符串（fallback）', () => {
    const r = reg('action', ['role:activate'])
    const t = toToolWithHandler(r)
    expect(typeof t.description).toBe('string')
    expect(t.description!.length).toBeGreaterThan(0)
    expect(t.description).toMatch(/action/)
  })

  it('A-4: setEventBus 透传（可选）', () => {
    const setEventBus = (bus: unknown) => { void bus }
    const r = reg('action', [], { setEventBus: setEventBus as ToolRegistration['setEventBus'] })
    const t = toToolWithHandler(r)
    expect(t.setEventBus).toBe(setEventBus)
  })

  it('A-5: 没有 setEventBus 时不报错', () => {
    const r = reg('action')
    const t = toToolWithHandler(r)
    expect(t.setEventBus).toBeUndefined()
  })

  it('A-6: inputSchema 透传', () => {
    const schema = {
      type: 'object' as const,
      properties: { role: { type: 'string' as const } },
    }
    const r = reg('action', [], {
      manifest: {
        name: 'action',
        version: '2.4.1',
        capabilities: [],
        dependencies: [],
        schemaVersion: 1,
        inputSchema: schema,
      },
    })
    const t = toToolWithHandler(r)
    expect(t.inputSchema).toEqual(schema)
  })

  it('A-7: handler 仍可被调用 (handler 自身仍然是 ToolHandler)', async () => {
    const r: ToolRegistration = {
      manifest: {
        name: 'noop',
        version: '2.4.1',
        capabilities: [],
        dependencies: [],
        schemaVersion: 1,
        inputSchema: { type: 'object' } as ToolRegistration['manifest']['inputSchema'],
      },
      handler: noopHandler,
    }
    const t = toToolWithHandler(r)
    const result = await t.handler({})
    expect(result.content).toEqual([])
  })
})