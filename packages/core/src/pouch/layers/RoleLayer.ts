/**
 * RoleLayer - 角色层
 *
 * 架构地位：
 * - 三层架构的底层，处理与世界的实际交互
 * - 包含原有系统的所有 Area（RoleArea、StateArea 等）
 * - 定义注意力的边界和交互方式
 *
 * 核心职责：
 * 1. 管理角色相关的所有 Areas
 * 2. 处理角色的具体功能展示
 * 3. 提供与环境交互的接口
 *
 * 设计特点：
 * - 优先级最低（priority=100）
 * - 包含多种类型的 Area
 * - 保持与原有系统的兼容性
 *
 * P0 step 0B.4.1: 迁 .js → .ts. BaseLayer 仍在 .js（0B.4.2 迁）,
 * 用 const+require 模式避免 apps/cli TS6059 rootDir。
 */

import * as logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BaseLayer = require('./BaseLayer') as unknown as new (
  name: string,
  priority: number,
  options?: Record<string, unknown>,
) => {
  assembleAreas(context?: unknown): Promise<void>
  render(context?: unknown): Promise<string>
  validate(): boolean
  getMetadata(): Record<string, unknown>
  registerArea(area: { getName(): string }): void
  areas: Array<{ getName(): string; constructor: { name: string }; format(content: string): string }>
}

/** 上层调用时的 render context 字段 */
export interface RoleRenderContext {
  roleId?: string
  roleInfo?: unknown
  [key: string]: unknown
}

/** 角色层 options（构造时传入） */
export interface RoleLayerOptions {
  roleId?: string | null
  roleInfo?: unknown
  [key: string]: unknown
}

/** Area 鸭子类型（RoleLayer 只在乎 registerArea/getName/format） */
interface AreaLike {
  getName(): string
  constructor: { name: string }
  format(content: string): string
}

export class RoleLayer extends BaseLayer {
  private roleId: string | null
  private roleInfo: unknown

  constructor(options: RoleLayerOptions = {}) {
    super('role', 100, options as Record<string, unknown>) // 最低优先级

    this.roleId = options.roleId || null
    this.roleInfo = options.roleInfo || null
  }

  /**
   * 设置角色上下文
   */
  setRoleContext(roleId: string, roleInfo: unknown = null): void {
    this.roleId = roleId
    this.roleInfo = roleInfo

    logger.debug('[RoleLayer] Role context updated', {
      roleId,
      hasRoleInfo: !!roleInfo,
    })
  }

  /**
   * 组装 Areas
   * 角色层不自动组装 Areas，而是由外部（Command）添加
   * 这保持了与原有系统的兼容性
   */
  async assembleAreas(context: RoleRenderContext = {}): Promise<void> {
    // RoleLayer 的 Areas 由 Command 直接注册
    // 这里可以做一些预处理或验证
    logger.debug('[RoleLayer] Areas assembly delegated to command', {
      currentAreaCount: this.areas.length,
      roleId: context.roleId || this.roleId,
    })
  }

  /**
   * 添加角色相关的 Area
   * 提供便捷方法供 Command 使用
   */
  addRoleArea(area: AreaLike): void {
    this.registerArea(area)
    logger.debug(`[RoleLayer] Added ${area.getName()} area`)
  }

  /**
   * 批量添加 Areas
   */
  addRoleAreas(areas: AreaLike[]): void {
    for (const area of areas) {
      this.addRoleArea(area)
    }
  }

  /**
   * 验证角色层
   */
  validate(): boolean {
    // 角色层可以没有 Areas（某些情况下）
    if (this.areas.length === 0) {
      logger.debug('[RoleLayer] No areas to validate')
      return true
    }

    return super.validate()
  }

  /**
   * 渲染角色层
   */
  async render(context: RoleRenderContext = {}): Promise<string> {
    // 合并 context
    const renderContext: RoleRenderContext = {
      ...context,
      roleId: context.roleId || (this.roleId ?? undefined),
      roleInfo: context.roleInfo || this.roleInfo,
    }

    // 如果没有 Areas，返回空
    if (this.areas.length === 0) {
      logger.debug('[RoleLayer] No areas to render')
      return ''
    }

    return super.render(renderContext)
  }

  /**
   * 格式化 Area 内容
   * 保持原有的格式化方式
   */
  formatAreaContent(area: AreaLike, content: string): string {
    // 使用 Area 自己的格式化
    return area.format(content)
  }

  /**
   * 组合 Area 内容
   * 角色层的 Areas 之间使用短横线分隔
   */
  combineAreaContents(contents: string[]): string {
    if (contents.length <= 1) {
      // 只有一个或没有 Area 时，不需要分隔符
      return contents.join('')
    }
    // 多个 Areas 之间使用短横线分隔
    return contents.join('\n\n')
  }

  /**
   * 渲染前准备
   */
  async beforeRender(context: RoleRenderContext = {}): Promise<void> {
    logger.debug('[RoleLayer] Preparing to render', {
      roleId: context.roleId || this.roleId,
      areaCount: this.areas.length,
      areaTypes: this.areas.map((a) => a.getName()),
    })
  }

  /**
   * 渲染后清理
   */
  async afterRender(_context: RoleRenderContext = {}): Promise<void> {
    logger.debug('[RoleLayer] Render completed')
  }

  /**
   * 获取元信息
   */
  getMetadata(): Record<string, unknown> {
    return {
      ...super.getMetadata(),
      roleId: this.roleId,
      hasRoleInfo: !!this.roleInfo,
      areaTypes: this.areas.map((a) => a.constructor.name),
    }
  }

  /**
   * 检查是否包含特定类型的 Area
   */
  hasAreaType(areaClassName: string): boolean {
    return this.areas.some((area) => area.constructor.name === areaClassName)
  }

  /**
   * 获取特定类型的 Area
   */
  getAreaByType<T extends AreaLike = AreaLike>(areaClassName: string): T | undefined {
    return this.areas.find((area) => area.constructor.name === areaClassName) as T | undefined
  }

  /**
   * 静态工厂方法：创建带基本 Areas 的角色层
   */
  static createWithBasicAreas(
    roleId: string,
    roleArea?: AreaLike,
    stateArea?: AreaLike,
  ): RoleLayer {
    const layer = new RoleLayer({ roleId })

    if (roleArea) {
      layer.addRoleArea(roleArea)
    }

    if (stateArea) {
      layer.addRoleArea(stateArea)
    }

    return layer
  }
}

export default RoleLayer
