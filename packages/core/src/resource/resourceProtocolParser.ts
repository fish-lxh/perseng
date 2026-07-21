/**
 * 资源协议解析器
 * 解析DPML资源引用语法：@protocol://path?params
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace，
 * 旧 .js 消费者 (resourceManager.js) 直接 `require('./resourceProtocolParser')` 当 class 用。
 *
 * KNUTH-NOTE: types.ts 也用 `export =`, 用 import = require() 拿 instance type。
 */
import typesModule = require('./types')

class ResourceProtocolParser {
  public resourceRefRegex: RegExp
  public nestedRefRegex: RegExp
  public queryParamsRegex: RegExp

  constructor() {
    // 资源引用正则表达式
    this.resourceRefRegex = /^(@[!?]?|@)([a-zA-Z][a-zA-Z0-9_-]*):(.+)$/
    this.nestedRefRegex = /^(@[!?]?|@)([a-zA-Z][a-zA-Z0-9_-]*):(@[!?]?|@)?(.+)$/
    this.queryParamsRegex = /^([^?]+)(?:\?(.+))?$/
  }

  /**
   * 解析资源引用
   */
  parse(resourceRef: string): InstanceType<typeof typesModule.ParsedReference> {
    if (!resourceRef || typeof resourceRef !== 'string') {
      throw new Error('Invalid resource reference: must be a non-empty string')
    }

    const trimmedRef = resourceRef.trim()
    if (!this.validateSyntax(trimmedRef)) {
      throw new Error(`Invalid resource reference syntax: ${trimmedRef}`)
    }

    const parsed = new typesModule.ParsedReference()
    parsed.originalRef = trimmedRef

    // 检查是否为嵌套引用
    if (this.isNestedReference(trimmedRef)) {
      return this.parseNestedReference(trimmedRef)
    }

    // 解析基础引用
    return this.parseBasicReference(trimmedRef)
  }

  /**
   * 解析基础资源引用
   */
  parseBasicReference(ref: string): InstanceType<typeof typesModule.ParsedReference> {
    const parsed = new typesModule.ParsedReference()
    parsed.originalRef = ref

    // 解析加载语义
    parsed.loadingSemantics = this.parseLoadingSemantics(ref)

    // 移除加载语义前缀
    const withoutSemantics = this.removeLoadingSemantics(ref)

    // 匹配协议和路径
    const match = withoutSemantics.match(/^([a-zA-Z][a-zA-Z0-9_-]*):(.+)$/)
    if (!match) {
      throw new Error(`Invalid protocol format: ${ref}`)
    }

    parsed.protocol = match[1] ?? ''
    let pathAndParams = match[2] ?? ''

    // 移除 :// 前缀（如果存在）
    if (pathAndParams.startsWith('//')) {
      pathAndParams = pathAndParams.substring(2)
    }

    // 解析路径和查询参数
    const pathMatch = pathAndParams.match(this.queryParamsRegex)
    if (pathMatch) {
      parsed.path = pathMatch[1] ?? ''
      if (pathMatch[2]) {
        parsed.queryParams = this.parseQueryParams(pathMatch[2])
      }
    } else {
      parsed.path = pathAndParams
    }

    return parsed
  }

  /**
   * 解析嵌套引用
   */
  parseNestedReference(ref: string): InstanceType<typeof typesModule.ParsedReference> {
    const parsed = new typesModule.ParsedReference()
    parsed.originalRef = ref
    parsed.isNested = true

    // 解析外层加载语义
    parsed.loadingSemantics = this.parseLoadingSemantics(ref)
    const withoutOuterSemantics = this.removeLoadingSemantics(ref)

    // 匹配嵌套结构: protocol:@inner_protocol://path 或 protocol:inner_protocol://path
    const match = withoutOuterSemantics.match(/^([a-zA-Z][a-zA-Z0-9_-]*):(.+)$/)
    if (!match) {
      throw new Error(`Invalid nested reference format: ${ref}`)
    }

    parsed.protocol = match[1] ?? ''
    let innerRef = match[2] ?? ''

    // 处理内层引用：移除可能的 :// 前缀，但保留 @ 前缀
    if (innerRef.startsWith('//')) {
      innerRef = innerRef.substring(2)
    }

    // 确保内层引用有正确的格式
    if (!innerRef.startsWith('@')) {
      innerRef = '@' + innerRef
    }

    // 递归解析内层引用
    try {
      const innerParsed = this.parse(innerRef)

      // 创建嵌套引用结构
      const nested = new typesModule.NestedReference()
      nested.outer = parsed
      nested.inner = innerParsed
      nested.depth = this.calculateNestingDepth(innerParsed)

      parsed.nestedRef = nested
    } catch (error) {
      throw new Error(`Invalid nested inner reference: ${(error as Error).message}`)
    }

    return parsed
  }

