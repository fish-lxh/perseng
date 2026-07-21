/**
 * 用户目录协议实现
 * 实现@user://协议，直接映射到用户主目录
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE: env-paths 外部包, getUserDirectories() 内部 helper 不导出。
 */
import path from 'path'
import fs from 'fs'
import envPaths from 'env-paths'
import os from 'os'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

interface UserDirectories {
  getHomeFolder: () => string
  getDesktopFolder: () => string
  getDocumentsFolder: () => string
  getDownloadsFolder: () => string
  getMusicFolder: () => string
  getPicturesFolder: () => string
  getVideosFolder: () => string
  getDataFolder: () => string
  getConfigFolder: () => string
  getCacheFolder: () => string
  getLogFolder: () => string
  getTempFolder: () => string
}

const getUserDirectories = (): UserDirectories => {
  const persengPaths = envPaths('perseng')

  return {
    getHomeFolder: () => os.homedir(),
    getDesktopFolder: () => path.join(os.homedir(), 'Desktop'),
    getDocumentsFolder: () => path.join(os.homedir(), 'Documents'),
    getDownloadsFolder: () => path.join(os.homedir(), 'Downloads'),
    getMusicFolder: () => path.join(os.homedir(), 'Music'),
    getPicturesFolder: () => path.join(os.homedir(), 'Pictures'),
    getVideosFolder: () => path.join(os.homedir(), 'Videos'),
    getDataFolder: () => persengPaths.data,
    getConfigFolder: () => persengPaths.config,
    getCacheFolder: () => persengPaths.cache,
    getLogFolder: () => persengPaths.log,
    getTempFolder: () => persengPaths.temp,
  }
}

class UserProtocol extends ResourceProtocol {
  public userDirs: Record<string, string>
  public dirCache: Map<string, string>
  public registry: Record<string, unknown>

  constructor(options: { enableCache?: boolean; [k: string]: unknown } = {}) {
    super('user', options)
    this.registry = {}

    this.userDirs = {
      home: 'getHomeFolder',
      desktop: 'getDesktopFolder',
      documents: 'getDocumentsFolder',
      downloads: 'getDownloadsFolder',
      music: 'getMusicFolder',
      pictures: 'getPicturesFolder',
      videos: 'getVideosFolder',
      data: 'getDataFolder',
      config: 'getConfigFolder',
      cache: 'getCacheFolder',
      log: 'getLogFolder',
      temp: 'getTempFolder',
    }

    this.dirCache = new Map()
  }

  setRegistry(registry: Record<string, unknown>): void {
    this.registry = registry || {}
  }

  getProtocolInfo(): { name: string; description: string; location: string; examples: string[]; basePath: string; params: Record<string, string> } {
    return {
      name: 'user',
      description: '用户目录协议，直接映射到用户主目录',
      location: 'user://{path}',
      examples: [
        'user://.perseng/toolbox/text-analyzer',
        'user://.bashrc',
        'user://Documents/notes.txt',
        'user://Desktop/readme.md',
        'user://Downloads/file.zip',
        'user://.perseng/config.json',
      ],
      basePath: '用户主目录 (~)',
      params: this.getSupportedParams(),
    }
  }

  getSupportedParams(): Record<string, string> {
    return {
      ...super.getSupportedParams(),
      exists: 'boolean - 仅返回存在的文件/目录',
      type: 'string - 过滤类型 (file|dir|both)',
    }
  }

  validatePath(resourcePath: string): boolean {
    if (!resourcePath || typeof resourcePath !== 'string') {
      return false
    }

    if (resourcePath.startsWith('.perseng/')) {
      return true
    }

    const parts = resourcePath.split('/')
    const dirType = parts[0]
    return Object.prototype.hasOwnProperty.call(this.userDirs, dirType ?? '')
  }

  async resolvePath(resourcePath: string, _queryParams: QueryParams): Promise<string> {
    const userHomeDir = getUserDirectories().getHomeFolder()

    if (!resourcePath) {
      return userHomeDir
    }

    const fullPath = path.join(userHomeDir, resourcePath)
    const resolvedPath = path.resolve(fullPath)
    const resolvedUserDir = path.resolve(userHomeDir)

    if (!resolvedPath.startsWith(resolvedUserDir)) {
      throw new Error(`安全错误：路径超出用户目录范围: ${resolvedPath}`)
    }

    return resolvedPath
  }

  async getUserDirectory(dirType: string): Promise<string> {
    if (this.dirCache.has(dirType)) {
      return this.dirCache.get(dirType) as string
    }

    const userDirectories = getUserDirectories()
    const methodName = this.userDirs[dirType]

    if (!methodName || !userDirectories[methodName as keyof UserDirectories]) {
      throw new Error(`未找到用户目录获取方法: ${methodName}`)
    }

    try {
      const dirPath = userDirectories[methodName as keyof UserDirectories]()

      this.dirCache.set(dirType, dirPath)
      return dirPath
    } catch (error) {
      throw new Error(`获取用户目录失败 (${dirType}): ${(error as Error).message}`)
    }
  }

  async loadContent(resolvedPath: string, queryParams: QueryParams): Promise<string> {
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
        if (queryParams && queryParams.get('exists') === 'false') {
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

  async listUserDirectories(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {}

    for (const dirType of Object.keys(this.userDirs)) {
      try {
        result[dirType] = await this.getUserDirectory(dirType)
      } catch (error) {
        result[dirType] = { error: (error as Error).message }
      }
    }

    return result
  }

  clearCache(): void {
    super.clearCache()
    this.dirCache.clear()
  }
}

export = UserProtocol