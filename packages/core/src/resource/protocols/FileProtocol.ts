/**
 * 文件协议实现
 * 实现@file://协议，用于访问本地文件系统中的文件
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE: types.ts 用 `export =`, QueryParams 走 InstanceType<>。
 */
import path from 'path'
import fs from 'fs'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

class FileProtocol extends ResourceProtocol {
  public registry: Record<string, unknown>

  constructor(options: { enableCache?: boolean; [k: string]: unknown } = {}) {
    super('file', options)
    this.registry = {}
  }

  setRegistry(registry: Record<string, unknown>): void {
    this.registry = registry || {}
  }

  getProtocolInfo(): { name: string; description: string; location: string; examples: string[]; params: Record<string, string> } {
    return {
      name: 'file',
      description: '文件系统协议，提供本地文件访问',
      location: 'file://{path}',
      examples: [
        'file://package.json',
        'file:///absolute/path/to/file.txt',
        'file://./relative/path/file.md',
        'file://../parent/file.json',
      ],
      params: this.getSupportedParams(),
    }
  }

  getSupportedParams(): Record<string, string> {
    return {
      ...super.getSupportedParams(),
      encoding: 'string - 文件编码 (utf8, ascii, binary等)',
      exists: 'boolean - 仅返回存在的文件',
    }
  }

  validatePath(resourcePath: string): boolean {
    if (!super.validatePath(resourcePath)) {
      return false
    }
    return typeof resourcePath === 'string' && resourcePath.length > 0
  }

  async resolvePath(resourcePath: string, _queryParams: QueryParams): Promise<string> {
    let resolvedPath: string
    if (path.isAbsolute(resourcePath)) {
      resolvedPath = resourcePath
    } else {
      resolvedPath = path.resolve(process.cwd(), resourcePath)
    }
    resolvedPath = path.normalize(resolvedPath)
    return resolvedPath
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
}

export = FileProtocol