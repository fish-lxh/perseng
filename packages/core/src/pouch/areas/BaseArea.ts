/**
 * BaseArea - Area 架构的抽象基类
 *
 * 设计原则：
 * 1. 单一职责：每个 Area 只负责渲染自己的内容块
 * 2. 开闭原则：通过继承扩展新 Area 类型，不修改基类
 * 3. 依赖倒置：Command 依赖 Area 抽象，不依赖具体实现
 *
 * 不变式：
 * - validate() = true ⟹ render() 不抛异常
 * - 每个 Area 有唯一的 name 标识
 * - render() 返回的内容是自包含的
 *
 * P0 step 0B.4.2: 迁 .js → .ts, BaseArea 是所有 Area 的共同基类
 */

export interface BaseAreaOptions {
  [key: string]: unknown
}

export interface BaseAreaMetadata {
  name: string
  type: string
  options: BaseAreaOptions
  [key: string]: unknown
}

export class BaseArea {
  readonly name: string
  readonly options: BaseAreaOptions
  protected separator: string

  /**
   * @param name Area 的唯一标识名
   * @param options 配置选项
   */
  constructor(name: string, options: BaseAreaOptions = {}) {
    if (!name) {
      throw new Error('Area name is required')
    }

    this.name = name
    this.options = options
    this.separator = '-'.repeat(50)
  }

  /**
   * 获取 Area 名称
   */
  getName(): string {
    return this.name
  }

  /**
   * 验证 Area 是否可以渲染
   */
  validate(): boolean {
    return true
  }

  /**
   * 渲染 Area 内容
   * 子类必须实现此方法
   */
  async render(): Promise<string> {
    throw new Error(`Area '${this.name}' must implement render() method`)
  }

  /**
   * 格式化 Area 输出
   * @param content Area 内容
   * @param withHeader 是否包含 header
   */
  format(content: string, withHeader: boolean = true): string {
    if (!content) return ''

    if (withHeader) {
      return `${this.separator}
[${this.name.toUpperCase()}]
${content}
`
    }

    return content
  }

  /**
   * 获取 Area 元信息
   */
  getMetadata(): BaseAreaMetadata {
    return {
      name: this.name,
      type: this.constructor.name,
      options: this.options,
    }
  }
}

export default BaseArea
