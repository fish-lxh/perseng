/**
 * DiscoverCommand 单测：parseDiscoverOptions 过滤参数解析
 *
 * 完整集成测试需要 mock ResourceManager / ProjectManager / RolexBridge 全链路，
 * 收益边际。这里聚焦最易出错且最关键的参数解析 + 默认值。
 *
 * P0 step 0B.4.1: 迁 .js → .ts, 用 ESM import + vitest extensionAlias
 * （discoverOptions.js → discoverOptions.ts 自动解析）。
 */

import { describe, it, expect } from 'vitest'
import { parseDiscoverOptions } from '../discoverOptions.js'

describe('parseDiscoverOptions', () => {
  it('默认（无参数）→ 全部 false', () => {
    const out = parseDiscoverOptions([])
    expect(out).toEqual({ all: false, includeArchived: false, archived: false })
  })

  it('默认（undefined）→ 全部 false', () => {
    const out = parseDiscoverOptions(undefined)
    expect(out).toEqual({ all: false, includeArchived: false, archived: false })
  })

  it('opts object 解析为布尔', () => {
    const out = parseDiscoverOptions([{ all: true }])
    expect(out.all).toBe(true)
    expect(out.includeArchived).toBe(false)
    expect(out.archived).toBe(false)
  })

  it('--archived 覆盖 --all', () => {
    const out = parseDiscoverOptions([{ all: true, archived: true }])
    expect(out.archived).toBe(true)
    expect(out.all).toBe(false)
    expect(out.includeArchived).toBe(false)
  })

  it('--include-archived 保持', () => {
    const out = parseDiscoverOptions([{ includeArchived: true }])
    expect(out.includeArchived).toBe(true)
    expect(out.all).toBe(false)
  })

  it('三个 boolean 互斥时的优先级（archived 优先）', () => {
    const out = parseDiscoverOptions([{ all: true, includeArchived: true, archived: true }])
    expect(out.archived).toBe(true)
    expect(out.all).toBe(false)
    expect(out.includeArchived).toBe(false)
  })

  it('args 是字符串数组（命令行模式）时返回默认', () => {
    // PouchCLI 内部保证传 array of options，但万一有人传 ['--all'] 这种字符串数组
    const out = parseDiscoverOptions(['--all'])
    expect(out).toEqual({ all: false, includeArchived: false, archived: false })
  })

  it('args 是多元素 array 时只看第一个', () => {
    const out = parseDiscoverOptions([{ all: true }, { archived: true }])
    expect(out.all).toBe(true)
  })
})
