/**
 * ResourceProtocol - 资源协议接口基类
 * 定义所有DPML资源协议的统一规范
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace，
 * 旧 .js 子类 (12 个 protocol/*.js) 直接 `require('./ResourceProtocol')` 当 class 继承。
 *
 * KNUTH-NOTE: types.ts 也用 `export =`, ESM `import { QueryParams }` 不行。
 * 用 TS 的 import = require() 拿 instance type。
 */
import { error as logErr } from '@promptx/logger'
import typesModule = require('../types')
type QueryParams = InstanceType<typeof typesModule.QueryParams>

abstract class ResourceProtocol {
  public name: string
  public options: { enableCache?: boolean; [k: string]: unknown }
  public cache: Map<string, string>
  public enableCache: boolean

  constructor(name: string, options: { enableCache?: boolean; [k: string]: unknown } = {}) {
    if (new.target === ResourceProtocol) {
      throw new Error('ResourceProtocol是抽象类，不能直接实例化')
    }

    this.name = name
    this.options = options
    this.cache = new Map()
    this.enableCache = options.enableCache === true
  }

  abstract getProtocolInfo(): { name: string; description: string; [k: string]: unknown }
  abstract resolvePath(resourcePath: string, queryParams: QueryParams): Promise<string>
  abstract loadContent(resolvedPath: string, queryParams: QueryParams): Promise<string>

  validatePath(resourcePath: string): boolean {
    return typeof resourcePath === 'string' && resourcePath.length > 0
  }

  getSupportedParams(): Record<string, string> {
    return {
      line: 'string - 行范围，如 "1-10"',
      format: 'string - 输出格式',
      cache: 'boolean - 是否缓存',
    }
  }

  async resolve(resourcePath: string, queryParams: QueryParams): Promise<string> {
    if (!this.validatePath(resourcePath)) {
      const error = new Error(`无效的资源路径: ${resourcePath}`)
      logErr(`[ResourceProtocol] 路径验证失败: ${resourcePath}`)
      logErr(`[ResourceProtocol] 调用堆栈:`, { stack: error.stack ?? '' })
      throw error
    }

    const cacheKey = this.generateCacheKey(resourcePath, queryParams)

    if (this.enableCache) {
      const cached = this.cache.get(cacheKey)
      if (cached !== undefined) {
        return cached
      }
    }

    const resolvedPath = await this.resolvePath(resourcePath, queryParams)
    const content = await this.loadContent(resolvedPath, queryParams)
    const filteredContent = this.applyCommonParams(content, queryParams)

    if (this.enableCache) {
      this.cache.set(cacheKey, filteredContent)
    }

    return filteredContent
  }

  generateCacheKey(resourcePath: string, queryParams: QueryParams): string {
    const params = queryParams ? queryParams.getAll() : {}
    return `${this.name}:${resourcePath}:${JSON.stringify(params)}`
  }

  applyCommonParams(content: string, queryParams: QueryParams): string {
    if (!queryParams) {
      return content
    }

    let result = content

    if (queryParams.line) {
      result = this.applyLineFilter(result, queryParams.line)
    }

    if (queryParams.format && queryParams.format !== 'text') {
      result = this.applyFormat(result, queryParams.format)
    }

    return result
  }

  applyLineFilter(content: string, lineRange: string): string {
    const lines = content.split('\n')

    if (lineRange.includes('-')) {
      const [startStr, endStr] = lineRange.split('-').map((n) => parseInt(n.trim(), 10))
      const start = startStr ?? 0
      const end = endStr ?? lines.length
      const startIndex = Math.max(0, start - 1)
      const endIndex = Math.min(lines.length, end)
      return lines.slice(startIndex, endIndex).join('\n')
    } else {
      const lineNum = parseInt(lineRange, 10)
      const lineIndex = lineNum - 1
      return lines[lineIndex] ?? ''
    }
  }

  applyFormat(content: string, format: string): string {
    switch (format) {
      case 'json':
        try {
          return JSON.stringify(JSON.parse(content), null, 2)
        } catch {
          return content
        }
      case 'trim':
        return content.trim()
      default:
        return content
    }
  }

  clearCache(): void {
    this.cache.clear()
  }

  getCacheStats(): { protocol: string; size: number; enabled: boolean } {
    return {
      protocol: this.name,
      size: this.cache.size,
      enabled: this.enableCache,
    }
  }
}

export = ResourceProtocol