  /**
   * 解析加载语义
   */
  parseLoadingSemantics(ref: string): string {
    if (ref.startsWith('@!')) {
      return typesModule.LoadingSemantics.HOT_LOAD
    } else if (ref.startsWith('@?')) {
      return typesModule.LoadingSemantics.LAZY_LOAD
    } else if (ref.startsWith('@')) {
      return typesModule.LoadingSemantics.DEFAULT
    }

    throw new Error(`Invalid loading semantics: ${ref}`)
  }

  /**
   * 移除加载语义前缀
   */
  removeLoadingSemantics(ref: string): string {
    if (ref.startsWith('@!') || ref.startsWith('@?')) {
      return ref.substring(2)
    } else if (ref.startsWith('@')) {
      return ref.substring(1)
    }
    return ref
  }

  /**
   * 解析查询参数
   */
  parseQueryParams(queryString: string): InstanceType<typeof typesModule.QueryParams> {
    const params = new typesModule.QueryParams()

    if (!queryString) {
      return params
    }

    const pairs = queryString.split('&')
    for (const pair of pairs) {
      const [key, value] = pair.split('=').map(decodeURIComponent)

      if (key) {
        // 处理特殊参数
        if (key === 'cache') {
          params.set(key, value === 'true' || value === '1')
        } else {
          params.set(key, value || '')
        }
      }
    }

    return params
  }

  /**
   * 验证语法
   */
  validateSyntax(ref: string): boolean {
    if (!ref) return false

    // 必须以@开头
    if (!ref.startsWith('@')) return false

    // 基本格式检查
    const withoutSemantics = this.removeLoadingSemantics(ref)
    return /^[a-zA-Z][a-zA-Z0-9_-]*:.+$/.test(withoutSemantics)
  }

  /**
   * 检查是否为嵌套引用
   */
  isNestedReference(ref: string): boolean {
    const withoutSemantics = this.removeLoadingSemantics(ref)
    const colonIndex = withoutSemantics.indexOf(':')

    if (colonIndex === -1) return false

    const afterColon = withoutSemantics.substring(colonIndex + 1)

    // 检查是否包含内层引用 (@protocol: 或 protocol:)
    return afterColon.includes('@') || afterColon.includes('://')
  }

  /**
   * 计算嵌套深度
   */
  calculateNestingDepth(ref: InstanceType<typeof typesModule.ParsedReference>): number {
    if (!ref.isNested) return 1
    if (!ref.nestedRef || !ref.nestedRef.inner) return 1
    return 1 + this.calculateNestingDepth(ref.nestedRef.inner)
  }

  /**
   * 提取协议名
   */
  extractProtocol(ref: string): string {
    const withoutSemantics = this.removeLoadingSemantics(ref)
    const colonIndex = withoutSemantics.indexOf(':')
    return colonIndex > 0 ? withoutSemantics.substring(0, colonIndex) : ''
  }

  /**
   * 提取路径
   */
  extractPath(ref: string): string {
    const withoutSemantics = this.removeLoadingSemantics(ref)
    const colonIndex = withoutSemantics.indexOf(':')
    if (colonIndex === -1) return ''

    let pathAndParams = withoutSemantics.substring(colonIndex + 1)

    // 移除 :// 前缀（如果存在）
    if (pathAndParams.startsWith('//')) {
      pathAndParams = pathAndParams.substring(2)
    }

    const queryIndex = pathAndParams.indexOf('?')
    return queryIndex > 0 ? pathAndParams.substring(0, queryIndex) : pathAndParams
  }

  /**
   * 提取查询参数字符串
   */
  extractParams(ref: string): string {
    const queryIndex = ref.indexOf('?')
    return queryIndex > 0 ? ref.substring(queryIndex + 1) : ''
  }
}

export = ResourceProtocolParser