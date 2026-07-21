/**
 * 资源模块基础数据类型定义
 * 基于DPML资源协议标准
 *
 * KNUTH-FIX 2026-07-21: `export =` 让 barrel (resource/index.ts) 直接
 * `require('./types')` 解构得到 9 个 named 导出。
 */

/**
 * 加载语义枚举
 */
const LoadingSemantics = {
  DEFAULT: 'default', // @ - AI自行决定加载时机
  HOT_LOAD: 'hot_load', // @! - 立即加载
  LAZY_LOAD: 'lazy_load', // @? - 懒加载
} as const

/**
 * 解析后的资源引用
 */
class ParsedReference {
  public loadingSemantics: string = LoadingSemantics.DEFAULT
  public protocol: string = ''
  public path: string = ''
  public queryParams: QueryParams = new QueryParams()
  public isNested: boolean = false
  public nestedRef: NestedReference | null = null
  public originalRef: string = ''
}

/**
 * 查询参数
 */
class QueryParams {
  public line: string | null = null
  public format: string | null = null
  public cache: boolean | null = null
  public params: Map<string, string> = new Map()

  set(key: string, value: string | boolean): void {
    if (key === 'line' || key === 'format' || key === 'cache') {
      this[key] = value as never
    } else {
      this.params.set(key, String(value))
    }
  }

  get(key: string): string | boolean | null | undefined {
    if (key === 'line' || key === 'format' || key === 'cache') {
      return this[key]
    }
    return this.params.get(key)
  }

  getAll(): Record<string, string | boolean | null> {
    const result: Record<string, string | boolean | null> = {}

    if (this.line !== null) result.line = this.line
    if (this.format !== null) result.format = this.format
    if (this.cache !== null) result.cache = this.cache

    for (const [key, value] of this.params) {
      result[key] = value
    }

    return result
  }

  toString(): string {
    const params: string[] = []

    if (this.line !== null) params.push(`line=${this.line}`)
    if (this.format !== null) params.push(`format=${this.format}`)
    if (this.cache !== null) params.push(`cache=${this.cache}`)

    const sortedParams = Array.from(this.params.entries()).sort()
    for (const [key, value] of sortedParams) {
      params.push(`${key}=${value}`)
    }

    return params.join('&')
  }
}

/**
 * 嵌套引用
 */
class NestedReference {
  public outer: ParsedReference | null = null
  public inner: ParsedReference | null = null
  public depth: number = 0
}

/**
 * 资源内容
 */
class ResourceContent {
  public path: string
  public content: string
  public metadata: Record<string, unknown>
  public relativePath: string = ''
  public lastModified: Date | null = null
  public size: number

  constructor(path: string, content: string, metadata: Record<string, unknown> = {}) {
    this.path = path
    this.content = content
    this.metadata = metadata
    this.size = content ? content.length : 0
  }
}

/**
 * 懒加载资源
 */
class LazyResource {
  public path: string
  public loader: (path: string) => Promise<string>
  public loaded: boolean = false
  public _content: string | null = null

  constructor(path: string, loader: (path: string) => Promise<string>) {
    this.path = path
    this.loader = loader
  }

  async load(): Promise<string> {
    if (!this.loaded) {
      this._content = await this.loader(this.path)
      this.loaded = true
    }
    return this._content ?? ''
  }
}

/**
 * 处理后的结果
 */
class ProcessedResult {
  public content: string = ''
  public metadata: Record<string, unknown> = {}
  public format: string = 'text'
  public sources: string[] = []
  public cached: boolean = false
}

/**
 * 最终资源结果
 */
class ResourceResult {
  public content: string = ''
  public metadata: Record<string, unknown> = {}
  public sources: string[] = []
  public format: string = 'text'
  public cached: boolean = false
  public loadTime: number = Date.now()
  public success: boolean = true
  public error: Error | null = null

  static success(content: string, metadata: Record<string, unknown> = {}): ResourceResult {
    const result = new ResourceResult()
    result.content = content
    result.metadata = metadata
    result.success = true
    return result
  }

  static error(error: Error, metadata: Record<string, unknown> = {}): ResourceResult {
    const result = new ResourceResult()
    result.success = false
    result.error = error
    result.metadata = metadata
    return result
  }
}

/**
 * 资源协议信息
 */
class ProtocolInfo {
  public name: string = ''
  public description: string = ''
  public location: string = ''
  public params: Record<string, string> = {}
  public registry: Map<string, string> = new Map()
}

export = {
  LoadingSemantics,
  ParsedReference,
  QueryParams,
  NestedReference,
  ResourceContent,
  LazyResource,
  ProcessedResult,
  ResourceResult,
  ProtocolInfo,
}