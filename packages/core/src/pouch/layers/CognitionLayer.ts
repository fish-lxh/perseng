/**
 * CognitionLayer - 认知层
 *
 * 架构地位：
 * - 三层架构的中间层，管理注意力分配系统
 * - 包含 CognitionArea，展示记忆网络和记忆操作
 * - 连接意识层和角色层的桥梁
 *
 * 核心职责：
 * 1. 管理记忆的编码和提取（remember/recall）
 * 2. 展示记忆网络的激活状态
 * 3. 提供认知循环的操作引导
 *
 * 设计特点：
 * - 优先级中等（priority=50）
 * - 包含 CognitionArea 作为主要展示组件
 * - 根据操作类型（prime/recall/remember）动态调整内容
 *
 * P0 step 0B.4.2: 迁 .js → .ts. BaseLayer + CognitionArea 已在 .ts
 */

import { BaseLayer } from './BaseLayer.js'
import type { BaseLayerMetadata } from './BaseLayer.js'
import { CognitionArea, type MindLike, type CognitionMetadata, type CognitionOperation } from '../areas/CognitionArea.js'
import type { BaseArea } from '../areas/BaseArea.js'
import * as logger from '@promptx/logger'

/** CognitionLayer 的 render/assemble context */
export interface CognitionLayerContext {
  operationType?: CognitionOperation
  mind?: MindLike | null
  roleId?: string | null
  metadata?: CognitionMetadata
  [key: string]: unknown
}

/** 构造 options */
export interface CognitionLayerOptions extends CognitionLayerContext {}

export class CognitionLayer extends BaseLayer {
  private operationType: CognitionOperation | null
  private mind: MindLike | null
  private roleId: string | null
  private metadata: CognitionMetadata

  constructor(options: CognitionLayerOptions = {}) {
    super('cognition', 50, options) // 中等优先级

    // 认知层配置
    this.operationType = options.operationType || null // prime | recall | remember | null
    this.mind = options.mind || null // Mind 对象
    this.roleId = options.roleId || null
    this.metadata = options.metadata || {} // 额外信息
  }

  /**
   * 设置认知操作上下文
   */
  setContext(
    operationType: CognitionOperation,
    mind: MindLike | null,
    roleId: string | null,
    metadata: CognitionMetadata = {},
  ): void {
    this.operationType = operationType
    this.mind = mind
    this.roleId = roleId
    this.metadata = metadata

    logger.debug('[CognitionLayer] Context updated', {
      operationType,
      roleId,
      hasMind: !!mind,
      metadata,
    })
  }

  /**
   * 组装 Areas
   */
  async assembleAreas(context: CognitionLayerContext = {}): Promise<void> {
    this.clearAreas()

    // 如果没有认知操作，不创建 Area
    if (!this.operationType) {
      logger.debug('[CognitionLayer] No operation type, skipping area assembly')
      return
    }

    // 从 context 中获取或使用已设置的值
    const operationType = context.operationType || this.operationType
    const mind = context.mind !== undefined ? context.mind : this.mind
    const roleId = context.roleId !== undefined ? context.roleId : this.roleId
    const metadata = { ...this.metadata, ...context.metadata }

    // 创建 CognitionArea
    const cognitionArea = new CognitionArea(
      operationType,
      mind,
      roleId,
      metadata,
    )

    this.registerArea(cognitionArea)

    logger.debug('[CognitionLayer] CognitionArea assembled', {
      operationType,
      roleId,
      hasMind: !!mind,
    })
  }

  /**
   * 验证认知层是否可以渲染
   */
  validate(): boolean {
    // 如果没有操作类型，认知层可以不渲染
    if (!this.operationType && this.areas.length === 0) {
      return true
    }

    return super.validate()
  }

  /**
   * 渲染认知层
   */
  async render(context: CognitionLayerContext = {}): Promise<string> {
    // 合并 context 和已有设置
    const renderContext: CognitionLayerContext = {
      ...context,
      operationType: context.operationType ?? (this.operationType ?? undefined),
      mind: context.mind !== undefined ? context.mind : this.mind,
      roleId: context.roleId !== undefined ? context.roleId : this.roleId,
      metadata: { ...this.metadata, ...context.metadata },
    }

    // 如果没有认知操作，返回空
    if (!renderContext.operationType) {
      return ''
    }

    return super.render(renderContext)
  }

  /**
   * 格式化 Area 内容
   * 认知层的 Area 不需要额外的格式化边框
   */
  override formatAreaContent(_area: BaseArea, content: string): string {
    // CognitionArea 自己管理格式，不需要额外包装
    return content
  }

  /**
   * 渲染前准备
   */
  async beforeRender(context: CognitionLayerContext = {}): Promise<void> {
    logger.debug('[CognitionLayer] Preparing to render', {
      operationType: context.operationType ?? (this.operationType ?? undefined),
      roleId: context.roleId || this.roleId,
    })
  }

  /**
   * 渲染后清理
   */
  async afterRender(_context: CognitionLayerContext = {}): Promise<void> {
    logger.debug('[CognitionLayer] Render completed')
  }

  /**
   * 获取元信息
   */
  override getMetadata(): BaseLayerMetadata {
    return {
      ...super.getMetadata(),
      operationType: this.operationType,
      roleId: this.roleId,
      hasMind: !!this.mind,
      metadata: this.metadata,
    }
  }

  /**
   * 静态工厂方法：创建 Prime 操作的认知层
   */
  static createForPrime(mind: MindLike, roleId: string): CognitionLayer {
    return new CognitionLayer({
      operationType: 'prime',
      mind,
      roleId,
    })
  }

  /**
   * 静态工厂方法：创建 Recall 操作的认知层
   */
  static createForRecall(mind: MindLike, roleId: string, query: string): CognitionLayer {
    return new CognitionLayer({
      operationType: 'recall',
      mind,
      roleId,
      metadata: { query },
    })
  }

  /**
   * 静态工厂方法：创建 Remember 操作的认知层
   */
  static createForRemember(mind: MindLike, roleId: string, engramCount: number): CognitionLayer {
    return new CognitionLayer({
      operationType: 'remember',
      mind,
      roleId,
      metadata: { engramCount },
    })
  }
}

export default CognitionLayer
