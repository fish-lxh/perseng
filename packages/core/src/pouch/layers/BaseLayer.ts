/**
 * BaseLayer - Layer 架构的抽象基类
 *
 * 架构设计：
 * - 三层架构：ConsciousnessLayer → CognitionLayer → RoleLayer
 * - 每个 Layer 可包含多个 Area
 * - Layer 负责组织和协调其内部 Areas 的渲染
 *
 * 设计原则：
 * 1. 层次化：Layer 是 Area 的容器，提供更高层次的组织
 * 2. 单一职责：每个 Layer 负责特定的认知层面
 * 3. 组合模式：Layer 组合多个 Area 形成功能单元
 *
 * 不变式：
 * - 每个 Layer 有唯一的 name 和 priority
 * - priority 决定渲染顺序（数字越小优先级越高）
 * - Layer 内的 Areas 按注册顺序渲染
 *
 * P0 step 0B.4.2: 迁 .js → .ts, BaseArea 已在 .ts
 */

import { BaseArea } from '../areas/BaseArea.js'
import type { BaseAreaMetadata } from '../areas/BaseArea.js'

export interface BaseLayerOptions {
  [key: string]: unknown
}

export interface BaseLayerMetadata extends BaseAreaMetadata {
  priority: number
  enabled: boolean
  areaCount: number
  areas: BaseAreaMetadata[]
  [key: string]: unknown
}

export class BaseLayer {
  readonly name: string
  readonly priority: number
  readonly options: BaseLayerOptions
  protected areas: BaseArea[]
  protected enabled: boolean

  /**
   * @param name Layer 的唯一标识名
   * @param priority 渲染优先级（越小越优先）
   * @param options 配置选项
   */
  constructor(name: string, priority: number = 100, options: BaseLayerOptions = {}) {
    if (!name) {
      throw new Error('Layer name is required')
    }

    this.name = name
    this.priority = priority
    this.options = options
    this.areas = []
    this.enabled = true
  }

  /**
   * 获取 Layer 名称
   */
  getName(): string {
    return this.name
  }

  /**
   * 获取渲染优先级
   */
  getPriority(): number {
    return this.priority
  }

  /**
   * 启用/禁用 Layer
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * 检查 Layer 是否启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 注册一个 Area 到该 Layer
   */
  registerArea(area: BaseArea): void {
    if (!(area instanceof BaseArea)) {
      throw new Error('Area must extend BaseArea')
    }

    // 检查名称唯一性
    if (this.areas.some((a) => a.getName() === area.getName())) {
      throw new Error(
        `Area with name '${area.getName()}' already registered in layer '${this.name}'`,
      )
    }

    this.areas.push(area)
  }

  /**
   * 清空所有 Areas
   */
  clearAreas(): void {
    this.areas = []
  }

  /**
   * 获取所有 Areas
   */
  getAreas(): BaseArea[] {
    return this.areas
  }

  /**
   * 组装 Areas（子类可重写）
   * 在渲染前调用，用于动态组装 Areas
   */
  async assembleAreas(_context?: unknown): Promise<void> {
    // 子类实现具体的 Area 组装逻辑
  }

  /**
   * 验证 Layer 是否可以渲染
   */
  validate(): boolean {
    if (!this.enabled) {
      return false
    }

    // 验证所有 Areas
    return this.areas.every((area) => area.validate())
  }

  /**
   * 渲染前的准备工作
   */
  async beforeRender(_context?: unknown): Promise<void> {
    // 子类可重写，用于渲染前的准备
  }

  /**
   * 渲染后的清理工作
   */
  async afterRender(_context?: unknown): Promise<void> {
    // 子类可重写，用于渲染后的清理
  }

  /**
   * 渲染 Layer
   */
  async render(context: unknown = {}): Promise<string> {
    if (!this.enabled) {
      return ''
    }

    // 渲染前准备
    await this.beforeRender(context)

    // 组装 Areas
    await this.assembleAreas(context)

    // 验证
    if (!this.validate()) {
      return ''
    }

    // 渲染所有 Areas
    const contents: string[] = []

    for (const area of this.areas) {
      const content = await area.render()
      if (content) {
        // Layer 可以选择是否使用 Area 的格式化
        const formatted = this.formatAreaContent(area, content)
        if (formatted) {
          contents.push(formatted)
        }
      }
    }

    // 组合 Layer 内容
    const layerContent = this.combineAreaContents(contents)

    // 渲染后清理
    await this.afterRender(context)

    return layerContent
  }

  /**
   * 格式化单个 Area 的内容
   * 子类可重写以自定义格式化方式
   */
  formatAreaContent(area: BaseArea, content: string): string {
    // 默认使用 Area 自己的格式化
    return area.format(content)
  }

  /**
   * 组合所有 Area 的内容
   * 子类可重写以自定义组合方式
   */
  combineAreaContents(contents: string[]): string {
    return contents.join('')
  }

  /**
   * 获取 Layer 元信息
   */
  getMetadata(): BaseLayerMetadata {
    return {
      name: this.name,
      type: this.constructor.name,
      options: this.options,
      priority: this.priority,
      enabled: this.enabled,
      areaCount: this.areas.length,
      areas: this.areas.map((a) => a.getMetadata()),
    }
  }
}

export default BaseLayer
