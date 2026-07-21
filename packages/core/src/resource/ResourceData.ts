/**
 * ResourceData - 单个资源的完整元信息
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式，让 tsup cjsInterop 不包成 namespace，
 * 旧 .js 消费者 (RegistryData.js, FilePatternDiscovery.js, PackageDiscovery.js,
 * UserDiscovery.js) 直接 `require('./ResourceData')` 当 class 用。
 */
import path from 'path'

interface ResourceMetadata {
  createdAt?: string
  updatedAt?: string
  [k: string]: unknown
}

class ResourceData {
  public id: string
  public source: string
  public protocol: string
  public name: string
  public description: string
  public reference: string
  public metadata: ResourceMetadata

  constructor(init: {
    id: string
    source: string
    protocol: string
    name?: string
    description?: string
    reference: string
    metadata?: ResourceMetadata
  }) {
    this.id = init.id
    this.source = init.source
    this.protocol = init.protocol
    this.name = init.name ?? ''
    this.description = init.description ?? ''
    this.reference = init.reference
    this.metadata = {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(init.metadata ?? {}),
    }
  }

  /**
   * 从原始数据创建ResourceData实例
   */
  static fromRawData(rawData: {
    id: string
    source: string
    protocol: string
    name?: string
    description?: string
    reference: string
    metadata?: ResourceMetadata
  }): ResourceData {
    return new ResourceData(rawData)
  }

  /**
   * 从文件路径和协议推断创建ResourceData
   */
  static fromFilePath(filePath: string, source: string, protocol: string, reference: string): ResourceData {
    const fileName = path.basename(filePath, `.${protocol}.md`)

    return new ResourceData({
      id: fileName,
      source,
      protocol,
      name: ResourceData._generateDefaultName(fileName, protocol),
      description: ResourceData._generateDefaultDescription(fileName, protocol),
      reference,
      metadata: {
        inferredFromFile: true,
      },
    })
  }

  /**
   * 生成默认名称
   */
  private static _generateDefaultName(id: string, protocol: string): string {
    const nameMap: Record<string, string> = {
      role: '角色',
      thought: '思维模式',
      execution: '执行模式',
      knowledge: '知识库',
    }

    const readableName = id
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    return `${readableName} ${nameMap[protocol] ?? protocol}`
  }

  /**
   * 生成默认描述
   */
  private static _generateDefaultDescription(_id: string, protocol: string): string {
    const descMap: Record<string, string> = {
      role: '专业角色，提供特定领域的专业能力',
      thought: '思维模式，指导AI的思考方式',
      execution: '执行模式，定义具体的行为模式',
      knowledge: '知识库，提供专业知识和信息',
    }

    return descMap[protocol] ?? `${protocol}类型的资源`
  }

  getFullId(): string {
    const baseId = this.protocol === 'role' ? this.id : `${this.protocol}:${this.id}`
    return `${this.source}:${baseId}`
  }

  getBaseId(): string {
    return this.protocol === 'role' ? this.id : `${this.protocol}:${this.id}`
  }

  matches(filters: Record<string, unknown> = {}): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        const fieldValue = (this as unknown as Record<string, unknown>)[key]
        if (Array.isArray(value)) {
          if (!value.includes(fieldValue as never)) return false
        } else if (fieldValue !== value) {
          return false
        }
      }
    }
    return true
  }

  update(updates: Record<string, unknown>): void {
    Object.assign(this, updates)
    this.metadata.updatedAt = new Date().toISOString()
  }

  toJSON(): {
    id: string
    source: string
    protocol: string
    name: string
    description: string
    reference: string
    metadata: ResourceMetadata
  } {
    return {
      id: this.id,
      source: this.source,
      protocol: this.protocol,
      name: this.name,
      description: this.description,
      reference: this.reference,
      metadata: this.metadata,
    }
  }

  toDisplayFormat(): {
    id: string
    fullId: string
    baseId: string
    name: string
    description: string
    source: string
    protocol: string
  } {
    return {
      id: this.id,
      fullId: this.getFullId(),
      baseId: this.getBaseId(),
      name: this.name,
      description: this.description,
      source: this.source,
      protocol: this.protocol,
    }
  }

  /**
   * 动态获取文件路径
   * 通过解析 reference 动态计算实际的文件路径
   *
   * KNUTH-NOTE: 保留 require 延迟加载 ProtocolResolver，避免循环依赖
   */
  async getFilePath(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ProtocolResolverModule = require('./ProtocolResolver') as { ProtocolResolver: new () => { resolve: (ref: string) => Promise<string> } }
    const ProtocolResolver = ProtocolResolverModule.ProtocolResolver
    const resolver = new ProtocolResolver()

    try {
      const resolvedPath = await resolver.resolve(this.reference)
      return resolvedPath
    } catch (error) {
      throw new Error(`无法解析资源路径 ${this.reference}: ${(error as Error).message}`)
    }
  }

  clone(): ResourceData {
    return new ResourceData(this.toJSON())
  }
}

export = ResourceData