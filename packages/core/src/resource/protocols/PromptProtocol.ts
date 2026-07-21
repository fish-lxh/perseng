/**
 * Perseng内置提示词资源协议实现
 * 实现@prompt://协议，用于访问Perseng内置的提示词资源
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE: 依赖 PackageProtocol (setPackageProtocol); 类型用 unknown 暂代。
 */
import path from 'path'
import fs from 'fs'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

interface PackageProtocolLike {
  loadContent: (cleanPath: string, queryParams: QueryParams) => Promise<{ content?: string } | string>
  exists: (cleanPath: string, queryParams: QueryParams) => Promise<boolean>
  getPackageRoot: () => Promise<string>
}

class PromptProtocol extends ResourceProtocol {
  public registry: Map<string, string>
  public packageProtocol: PackageProtocolLike | null

  constructor(options: { enableCache?: boolean; [k: string]: unknown } = {}) {
    super('prompt', options)

    this.registry = new Map<string, string>([
      ['protocols', '@package://node_modules/@promptx/resource/protocol/**/*.md'],
      ['core', '@package://node_modules/@promptx/resource/core/**/*.md'],
      ['role', '@package://node_modules/@promptx/resource/role/**/*.md'],
      ['resource', '@package://node_modules/@promptx/resource/resource/**/*.md'],
      ['bootstrap', '@package://bootstrap.md'],
    ])

    this.packageProtocol = null
  }

  setPackageProtocol(packageProtocol: PackageProtocolLike): void {
    this.packageProtocol = packageProtocol
  }

  setRegistry(registry: Record<string, string> | Map<string, string> | null): void {
    if (!registry) {
      this.registry = new Map<string, string>()
      return
    }
    if (registry instanceof Map) {
      this.registry = registry
    } else {
      this.registry = new Map<string, string>(Object.entries(registry as Record<string, string>))
    }
  }

  getProtocolInfo(): { name: string; description: string; location: string; examples: string[]; availableResources: string[]; params: Record<string, string> } {
    const keys = Array.from(this.registry.keys())
    return {
      name: 'prompt',
      description: 'Perseng内置提示词资源协议',
      location: 'prompt://{resource_id}',
      examples: [
        'prompt://protocols',
        'prompt://core',
        'prompt://role',
        'prompt://bootstrap',
      ],
      availableResources: keys,
      params: this.getSupportedParams(),
    }
  }

  getSupportedParams(): Record<string, string> {
    return {
      ...super.getSupportedParams(),
      merge: 'boolean - 是否合并多个文件内容',
      separator: 'string - 文件间分隔符',
      include_filename: 'boolean - 是否包含文件名标题',
    }
  }

  validatePath(resourcePath: string): boolean {
    if (!super.validatePath(resourcePath)) {
      return false
    }
    return this.registry.has(resourcePath)
  }

  async resolvePath(resourcePath: string, _queryParams: QueryParams): Promise<string> {
    if (!this.registry.has(resourcePath)) {
      throw new Error(`未找到 prompt 资源: ${resourcePath}。可用资源: ${Array.from(this.registry.keys()).join(', ')}`)
    }
    return this.registry.get(resourcePath) ?? ''
  }

  async loadContent(packagePath: string, queryParams: QueryParams): Promise<string> {
    if (!this.packageProtocol) {
      throw new Error('PromptProtocol 需要 PackageProtocol 依赖')
    }

    if (packagePath.includes('**') || packagePath.includes('*')) {
      return await this.loadMultipleFiles(packagePath, queryParams)
    } else {
      return await this.loadSingleFile(packagePath, queryParams)
    }
  }

  async loadSingleFile(packagePath: string, queryParams: QueryParams): Promise<string> {
    try {
      const cleanPath = packagePath.replace('@package://', '')
      const result = await this.packageProtocol!.loadContent(cleanPath, queryParams)
      if (typeof result === 'string') return result
      if (result && typeof result === 'object' && 'content' in result) {
        return String(result.content ?? '')
      }
      return ''
    } catch (error) {
      throw new Error(`加载单个文件失败 ${packagePath}: ${(error as Error).message}`)
    }
  }

  async loadMultipleFiles(packagePath: string, queryParams: QueryParams): Promise<string> {
    try {
      const { glob } = await import('glob')
      const packageRoot = await this.packageProtocol!.getPackageRoot()

      const cleanPath = packagePath.replace('@package://', '')
      const searchPattern = path.join(packageRoot, cleanPath)

      const files = await glob(searchPattern, {
        ignore: ['**/node_modules/**', '**/.git/**'],
        absolute: true,
      })

      if (files.length === 0) {
        throw new Error(`没有找到匹配的文件: ${packagePath}`)
      }

      const contents: Array<{ path: string; content: string }> = []
      for (const filePath of files.sort()) {
        try {
          const content = await fs.promises.readFile(filePath, 'utf8')
          const relativePath = path.relative(packageRoot, filePath)
          contents.push({ path: relativePath, content })
        } catch (error) {
          console.warn(`警告: 无法读取文件 ${filePath}: ${(error as Error).message}`)
        }
      }

      return this.mergeContents(contents, queryParams)
    } catch (error) {
      throw new Error(`加载多个文件失败 ${packagePath}: ${(error as Error).message}`)
    }
  }

  mergeContents(contents: Array<{ path: string; content: string }>, queryParams: QueryParams): string {
    const merge = String(queryParams?.get('merge')) !== 'false'
    const separator = String(queryParams?.get('separator') || '\n\n---\n\n')
    const includeFilename = String(queryParams?.get('include_filename')) !== 'false'

    if (!merge) {
      return JSON.stringify(contents, null, 2)
    }

    const mergedParts = contents.map(({ path: p, content }) => {
      let part = ''
      if (includeFilename) {
        part += `# ${p}\n\n`
      }
      part += content
      return part
    })

    return mergedParts.join(separator)
  }

  async exists(resourcePath: string, queryParams: QueryParams): Promise<boolean> {
    try {
      const packagePath = await this.resolvePath(resourcePath, queryParams)

      if (packagePath.includes('**') || packagePath.includes('*')) {
        const { glob } = await import('glob')
        const packageRoot = await this.packageProtocol!.getPackageRoot()
        const cleanPath = packagePath.replace('@package://', '')
        const searchPattern = path.join(packageRoot, cleanPath)
        const files = await glob(searchPattern, {
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
        return files.length > 0
      } else {
        const cleanPath = packagePath.replace('@package://', '')
        return await this.packageProtocol!.exists(cleanPath, queryParams)
      }
    } catch (error) {
      return false
    }
  }

  listResources(): Array<{ id: string; path: string; description: string }> {
    const entries = Array.from(this.registry.entries())
    return entries.map(([key, value]) => ({
      id: key,
      path: value,
      description: this.getResourceDescription(key),
    }))
  }

  getResourceDescription(resourceId: string): string {
    const descriptions: Record<string, string> = {
      protocols: 'DPML协议规范文档',
      core: '核心思维和执行模式',
      role: '角色定义和专家能力',
      resource: '资源管理和路径解析',
      bootstrap: 'Perseng启动引导文件',
    }

    return descriptions[resourceId] || '未知资源'
  }
}

export = PromptProtocol