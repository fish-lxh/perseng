/**
 * WorkspaceService — folder/file CRUD with workspace-root path sandboxing.
 *
 * KNUTH-FEAT 2026-07-11: G2.1 抽取自 apps/desktop/src/main/services/WorkspaceService.ts.
 * 纯 Node.js, 不依赖 electron; 任何 host (desktop / CLI / server) 都可以直接消费。
 *
 * 关键约束:
 *  - 配置文件落在 ~/.perseng/workspaces.json (跟原有惯例一致)
 *  - assertPathAllowed 强制 workspace 根白名单, 防止 listDir/readFile/writeFile
 *    越界访问宿主文件系统
 *  - 512KB readFile 上限, 超长文件截断 + 标注
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export interface WorkspaceFolder {
  id: string
  name: string
  path: string
  added_at: string
}

interface WorkspaceFoldersConfig {
  folders: WorkspaceFolder[]
}

export interface DirEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: string | null
}

export class WorkspaceService {
  private configPath: string

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(homedir(), '.perseng', 'workspaces.json')
  }

  async getFolders(): Promise<WorkspaceFolder[]> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8')
      const cfg: WorkspaceFoldersConfig = JSON.parse(raw)
      return cfg.folders || []
    } catch {
      return []
    }
  }

  async addFolder(folderPath: string, name: string): Promise<WorkspaceFolder> {
    const folders = await this.getFolders()
    const normalizedPath = path.resolve(folderPath)
    const folder: WorkspaceFolder = {
      id: randomUUID(),
      name,
      path: normalizedPath,
      added_at: new Date().toISOString(),
    }
    folders.push(folder)
    await this.saveFolders(folders)
    return folder
  }

  async removeFolder(id: string): Promise<void> {
    const folders = await this.getFolders()
    await this.saveFolders(folders.filter((f) => f.id !== id))
  }

  async listDir(dirPath: string): Promise<DirEntry[]> {
    await this.assertPathAllowed(dirPath)
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const IGNORE = new Set([
      'node_modules',
      '.git',
      '.DS_Store',
      'Thumbs.db',
      'dist',
      '.next',
      '__pycache__',
    ])
    const result: DirEntry[] = []
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue
      try {
        const stat = await fs.stat(path.join(dirPath, e.name))
        result.push({
          name: e.name,
          path: path.join(dirPath, e.name),
          is_dir: e.isDirectory(),
          size: stat.isFile() ? stat.size : 0,
          modified: stat.mtime.toISOString(),
        })
      } catch {
        /* skip inaccessible */
      }
    }
    result.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return result
  }

  async readFile(filePath: string): Promise<string> {
    await this.assertPathAllowed(filePath)
    const MAX = 512 * 1024 // 512KB
    const buf = await fs.readFile(filePath)
    if (buf.length > MAX) return buf.subarray(0, MAX).toString('utf-8') + '\n\n[文件已截断]'
    return buf.toString('utf-8')
  }

  async readFileBase64(filePath: string): Promise<string> {
    await this.assertPathAllowed(filePath)
    const buf = await fs.readFile(filePath)
    return buf.toString('base64')
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await this.assertPathAllowed(filePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
  }

  async createDir(dirPath: string): Promise<void> {
    await this.assertPathAllowed(dirPath)
    await fs.mkdir(dirPath, { recursive: true })
  }

  async deleteItem(itemPath: string): Promise<void> {
    await this.assertPathAllowed(itemPath, { allowRoot: false })
    await fs.rm(itemPath, { recursive: true, force: true })
  }

  /** 测试用: 取得当前配置文件路径 */
  getConfigPath(): string {
    return this.configPath
  }

  private async assertPathAllowed(
    targetPath: string,
    options?: { allowRoot?: boolean }
  ): Promise<void> {
    const resolvedTarget = path.resolve(targetPath)
    const roots = (await this.getFolders()).map((folder) => path.resolve(folder.path))
    if (roots.length === 0) {
      throw new Error('No workspace folder registered')
    }

    const matchedRoot = roots.find((root) => this.isPathInside(root, resolvedTarget))
    if (!matchedRoot) {
      throw new Error('Path is outside registered workspaces')
    }

    if (options?.allowRoot === false && resolvedTarget === matchedRoot) {
      throw new Error('Deleting the workspace root is not allowed')
    }
  }

  private isPathInside(rootPath: string, targetPath: string): boolean {
    const relative = path.relative(rootPath, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  private async saveFolders(folders: WorkspaceFolder[]): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })
    await fs.writeFile(
      this.configPath,
      JSON.stringify({ folders }, null, 2),
      'utf-8'
    )
  }
}

export const workspaceService = new WorkspaceService()
