/**
 * 项目协议实现 - 新架构
 * 实现@project://协议，基于当前项目状态的高性能路径解析
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE:
 * - `~/project/...` 别名在 packages/core 不工作, 改用相对路径 ../../project/...
 * - ProjectManager.getCurrentProject() 仍是 .js, 类型 unknown
 * - require('crypto') inline 保留在 generateProjectHash 内
 */
import path from 'path'
import fs from 'fs'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')
import UserProtocolModule = require('./UserProtocol')
import { getGlobalProjectPathResolver } from '../../project/ProjectPathResolver'
import ProjectManager from '../../project/ProjectManager'

type QueryParams = InstanceType<typeof typesModule.QueryParams>
type UserProtocol = InstanceType<typeof UserProtocolModule>

interface ProjectPathResolverLike {
  getSupportedDirectories: () => string[]
  isSupportedDirectory: (dir: string) => boolean
  resolvePath: (p: string) => string
  getProjectRoot: () => string
  getPersengDirectory: () => string
}

interface CurrentProject {
  transport: 'http' | string
  workingDirectory: string
}

interface ProjectManagerLike {
  getCurrentProject: () => CurrentProject
}

interface ProjectInfoResult {
  projectRoot: string
  persengPath: string
  architecture: string
  supportedDirectories: string[]
  directories: Record<string, { path: string; exists: boolean; type?: string }>
}

class ProjectProtocol extends ResourceProtocol {
  public pathResolver: ProjectPathResolverLike | null
  public userProtocol: UserProtocol
  public registry: Record<string, unknown>

  constructor(options: { enableCache?: boolean; [k: string]: unknown } = {}) {
    super('project', options)
    this.pathResolver = null
    this.userProtocol = new UserProtocolModule(options)
    this.registry = {}
  }

  getPathResolver(): ProjectPathResolverLike {
    if (!this.pathResolver) {
      this.pathResolver = getGlobalProjectPathResolver() as ProjectPathResolverLike
    }
    return this.pathResolver
  }

  setRegistry(registry: Record<string, unknown>): void {
    this.registry = registry || {}
  }

  getProtocolInfo(): { name: string; description: string; location: string; examples: string[]; supportedDirectories: string[]; architecture: string; params: Record<string, string> } {
    return {
      name: 'project',
      description: '项目协议，基于当前项目状态的高性能路径解析',
      location: 'project://{directory}/{path}',
      examples: [
        'project://src/index.js',
        'project://lib/utils.js',
        'project://docs/README.md',
        'project://root/package.json',
        'project://test/unit/',
      ],
      supportedDirectories: this.getPathResolver().getSupportedDirectories(),
      architecture: 'state-based',
      params: this.getSupportedParams(),
    }
  }

  getSupportedParams(): Record<string, string> {
    return {
      ...super.getSupportedParams(),
      from: 'string - 指定搜索起始目录',
      create: 'boolean - 如果目录不存在是否创建',
      exists: 'boolean - 仅返回存在的文件/目录',
      type: 'string - 过滤类型 (file|dir|both)',
    }
  }

  validatePath(resourcePath: string): boolean {
    if (!super.validatePath(resourcePath)) {
      return false
    }
    if (resourcePath.startsWith('.perseng/')) {
      return true
    }
    const parts = resourcePath.split('/')
    const dirType = parts[0]
    return this.getPathResolver().isSupportedDirectory(dirType ?? '')
  }

  async resolvePath(resourcePath: string, queryParams: QueryParams): Promise<string> {
    try {
      const currentProject = (ProjectManager as unknown as ProjectManagerLike).getCurrentProject()
      const { transport } = currentProject

      if (transport === 'http') {
        return await this.resolveHttpPath(resourcePath, queryParams, currentProject)
      } else {
        return this.resolveLocalPath(resourcePath, queryParams, currentProject)
      }
    } catch (error) {
      throw new Error(`解析@project://路径失败: ${(error as Error).message}`)
    }
  }

  resolveLocalPath(resourcePath: string, _queryParams: QueryParams, _currentProject: CurrentProject): string {
    return this.getPathResolver().resolvePath(resourcePath)
  }

