/**
 * BasePouchCommand - 支持Layer和Area双架构的命令基类
 *
 * 架构设计：
 * - 支持新的Layer架构：Command → Layers → Areas
 * - 兼容旧的Area架构：Command → Areas
 * - 统一的渲染管道处理所有内容
 *
 * 渲染流程：
 * 1. 如果有Layers，按优先级渲染Layers
 * 2. 如果没有Layers但有Areas，直接渲染Areas（兼容模式）
 * 3. Layers内部管理自己的Areas
 *
 * P0 step 0B.4.3: 迁 .js → .ts. BaseArea / LegacyArea / BaseLayer 全部 .ts.
 * KNUTH-FIX 0B.4.3: 用 const+require 替代 import, 避免 apps/cli
 * (rootDir=apps/cli/src) 顺着 import 链把 packages/core/src/pouch/* 拉进 program
 * 触发 TS6059. KNUTH-FIX 0B.4.3b: 用本地 interface 描述 base class 表面
 * (而非 typeof import(...)), 避免 type cast 自身触发 TS6059.
 */

import * as logger from '@promptx/logger'

/** BaseArea 构造器类型 (本地 interface, 不引用 import path) */
interface BaseAreaClass {
  new (...args: never[]): BaseAreaInstance
}
interface BaseAreaInstance {
  getName(): string
  validate(): boolean
  render(): Promise<string>
  format(content: string, withHeader?: boolean): string
  getMetadata(): unknown
}
/** BaseLayer 构造器类型 */
interface BaseLayerClass {
  new (...args: never[]): BaseLayerInstance
}
interface BaseLayerInstance {
  getName(): string
  getPriority(): number
  isEnabled(): boolean
  validate(): boolean
  render(context?: unknown): Promise<string>
  getMetadata(): unknown
}
/** LegacyArea 构造器类型 */
interface LegacyAreaClass {
  new (purpose: string, content: string, pateoas: unknown): BaseAreaInstance
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: BaseArea } = require('./areas/BaseArea') as unknown as { default: BaseAreaClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: LegacyArea } = require('./areas/common/LegacyArea') as unknown as { default: LegacyAreaClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: BaseLayer } = require('./layers/BaseLayer') as unknown as { default: BaseLayerClass }

/** Area 鸭子类型（BaseArea 契约 + 允许子类的 const+require 实例） */
export interface AreaLike {
  getName(): string
  validate(): boolean
  render(): Promise<string>
  format(content: string, withHeader?: boolean): string
  getMetadata(): unknown
}

/** Layer 鸭子类型（BaseLayer 契约 + 允许子类的 const+require 实例） */
export interface LayerLike {
  getName(): string
  getPriority(): number
  isEnabled(): boolean
  validate(): boolean
  render(context?: unknown): Promise<string>
  getMetadata(): unknown
}

/** 命令执行上下文 */
export interface CommandContext {
  currentPouch: string
  history: unknown[]
  userProfile: Record<string, unknown>
  sessionData: Record<string, unknown>
  domainContext: Record<string, unknown>
  [key: string]: unknown
}

/** 输出格式 */
export type OutputFormat = 'human' | 'json'

/** legacy 兼容模式契约（子类可选实现） */
export interface LegacyCommandShape {
  getPurpose?(): string
  getContent?(args: unknown[]): Promise<string>
  getPATEOAS?(args: unknown[]): unknown
}

/** BasePouchCommand */
export class BasePouchCommand {
  context: CommandContext
  outputFormat: OutputFormat
  areas: AreaLike[]
  layers: LayerLike[]
  useLayerSystem: boolean

  constructor() {
    this.context = {
      currentPouch: '',
      history: [],
      userProfile: {},
      sessionData: {},
      domainContext: {},
    }
    this.outputFormat = 'human'
    this.areas = []
    this.layers = []
    this.useLayerSystem = false // 标记是否使用Layer系统
  }

  /**
   * 注册一个Area
   * @param area Area实例
   */
  registerArea(area: BaseAreaInstance): void {
    // 运行时 instanceof 检查（保留语义：必须 extends BaseArea）
    if (!(area instanceof BaseArea)) {
      throw new Error('Area must extend BaseArea')
    }

    // 检查名称唯一性
    if (this.areas.some((a) => a.getName() === area.getName())) {
      throw new Error(`Area with name '${area.getName()}' already registered`)
    }

    this.areas.push(area as unknown as AreaLike)
  }

  /**
   * 清空所有Areas
   */
  clearAreas(): void {
    this.areas = []
  }

  /**
   * 注册一个Layer
   * @param layer Layer实例
   */
  registerLayer(layer: BaseLayerInstance): void {
    // 运行时 instanceof 检查
    if (!(layer instanceof BaseLayer)) {
      throw new Error('Layer must extend BaseLayer')
    }

    // 检查名称唯一性
    if (this.layers.some((l) => l.getName() === layer.getName())) {
      throw new Error(`Layer with name '${layer.getName()}' already registered`)
    }

    this.layers.push(layer as unknown as LayerLike)
    this.useLayerSystem = true // 标记使用Layer系统

    logger.debug(`[BasePouchCommand] Registered layer: ${layer.getName()}`)
  }

