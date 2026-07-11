/**
 * WorkspaceService 单元测试 — KNUTH-FEAT 2026-07-11 G2.1.
 *
 * 用临时目录 + 临时 config 路径注入, 验证:
 *  - addFolder / getFolders / removeFolder 配置持久化
 *  - listDir 排除 IGNORE 集合
 *  - 读大文件 512KB 截断
 *  - assertPathAllowed 阻止 workspace 之外访问
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { WorkspaceService } from './WorkspaceService.js'

let tmpRoot: string
let tmpCfg: string
let svc: WorkspaceService

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wsh-test-'))
  tmpCfg = path.join(tmpRoot, 'workspaces.json')
  svc = new WorkspaceService(tmpCfg)
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('WorkspaceService - folders CRUD', () => {
  it('returns empty list when config missing', async () => {
    expect(await svc.getFolders()).toEqual([])
  })

  it('addFolder persists and getFolders round-trips', async () => {
    const folder = await svc.addFolder(tmpRoot, 'tmp')
    expect(folder.path).toBe(path.resolve(tmpRoot))
    expect(folder.id).toBeTruthy()
    expect(folder.name).toBe('tmp')

    const svc2 = new WorkspaceService(tmpCfg)
    const loaded = await svc2.getFolders()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.id).toBe(folder.id)
  })

  it('removeFolder filters by id', async () => {
    const a = await svc.addFolder(tmpRoot, 'a')
    const b = await svc.addFolder(path.join(tmpRoot, 'sub'), 'b')
    await svc.removeFolder(a.id)
    const remaining = await svc.getFolders()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).toBe(b.id)
  })

  it('two services share the same config file', async () => {
    await svc.addFolder(tmpRoot, 'one')
    const svc2 = new WorkspaceService(tmpCfg)
    await svc2.addFolder(path.join(tmpRoot, 'two'), 'two')
    const all = await svc.getFolders()
    expect(all).toHaveLength(2)
  })
})

describe('WorkspaceService - listDir + path sandbox', () => {
  beforeEach(async () => {
    await svc.addFolder(tmpRoot, 'root')
    await fs.writeFile(path.join(tmpRoot, 'a.txt'), 'hello')
    await fs.mkdir(path.join(tmpRoot, 'sub'))
    await fs.writeFile(path.join(tmpRoot, 'sub', 'b.txt'), 'world')
    // IGNORE 集合中
    await fs.mkdir(path.join(tmpRoot, 'node_modules'))
    await fs.mkdir(path.join(tmpRoot, '.git'))
  })

  it('returns dir entries with is_dir + size', async () => {
    const entries = await svc.listDir(tmpRoot)
    expect(entries.find((e) => e.name === 'a.txt')).toMatchObject({
      is_dir: false,
      size: 5,
    })
    expect(entries.find((e) => e.name === 'sub')).toMatchObject({ is_dir: true })
  })

  it('filters IGNORE set (node_modules, .git)', async () => {
    const entries = await svc.listDir(tmpRoot)
    const names = entries.map((e) => e.name)
    expect(names).toContain('a.txt')
    expect(names).toContain('sub')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
  })

  it('rejects paths outside registered workspaces', async () => {
    const outside = path.join(os.tmpdir(), 'definitely-not-registered-x9z')
    await expect(svc.listDir(outside)).rejects.toThrow(
      /outside registered workspaces/
    )
  })

  it('rejects readFile outside registered workspaces', async () => {
    const outside = path.join(os.tmpdir(), 'definitely-not-registered-x9z', 'file.txt')
    await expect(svc.readFile(outside)).rejects.toThrow(
      /outside registered workspaces/
    )
  })

  it('rejects deleteItem on workspace root', async () => {
    await expect(svc.deleteItem(tmpRoot)).rejects.toThrow(
      /workspace root is not allowed/
    )
  })
})

describe('WorkspaceService - readFile truncation', () => {
  beforeEach(async () => {
    await svc.addFolder(tmpRoot, 'root')
  })

  it('truncates files larger than 512KB', async () => {
    const big = path.join(tmpRoot, 'big.txt')
    const content = 'x'.repeat(600 * 1024) // 600KB
    await fs.writeFile(big, content, 'utf-8')
    const read = await svc.readFile(big)
    expect(read.length).toBeLessThan(content.length)
    expect(read).toContain('[文件已截断]')
  })

  it('reads small files verbatim', async () => {
    const small = path.join(tmpRoot, 'small.txt')
    await fs.writeFile(small, 'hello world', 'utf-8')
    expect(await svc.readFile(small)).toBe('hello world')
  })
})