  async resolveHttpPath(resourcePath: string, _queryParams: QueryParams, currentProject: CurrentProject): Promise<string> {
    const projectHash = this.generateProjectHash(currentProject.workingDirectory)

    let mappedResourcePath: string
    if (resourcePath === '.perseng') {
      mappedResourcePath = 'data'
    } else if (resourcePath.startsWith('.perseng/')) {
      mappedResourcePath = resourcePath.replace(/^\.perseng\//, 'data/')
    } else {
      mappedResourcePath = `data/${resourcePath}`
    }

    const mappedPath = `.perseng/project/${projectHash}/${mappedResourcePath}`
    return await this.userProtocol.resolvePath(mappedPath, _queryParams)
  }

  generateProjectHash(projectPath: string): string {
    const crypto = require('crypto') as { createHash: (alg: string) => { update: (data: string) => { digest: (enc: string) => string } } }
    return crypto.createHash('md5').update(path.resolve(projectPath)).digest('hex').substr(0, 8)
  }

  async loadContent(resolvedPath: string, queryParams: QueryParams): Promise<string> {
    try {
      const currentProject = (ProjectManager as unknown as ProjectManagerLike).getCurrentProject()
      const { transport } = currentProject

      if (transport === 'http') {
        return await this.userProtocol.loadContent(resolvedPath, queryParams)
      } else {
        return await this.loadLocalContent(resolvedPath, queryParams)
      }
    } catch (error) {
      throw error
    }
  }

  async loadLocalContent(resolvedPath: string, queryParams: QueryParams): Promise<string> {
    try {
      const stats = await fs.promises.stat(resolvedPath)

      if (stats.isDirectory()) {
        return await this.loadDirectoryContent(resolvedPath, queryParams)
      } else if (stats.isFile()) {
        return await this.loadFileContent(resolvedPath, queryParams)
      } else {
        throw new Error(`不支持的文件类型: ${resolvedPath}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (queryParams?.get('create') === 'true') {
          await fs.promises.mkdir(path.dirname(resolvedPath), { recursive: true })
          return ''
        }
        if (queryParams?.get('exists') === 'false') {
          return ''
        }
        throw new Error(`文件或目录不存在: ${resolvedPath}`)
      }
      throw error
    }
  }

  async loadFileContent(filePath: string, queryParams: QueryParams): Promise<string> {
    const encoding = (queryParams?.get('encoding') || 'utf8') as BufferEncoding
    return await fs.promises.readFile(filePath, encoding)
  }

  async loadDirectoryContent(dirPath: string, queryParams: QueryParams): Promise<string> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    const typeFilter = queryParams?.get('type')
    let filteredEntries = entries

    if (typeFilter) {
      filteredEntries = entries.filter((entry) => {
        switch (typeFilter) {
          case 'file': return entry.isFile()
          case 'dir': return entry.isDirectory()
          case 'both': return true
          default: return true
        }
      })
    }

    const format = queryParams?.get('format') || 'list'

    switch (format) {
      case 'json':
        return JSON.stringify(
          filteredEntries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            path: path.join(dirPath, entry.name),
          })),
          null,
          2,
        )

      case 'paths':
        return filteredEntries
          .map((entry) => path.join(dirPath, entry.name))
          .join('\n')

      case 'list':
      default:
        return filteredEntries
          .map((entry) => {
            const type = entry.isDirectory() ? '[DIR]' : '[FILE]'
            return `${type} ${entry.name}`
          })
          .join('\n')
    }
  }

  async getProjectInfo(): Promise<ProjectInfoResult | { error: string; architecture: string }> {
    try {
      const resolver = this.getPathResolver()
      const projectRoot = resolver.getProjectRoot()
      const persengPath = resolver.getPersengDirectory()

      const result: ProjectInfoResult = {
        projectRoot,
        persengPath,
        architecture: 'state-based',
        supportedDirectories: resolver.getSupportedDirectories(),
        directories: {},
      }

      for (const dirType of resolver.getSupportedDirectories()) {
        try {
          const fullPath = resolver.resolvePath(dirType)
          const stats = await fs.promises.stat(fullPath)
          result.directories[dirType] = {
            path: fullPath,
            exists: true,
            type: stats.isDirectory() ? 'directory' : 'file',
          }
        } catch (error) {
          result.directories[dirType] = {
            path: 'N/A',
            exists: false,
          }
        }
      }

      return result
    } catch (error) {
      return {
        error: `获取项目信息失败: ${(error as Error).message}`,
        architecture: 'state-based',
      }
    }
  }

  clearCache(): void {
    super.clearCache()
  }
}

export = ProjectProtocol