  /**
   * 清空所有Layers
   */
  clearLayers(): void {
    this.layers = []
    this.useLayerSystem = false
  }

  /**
   * 组装Areas（子类可重写）
   * @param args 命令参数
   */
  async assembleAreas(args: unknown[] = []): Promise<void> {
    // KNUTH-FIX 0B.4.3: instanceof check
    const self = this as unknown as LegacyCommandShape
    // 检查是否有旧的getPurpose/getContent方法
    if (typeof self.getPurpose === 'function' && typeof self.getContent === 'function') {
      // 兼容模式：使用LegacyArea包装旧命令
      const purpose = self.getPurpose() ?? ''
      const content = await self.getContent(args)
      // KNUTH-FIX 0B.4.3: PATEOAS 由子类自己保证形状 (BasePouchCommand 不强约束),
      // cast 到 LegacyArea 构造器第 3 参数类型 (LegacyPateoas | null)
      // KNUTH-FIX 0B.4.3b: typeof LegacyArea 是 class (constructor), 用 ConstructorParameters
      type LegacyPateoasArg = ConstructorParameters<typeof LegacyArea>[2]
      const pateoas: LegacyPateoasArg = typeof self.getPATEOAS === 'function'
        ? (self.getPATEOAS(args) as LegacyPateoasArg)
        : (null as LegacyPateoasArg)

      const legacyArea = new LegacyArea(purpose, content, pateoas)
      this.registerArea(legacyArea)
    } else {
      // 新架构的命令必须自己实现assembleAreas
      throw new Error('Subclass must implement assembleAreas() or provide getPurpose()/getContent()')
    }
  }

  /**
   * 组装Layers（子类可重写）
   * @param args 命令参数
   */
  async assembleLayers(_args: unknown[] = []): Promise<void> {
    // 子类实现具体的Layer组装逻辑
    // 默认不做任何操作
  }

  /**
   * 验证所有Areas
   */
  validateAreas(): boolean {
    return this.areas.every((area) => area.validate())
  }

  /**
   * 验证所有Layers
   */
  validateLayers(): boolean {
    return this.layers.every((layer) => layer.validate())
  }

  /**
   * 渲染所有Areas
   */
  async renderAreas(): Promise<string> {
    const contents: string[] = []

    for (const area of this.areas) {
      const content = await area.render()
      if (content) {
        contents.push(area.format(content))
      }
    }

    return contents.join('')
  }

  /**
   * 渲染所有Layers
   */
  async renderLayers(): Promise<string> {
    // 按优先级排序Layers（数字越小优先级越高）
    const sortedLayers = [...this.layers].sort((a, b) => a.getPriority() - b.getPriority())

    const contents: string[] = []
    const layerSeparator = '='.repeat(75)

    for (let i = 0; i < sortedLayers.length; i++) {
      const layer = sortedLayers[i]
      if (!layer) continue
      if (layer.isEnabled()) {
        const content = await layer.render(this.context)
        if (content) {
          contents.push(content)
          // 在非空Layer之间添加分隔符
          if (i < sortedLayers.length - 1) {
            // 检查是否还有后续的非空Layer
            const hasMoreContent = sortedLayers.slice(i + 1).some((l) => l.isEnabled())
            if (hasMoreContent) {
              contents.push('\n' + layerSeparator + '\n')
            }
          }
        }
      }
    }

    return contents.join('')
  }

  /**
   * 执行命令
   * @param args 命令参数
   */
  async execute(args: unknown[] = []): Promise<unknown> {
    // 清空之前的内容
    this.clearAreas()
    this.clearLayers()

    // 尝试组装Layers（新架构）
    await this.assembleLayers(args)

    // 如果没有Layers，尝试组装Areas（兼容模式）
    if (!this.useLayerSystem) {
      await this.assembleAreas(args)
    }

    let content = ''

    // 使用Layer系统渲染
    if (this.useLayerSystem) {
      logger.debug('[BasePouchCommand] Using Layer system for rendering')

      // 验证Layers
      if (!this.validateLayers()) {
        throw new Error('Layer validation failed')
      }

      // 渲染Layers
      content = await this.renderLayers()
    }
    // 使用传统Area系统渲染
    else {
      logger.debug('[BasePouchCommand] Using Area system for rendering')

      // 验证Areas
      if (!this.validateAreas()) {
        throw new Error('Area validation failed')
      }

      // 渲染Areas
      content = await this.renderAreas()
    }

    // 格式化输出
    return this.formatOutput(content)
  }

  /**
   * 格式化最终输出
   * @param content 渲染的内容
   */
  formatOutput(content: string): unknown {
    if (this.outputFormat === 'json') {
      return {
        content,
        areas: this.areas.map((a) => a.getMetadata()),
        context: this.context,
        format: this.outputFormat,
      }
    }

    // 人类可读格式
    return {
      content,
      context: this.context,
      format: this.outputFormat,
      toString() {
        return content
      },
    }
  }

  /**
   * 设置状态上下文
   * @param context 状态上下文
   */
  setContext(context: Partial<CommandContext>): void {
    this.context = { ...this.context, ...context }
  }

  /**
   * 设置输出格式
   * @param format 输出格式
   */
  setOutputFormat(format: OutputFormat): void {
    this.outputFormat = format
  }
}

export default BasePouchCommand
