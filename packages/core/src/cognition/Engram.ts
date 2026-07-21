/**
 * Engram - 记忆痕迹载体
 *
 * ## 设计理念
 *
 * Engram（记忆痕迹）是认知系统中的基本记忆单元，包含了一次认知体验的完整信息。
 * 它贯穿整个认知循环，从AI的感知理解到海马体的存储检索。
 *
 * 在神经科学中，Engram指大脑中存储特定记忆的物理或生化变化。
 * 在我们的系统中，它是连接AI大脑皮层和认知海马体的标准数据结构。
 *
 * ## 康德认识论映射
 *
 * - content = 感性直观（现象界的原始经验）
 * - schema = 知性范畴（概念化的结果）
 * - strength = 实践理性（角色的主观价值判断）
 * - timestamp = 时间形式（内感官的先验形式）
 *
 * ## 为什么需要Engram
 *
 * 1. **数据完整性**
 *    - 保留完整的认知过程信息
 *    - content用于追溯和调试
 *    - schema用于存储和检索
 *
 * 2. **职责分离**
 *    - Engram负责数据承载
 *    - Remember负责处理逻辑
 *    - 清晰的数据与算法分离
 *
 * 3. **时间一致性**
 *    - timestamp在创建时确定
 *    - 避免处理过程中的时间漂移
 *    - 保证批次内的时间统一
 *
 * @class Engram
 */
import { debug as logDebug } from '@promptx/logger'

export type EngramType = 'ATOMIC' | 'LINK' | 'PATTERN'

export const EngramTypes = {
  ATOMIC: 'ATOMIC',
  LINK: 'LINK',
  PATTERN: 'PATTERN',
} as const

export interface EngramParams {
  content: string
  schema: string | string[]
  strength: number
  type: EngramType
  timestamp?: number
}

export interface EngramJSON {
  id: string
  content: string
  schema: string[]
  strength: number
  type: EngramType
  timestamp: number
  /** KNUTH-NOTE: Memory.metadata 列允许承载附加字段（如 role / metadata），返回透传 */
  [k: string]: unknown
}

export class Engram {
  /** 原始经验内容 */
  public readonly content: string

  /** 概念序列 */
  public readonly schema: string[]

  /** 记忆强度 (0-1)，角色视角的主观重要性评分 */
  public readonly strength: number

  /** Engram类型：ATOMIC / LINK / PATTERN */
  public readonly type: EngramType

  /** 时间戳 */
  public readonly timestamp: number

  /** 唯一标识符：${timestamp}_${randomId} */
  public readonly id: string

  constructor({ content, schema, strength, type, timestamp }: EngramParams) {
    if (!content) {
      throw new Error('Engram requires content')
    }
    if (!schema) {
      throw new Error('Engram requires schema')
    }
    if (strength === undefined || strength === null) {
      throw new Error('Engram requires strength')
    }
    if (!type) {
      throw new Error('Engram requires type (ATOMIC, LINK, or PATTERN)')
    }
    if (!['ATOMIC', 'LINK', 'PATTERN'].includes(type)) {
      throw new Error('Engram type must be ATOMIC, LINK, or PATTERN')
    }

    this.content = content
    this.schema = this._normalizeSchema(schema)
    this.strength = this._validateStrength(strength)
    this.type = type
    this.timestamp = timestamp ?? Date.now()
    this.id = `${this.timestamp}_${Math.random().toString(36).substr(2, 9)}`

    logDebug('[Engram] Created new engram', {
      type: this.type,
      schemaLength: this.schema.length,
      strength: this.strength,
      timestamp: new Date(this.timestamp).toISOString(),
    })
  }

  /** schema 标准化（支持 string / string[] 输入，多种分隔符） */
  private _normalizeSchema(schema: string | string[]): string[] {
    if (Array.isArray(schema)) {
      return schema.filter((item): item is string => typeof item === 'string' && item.length > 0)
    }

    if (typeof schema === 'string') {
      let items: string[]
      if (schema.includes('\n')) {
        items = schema.split('\n')
      } else if (schema.includes(' - ')) {
        items = schema.split(' - ')
      } else {
        items = schema.split(' ')
      }
      return items.map((s) => s.trim()).filter(Boolean)
    }

    throw new Error('Schema must be a string or array')
  }

  /** strength 校验：必须是 0-1 范围数字 */
  private _validateStrength(strength: number): number {
    const num = Number(strength)
    if (isNaN(num)) {
      throw new Error('Strength must be a number')
    }
    if (num < 0 || num > 1) {
      throw new Error('Strength must be between 0 and 1')
    }
    return num
  }

  /** schema 长度（快速判断可连接性） */
  get length(): number {
    return this.schema.length
  }

  /** 是否有效（schema 至少 2 个元素） */
  isValid(): boolean {
    return this.schema.length >= 2
  }

  /** 获取预览字符串（用于日志调试） */
  getPreview(maxLength: number = 5): string {
    const preview = this.schema.slice(0, maxLength).join(' -> ')
    return this.schema.length > maxLength ? `${preview}...` : preview
  }

  /** 序列化为 JSON 对象 */
  toJSON(): EngramJSON {
    return {
      id: this.id,
      content: this.content,
      schema: this.schema,
      strength: this.strength,
      type: this.type,
      timestamp: this.timestamp,
    }
  }

  /** 从 JSON 反序列化（旧数据若无 type 则默认为 ATOMIC） */
  static fromJSON(json: Partial<EngramJSON> & { content: string; schema: string | string[]; strength: number; type?: EngramType }): Engram {
    const type: EngramType = json.type ?? 'ATOMIC'
    return new Engram({
      content: json.content,
      schema: json.schema,
      strength: json.strength,
      type,
      timestamp: json.timestamp,
    })
  }
}

export default Engram
