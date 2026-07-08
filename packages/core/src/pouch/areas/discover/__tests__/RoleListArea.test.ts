/**
 * RoleListArea 渲染测试
 *
 * 覆盖：
 * - 默认不显示归档标记
 * - showArchived=true 时给 archived 角色加 ⚠️ [已归档] 前缀
 * - onlyArchived=true 时顶部加提示
 * - V2 角色走 V2 分支（archiveTag 同样生效）
 * - 混合来源 + 混合 archived 状态
 *
 * P0 step 0B.4.2: 迁 .js → .ts, 用 ESM import + vitest extensionAlias
 */

import { describe, it, expect } from 'vitest'
import { RoleListArea, type RoleCategories, type RoleEntry } from '../RoleListArea.js'

/** 把扁平角色列表按 source 字段分类成 RoleCategories。 */
function makeCategories(roles: RoleEntry[]): RoleCategories {
  const out: RoleCategories = { system: [], project: [], user: [], rolex: [] }
  for (const r of roles) {
    const key = r.source ?? 'user'
    if (!out[key]) out[key] = []
    out[key].push(r)
  }
  return out
}

describe('RoleListArea / default rendering', () => {
  it('renders V1 role without archive tag', async () => {
    const area = new RoleListArea(
      makeCategories([{ id: 'luban', name: '鲁班', source: 'system' }]),
      null,
      { showArchived: false, onlyArchived: false },
    )
    const out = await area.render()
    expect(out).toContain('鲁班')
    expect(out).toContain('`luban`')
    expect(out).toContain('action("luban")')
    expect(out).not.toContain('已归档')
  })

  it('renders V2 role with [V2] marker and V2 command', async () => {
    const area = new RoleListArea(
      makeCategories([{ id: 'foo', name: 'Foo', source: 'rolex', version: 'v2' }]),
      null,
      { showArchived: false, onlyArchived: false },
    )
    const out = await area.render()
    expect(out).toContain('[V2]')
    expect(out).toContain('action({ operation: "activate", role: "foo" })')
  })

  it('renders V2 role with org info when directory provided', async () => {
    const area = new RoleListArea(
      makeCategories([{ id: 'foo', name: 'Foo', source: 'rolex', version: 'v2' }]),
      { roles: [{ name: 'foo', org: 'Acme', position: 'CTO' }], organizations: [] },
      {},
    )
    const out = await area.render()
    expect(out).toContain('Acme')
    expect(out).toContain('CTO')
  })
})

describe('RoleListArea / archive tag (showArchived)', () => {
  it('adds ⚠️ [已归档] prefix when role.archived=true and showArchived', async () => {
    const area = new RoleListArea(
      makeCategories([
        { id: 'luban', name: '鲁班', source: 'system', archived: true },
        { id: 'nuwa', name: '女娲', source: 'system', archived: false },
      ]),
      null,
      { showArchived: true, onlyArchived: false },
    )
    const out = await area.render()
    expect(out).toContain('⚠️ [已归档] `luban`')
    expect(out).not.toContain('⚠️ [已归档] `nuwa`')
    // 顶部加提示
    expect(out).toContain('包含已归档角色')
  })

  it('adds ⚠️ tag for V2 archived role too', async () => {
    const area = new RoleListArea(
      makeCategories([
        { id: 'foo', name: 'Foo', source: 'rolex', version: 'v2', archived: true },
      ]),
      null,
      { showArchived: true, onlyArchived: false },
    )
    const out = await area.render()
    expect(out).toContain('⚠️ [已归档] `foo` [V2]')
  })
})

describe('RoleListArea / onlyArchived', () => {
  it('top header says 仅显示已归档角色', async () => {
    const area = new RoleListArea(
      makeCategories([
        { id: 'luban', name: '鲁班', source: 'system', archived: true },
      ]),
      null,
      { showArchived: true, onlyArchived: true },
    )
    const out = await area.render()
    expect(out).toContain('仅显示已归档角色')
    // 即使 onlyArchived，archived 角色还是带 ⚠️ 标签（保持视觉一致）
    expect(out).toContain('⚠️ [已归档]')
  })
})

describe('RoleListArea / mixed sources', () => {
  it('renders all four source categories correctly', async () => {
    const area = new RoleListArea(
      {
        system: [{ id: 'sys1', name: '系统1', source: 'system' }],
        project: [{ id: 'prj1', name: '项目1', source: 'project' }],
        user: [{ id: 'usr1', name: '用户1', source: 'user' }],
        rolex: [{ id: 'v2one', name: 'V2', source: 'rolex', version: 'v2' }],
      },
      null,
      {},
    )
    const out = await area.render()
    expect(out).toContain('系统角色')
    expect(out).toContain('项目角色')
    expect(out).toContain('用户角色')
    expect(out).toContain('V2角色 (RoleX)')
  })
})
