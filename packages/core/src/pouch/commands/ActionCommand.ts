/**
 * ActionCommand - 角色激活命令
 * 专注于角色激活和提示词展示，不进行记忆加载
 * 记忆探索由 AI 通过 recall 工具主动进行
 *
 * P0 step 0B.4.3: 迁 .js → .ts.
 * - BasePouchCommand / RoleArea / StateArea / RoleLayer 全部 .ts
 * - ~/constants / resource/ / dpml/ / project/ProjectManager 仍 .js, 走 const+require
 */

import { BasePouchCommand } from '../BasePouchCommand.js'
import { RoleArea, type SectionFilter } from '../areas/action/RoleArea.js'
import { StateArea } from '../areas/common/StateArea.js'
import { RoleLayer } from '../layers/RoleLayer.js'
import * as logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalResourceManager } = require('../../resource') as {
  getGlobalResourceManager(): ResourceManagerLike
}
// KNUTH-FIX 2026-07-09: 走具名导出。tsup CJS interop 把模块包成
// { __esModule: true, DPMLContentParser: class }，原代码 `new require(...)` 会报
// "DPMLContentParser2 is not a constructor"。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DPMLContentParser = (require('../../dpml/DPMLContentParser') as { DPMLContentParser: new () => DPMLParserLike })
  .DPMLContentParser
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SemanticRenderer = (require('../../dpml/SemanticRenderer') as { SemanticRenderer: new () => SemanticRendererLike })
  .SemanticRenderer

/** ResourceManager 鸭子类型（仅 ActionCommand 用到的字段） */
interface ResourceManagerLike {
  initialized: boolean
  initializeWithNewArchitecture(): Promise<void>
  loadResource(url: string): Promise<{
    success: boolean
    content?: string
    metadata?: { title?: string; [k: string]: unknown }
  }>
  [key: string]: unknown
}

/** DPMLContentParser 鸭子类型 */
interface DPMLParserLike {
  parseRoleDocument(content: string): unknown
  [key: string]: unknown
}

/** SemanticRenderer 鸭子类型（RoleArea 契约） */
interface SemanticRendererLike {
  renderSemanticContent(content: unknown, resourceManager: ResourceManagerLike): Promise<string>
  [key: string]: unknown
}

/** KNUTH-FEAT 2026-07-10: 角色未找到时的结构化错误。入口层（actAs / MCP action）应据此返回 isError。 */
export class RoleNotFoundError extends Error {
  public readonly roleId: string
  public readonly available: string[]
  constructor(roleId: string, available: string[] = []) {
    super(`角色 '${roleId}' 不存在。可用角色: ${available.join(', ') || '(无)'}`)
    this.name = 'RoleNotFoundError'
    this.roleId = roleId
    this.available = available
  }
}

/** 角色信息（ActionCommand 组装后传给 RoleArea） */
interface RoleInfo {
  id: string
  semantics: {
    personality?: unknown
    principle?: unknown
    knowledge?: unknown
    [key: string]: unknown
  }
  metadata: { title?: string; [key: string]: unknown }
}

/** 分析后的角色依赖 */
interface RoleDependencies {
  thoughts: unknown[]
  executions: unknown[]
  knowledges: unknown[]
}

/** 资源引用 */
interface ResourceReference {
  protocol: string
  resource: string
}

export class ActionCommand extends BasePouchCommand {
  private resourceManager: ResourceManagerLike
  private dpmlParser: DPMLParserLike
  private semanticRenderer: SemanticRendererLike

  constructor() {
    super()
    this.resourceManager = getGlobalResourceManager()
    this.dpmlParser = new DPMLContentParser()
    this.semanticRenderer = new SemanticRenderer()
  }

  /**
   * 组装Layers - 使用新的三层架构
   */
  async assembleLayers(args: unknown[] = []): Promise<void> {
    const [roleId, sectionFilter] = args as [string?, SectionFilter?]

    if (!roleId) {
      // 错误情况：只创建角色层显示错误
      const roleLayer = new RoleLayer()
      roleLayer.addRoleArea(
        new StateArea('error', [
          '使用 MCP Perseng 工具的 action 功能激活角色',
          '使用 MCP Perseng 工具的 discover 功能查看可用角色',
        ]),
      )
      this.registerLayer(roleLayer)
      return
    }

    try {
      logger.debug(`[ActionCommand] Starting to activate role: ${roleId}`)

      // 初始化 ResourceManager
      if (!this.resourceManager.initialized) {
        await this.resourceManager.initializeWithNewArchitecture()
      }

      // 获取角色信息
      const roleInfo = await this.getRoleInfo(roleId)
      // KNUTH-FIX 0B.4.3: logger.debug 第二参只接 object|string, roleInfo 可能为 null
      logger.debug(`[ActionCommand] getRoleInfo result:`, roleInfo ?? '(null)')

      if (!roleInfo) {
        logger.warn(`[ActionCommand] Role "${roleId}" does not exist!`)
        const roleLayer = new RoleLayer()
        roleLayer.addRoleArea(
          new StateArea(`error: 角色 "${roleId}" 不存在`, [
            '使用 discover 功能查看所有可用角色',
            '使用正确的角色ID重试',
          ]),
        )
        this.registerLayer(roleLayer)
        return
      }

      // 分析角色依赖（根据 sectionFilter 过滤）
      const dependencies = await this.analyzeRoleDependencies(roleInfo, sectionFilter)

      // 设置上下文
      this.context.roleId = roleId
      this.context.roleInfo = roleInfo

      // 创建角色层
      const roleLayer = new RoleLayer({ roleId, roleInfo })

      // 添加角色区域
      const roleArea = new RoleArea(
        roleId,
        roleInfo.semantics,
        this.semanticRenderer,
        this.resourceManager,
        dependencies.thoughts,
        dependencies.executions,
        (roleInfo.metadata && roleInfo.metadata.title) || roleId,
        sectionFilter,
      )
      roleLayer.addRoleArea(roleArea)

      // 添加状态区域
      const stateArea = new StateArea('role_activated')
      roleLayer.addRoleArea(stateArea)

      this.registerLayer(roleLayer)
    } catch (error) {
      logger.error('Action command error:', error as Error)
      const roleLayer = new RoleLayer()
      roleLayer.addRoleArea(
        new StateArea(`error: ${(error as Error).message}`, [
          '查看可用角色：使用 discover 功能',
          '确认角色名称后重试',
        ]),
      )
      this.registerLayer(roleLayer)
    }
  }

