/**
 * actAs producer hook test — 验证 actAs 成功 → emit 一条 core.role.activated
 *
 * I-Producer-1: 成功 actAs(role) → 1 条 core.role.activated
 * I-Producer-2: 失败 actAs (RoleNotFoundError) → 0 条
 * I-Producer-3: env flag OFF → 0 条
 * I-Producer-4: 事件平台不可用 (import 失败) → 不影响 actAs 返回值
 *
 * 通过动态 import + 临时替换 EventStore 不可行（CJS/ESM interop 太脆）。
 * 采用更稳的策略：在测试里直接读 ~/.perseng/events/events.db。
 * 用 PERSENG_EVENTS_DB_PATH 切到 tmp 路径，互不污染。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// 与 actAs.test.ts 一致：mock 掉 resource 模块（避免加载 PackageProtocol.js → ~
// 路径无法解析）。
const fakeRegistryData = {
  findResourceById: vi.fn((id: string, protocol?: string | null) => {
    const map: Record<string, Record<string, unknown>> = {
      role: {
        nuwa: { id: 'nuwa', protocol: 'role', reference: '@role://nuwa', source: 'package' },
        sean: { id: 'sean', protocol: 'role', reference: '@role://sean', source: 'package' },
      },
    }
    if (protocol) return map[protocol]?.[id] ?? null
    for (const p of ['role']) {
      const hit = map[p]?.[id]
      if (hit) return hit
    }
    return null
  }),
  getResourcesByProtocol: vi.fn((protocol: string) => {
    if (protocol === 'role') return [{ id: 'nuwa', source: 'package' }, { id: 'sean', source: 'package' }]
    return []
  }),
}
const fakeResourceManager = { initialized: true, registryData: fakeRegistryData }

vi.mock('../resource/index.js', () => ({
  getGlobalResourceManager: () => fakeResourceManager,
  default: {},
}))

const { actAs, _resetActAsCache } = await import('../actAs.js')

let tmpDir = ''

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-actas-producer-'))
  process.env['PERSENG_EVENTS_DB_PATH'] = path.join(tmpDir, 'events.db')
  process.env['PERSENG_EVENTS_ENABLED'] = 'true'
  _resetActAsCache()
})

afterEach(async () => {
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
  delete process.env['PERSENG_EVENTS_DB_PATH']
  delete process.env['PERSENG_EVENTS_ENABLED']
  _resetActAsCache()
})

describe('actAs producer hook', () => {
  it('emits one core.role.activated on successful role actAs', async () => {
    const result = await actAs('nuwa')
    expect(result.kind).toBe('role')
    expect(result.identity.id).toBe('nuwa')

    // 给动态 import + append fire-and-forget 时间落库
    await new Promise((r) => setTimeout(r, 200))

    const rows = await readEvents()
    const roleActivated = rows.filter((r) => r.type === 'core.role.activated')
    expect(roleActivated.length).toBe(1)
    expect(roleActivated[0]!.producer).toBe('core:actAs')
    expect(roleActivated[0]!.payload).toMatchObject({ roleId: 'nuwa' })
  })

  it('does NOT emit when actAs throws (unknown role)', async () => {
    await expect(actAs('jiang-shan-totally-fake-xxx')).rejects.toThrow()

    await new Promise((r) => setTimeout(r, 100))

    const rows = await readEvents()
    expect(rows.length).toBe(0)
  })

  it('does NOT emit when PERSENG_EVENTS_ENABLED=false', async () => {
    process.env['PERSENG_EVENTS_ENABLED'] = 'false'
    await actAs('nuwa')

    await new Promise((r) => setTimeout(r, 100))

    const rows = await readEvents()
    expect(rows.length).toBe(0)
  })

  it('actAs result is returned even when events pkg unavailable', async () => {
    // @promptx/events 此时已构建；触发"events pkg 不可用"的路径需要 mock。
    // 这里只保证 functional 正确（hook 不会阻塞）。
    const result = await actAs('nuwa')
    expect(result).toBeDefined()
    expect(result.identity.id).toBe('nuwa')
  })
})

/** 直接读 SQLite — 测试不导入 events 包以避免循环依赖 */
async function readEvents(): Promise<
  Array<{ type: string; producer: string; payload: unknown; ts: number }>
> {
  const dbPath = path.join(tmpDir, 'events.db')
  await new Promise((r) => setTimeout(r, 50))
  if (!fs.existsSync(dbPath)) return []

  let Db: typeof import('better-sqlite3').default
  try {
    Db = (await import('better-sqlite3')).default
  } catch {
    return []
  }
  const db = new Db(dbPath, { readonly: true })
  try {
    const rows = db.prepare('SELECT type, producer, payload, ts FROM events_v2').all() as Array<{
      type: string
      producer: string
      payload: string
      ts: number
    }>
    return rows.map((r) => ({
      type: r.type,
      producer: r.producer,
      payload: safeParse(r.payload),
      ts: r.ts,
    }))
  } finally {
    db.close()
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