  /**
   * 获取角色信息
   *
   * KNUTH-FEAT 2026-07-10: 失败路径改为抛 RoleNotFoundError，不再返回 null。
   * 内容契约 M3 不变量 I-1：未知 id 必须显式失败，绝不返回"假身份"。
   * 上游调用方（ActionCommand.assembleLayers、MCP action tool、CLI action）据此
   * 把错误传播出去，AI 客户端就能看到 isError 而不是 success+错误文本。
   */
  async getRoleInfo(roleId: string): Promise<RoleInfo> {
    logger.debug(`[ActionCommand] getRoleInfo called, role ID: ${roleId}`)

    let result
    try {
      logger.debug(`[ActionCommand] ResourceManager state before loadResource call:`, {
        initialized: this.resourceManager.initialized,
      })

      result = await this.resourceManager.loadResource(`@role://${roleId}`)
    } catch (error) {
      // loadResource 内部已 swallow error 进 {success:false, error}，
      // 走到这里说明 ResourceManager 自身抛了（极少见）。重抛以便上层感知。
      logger.error(`[ActionCommand] loadResource threw:`, error as Error)
      const available = this._safeListRoleIds()
      throw new RoleNotFoundError(roleId, available)
    }

    logger.debug(`[ActionCommand] loadResource returned:`, result)

    if (!result || !result.success) {
      logger.warn(`[ActionCommand] Role resource not found: @role://${roleId}`)
      const available = this._safeListRoleIds()
      throw new RoleNotFoundError(roleId, available)
    }

    const content = result.content
    if (!content) {
      logger.warn(`[ActionCommand] Role resource content is empty: @role://${roleId}`)
      const available = this._safeListRoleIds()
      throw new RoleNotFoundError(roleId, available)
    }

    const parsed = this.dpmlParser.parseRoleDocument(content)
    return {
      id: roleId,
      semantics: parsed as RoleInfo['semantics'],
      metadata: result.metadata || {},
    }
  }

  /** 列出注册表中所有 role id，失败时返回空数组（不让 list 错误掩盖主错误） */
  private _safeListRoleIds(): string[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rm = this.resourceManager as any
      const registryData = rm.registryData
      if (!registryData || typeof registryData.getResourcesByProtocol !== 'function') return []
      return registryData.getResourcesByProtocol('role').map((r: { id: string }) => r.id)
    } catch {
      return []
    }
  }

  /**
   * 分析角色依赖
   */
  async analyzeRoleDependencies(roleInfo: RoleInfo, sectionFilter?: SectionFilter): Promise<RoleDependencies> {
    const dependencies: RoleDependencies = {
      thoughts: [],
      executions: [],
      knowledges: [],
    }

    if (!roleInfo || !roleInfo.semantics) {
      return dependencies
    }

    // Determine which sections to load based on sectionFilter
    // Default (undefined): personality only
    const loadPersonality = !sectionFilter || sectionFilter === 'personality' || sectionFilter === 'all'
    const loadPrinciple = sectionFilter === 'principle' || sectionFilter === 'all'
    const loadKnowledge = sectionFilter === 'knowledge' || sectionFilter === 'all'

    const extractReferences = (component: unknown): ResourceReference[] => {
      const refs: ResourceReference[] = []
      if (!component) return refs

      const extractFromNode = (node: unknown): void => {
        if (typeof node === 'string') {
          const matches = node.matchAll(/<reference[^>]*protocol="([^"]+)"[^>]*resource="([^"]+)"[^>]*>/g)
          for (const match of matches) {
            refs.push({
              protocol: match[1] ?? '',
              resource: match[2] ?? '',
            })
          }
        } else if (Array.isArray(node)) {
          node.forEach(extractFromNode)
        } else if (typeof node === 'object' && node !== null) {
          Object.values(node).forEach(extractFromNode)
        }
      }

      extractFromNode(component)
      return refs
    }

    // 提取所有引用（根据 sectionFilter 过滤）
    const allRefs: ResourceReference[] = [
      ...(loadPersonality ? extractReferences(roleInfo.semantics.personality) : []),
      ...(loadPrinciple ? extractReferences(roleInfo.semantics.principle) : []),
      ...(loadKnowledge ? extractReferences(roleInfo.semantics.knowledge) : []),
    ]

    // 分类并加载资源
    for (const ref of allRefs) {
      try {
        const resourceUrl = `@${ref.protocol}://${ref.resource}`
        const result = await this.resourceManager.loadResource(resourceUrl)

        if (result && result.success) {
          const content = result.content
          if (ref.protocol === 'thought') {
            dependencies.thoughts.push(content)
          } else if (ref.protocol === 'execution') {
            dependencies.executions.push(content)
          } else if (ref.protocol === 'knowledge') {
            dependencies.knowledges.push(content)
          }
        }
      } catch (error) {
        logger.warn(`Failed to load reference: @${ref.protocol}://${ref.resource}`, error as Error)
      }
    }

    return dependencies
  }
}

export default ActionCommand
