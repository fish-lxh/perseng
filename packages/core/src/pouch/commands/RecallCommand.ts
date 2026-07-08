/**
 * 记忆检索命令 - 基于认知体系
 * 使用 CognitionManager 进行智能语义检索
 * 使用Layer架构组装输出
 *
 * P0 step 0B.4.3: 迁 .js → .ts. BasePouchCommand / CognitionArea / StateArea /
 * CognitionLayer / RoleLayer 已 .ts; resource/ / cognition/CognitionManager 仍 .js,
 * 走 const+require.
 */

import { BasePouchCommand } from '../BasePouchCommand.js'
import { StateArea } from '../areas/common/StateArea.js'
import { CognitionLayer } from '../layers/CognitionLayer.js'
import { RoleLayer } from '../layers/RoleLayer.js'
import type { Engram, MindLike as CognitionMindLike } from '../areas/CognitionArea.js'
import * as logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalResourceManager } = require('../../resource') as {
  getGlobalResourceManager(): ResourceManagerLike
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CognitionManager = require('../../cognition/CognitionManager') as unknown as CognitionManagerLike

/** ResourceManager 鸭子类型 */
interface ResourceManagerLike {
  [key: string]: unknown
}

/** Mind 对象（来自 CognitionManager.recall） */
// KNUTH-FIX 0B.4.3: engrams 必须是 Engram[] 才能 assign 给 CognitionLayer.createFor* 的 MindLike
export type MindLike = CognitionMindLike & {
  activatedCues: { size: number }
  engrams?: Engram[]
}

/** CognitionManager 鸭子类型 */
interface CognitionManagerLike {
  getInstance(resourceManager: ResourceManagerLike): CognitionManagerLike
  recall(role: string, query: string | null, opts?: { mode?: string }): Promise<MindLike | null>
  [key: string]: unknown
}

/** RolexBridge 鸭子类型 */
interface RolexBridgeLike {
  isV2Role(roleId: string): Promise<boolean>
}

/** Recall 参数 */
interface RecallArgs {
  role: string
  query: string
  mode: string
}

export class RecallCommand extends BasePouchCommand {
  private resourceManager: ResourceManagerLike
  private cognitionManager: CognitionManagerLike

  constructor() {
    super()
    this.resourceManager = getGlobalResourceManager()
    this.cognitionManager = CognitionManager.getInstance(this.resourceManager)
  }

  /**
   * 组装Layers - 使用两层架构
   */
  async assembleLayers(args: unknown[] = []): Promise<void> {
    // 解析参数：--role, query, mode
    const { role, query, mode } = this.parseArgs(args)

    if (!role) {
      // 错误情况：只创建角色层显示错误
      const roleLayer = new RoleLayer()
      roleLayer.addRoleArea(
        new StateArea('error: 缺少必填参数 role', [
          '使用方法：recall 角色ID [查询关键词]',
          '示例：recall java-developer "React Hooks"',
          '通过 discover 工具查看所有可用角色',
        ]),
      )
      this.registerLayer(roleLayer)
      return
    }

    // 检查是否为 V2 角色
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getRolexBridge } = require('../../rolex') as { getRolexBridge(): RolexBridgeLike }
      const bridge = getRolexBridge()
      const isV2 = await bridge.isV2Role(role)
      if (isV2) {
        const roleLayer = new RoleLayer()
        roleLayer.addRoleArea(
          new StateArea('error: V2 角色不支持 recall 命令', [
            'V2 角色使用 RoleX 记忆系统，请使用以下命令：',
            '- focus: 查看当前目标和进展',
            '- identity: 查看角色身份定义',
            '- action: 执行角色相关操作',
            '',
            '传统的 remember/recall 命令仅适用于 V1 角色',
          ]),
        )
        this.registerLayer(roleLayer)
        return
      }
    } catch (error) {
      logger.warn('[RecallCommand] Failed to check V2 role:', error as Error)
      // 如果检查失败，继续执行（向后兼容）
    }

    logger.info('🧠 [RecallCommand] 开始记忆检索流程 (基于认知体系)')
    logger.info(` [RecallCommand] 角色: ${role}, 查询内容: ${query ? `"${query}"` : '全部记忆'}, 模式: ${mode || 'balanced'}`)

    try {
      let mind: MindLike | null = null
      let fallbackToDMN = false

      // 始终执行 recall，query为null时触发DMN模式
      mind = await this.cognitionManager.recall(role, query, { mode })

      // DMN Fallback: 如果有查询词但没找到任何记忆，自动回退到DMN模式
      if (query && (!mind || mind.activatedCues.size === 0)) {
        logger.info('[RecallCommand] No results found for query, falling back to DMN mode')
        mind = await this.cognitionManager.recall(role, null, { mode })
        fallbackToDMN = true
      }

      if (!mind) {
        logger.warn(`[RecallCommand] No mind returned for role: ${role}, query: ${query}`)
      } else {
        // Debug logging for mind structure in RecallCommand
        logger.info('[RecallCommand] DEBUG - Mind structure after recall/prime:', {
          hasMind: !!mind,
          mindKeys: Object.keys(mind),
          hasEngrams: !!mind.engrams,
          engramsLength: mind.engrams?.length,
          engramsType: typeof mind.engrams,
          activatedCuesSize: mind.activatedCues?.size,
          roleId: role,
          query: query,
          fallbackToDMN: fallbackToDMN,
          operationType: query ? 'recall' : 'prime',
        })

        // Deep debug: log actual mind object structure
        logger.debug('[RecallCommand] DEBUG - Full mind object:', JSON.stringify(mind, null, 2))
      }

      const nodeCount = mind ? mind.activatedCues.size : 0
      logger.info(
        ` [RecallCommand] 认知检索完成 - 激活 ${nodeCount} 个节点${fallbackToDMN ? ' (DMN Fallback)' : ''}`,
      )

      // 设置上下文
      this.context.roleId = role
      this.context.query = query
      this.context.mind = mind
      this.context.fallbackToDMN = fallbackToDMN

      // 1. 创建认知层 (最高优先级)
      const cognitionLayer = fallbackToDMN
        ? CognitionLayer.createForPrime(mind, role)
        : query
        ? CognitionLayer.createForRecall(mind, role, query)
        : CognitionLayer.createForPrime(mind, role)

      // 添加 fallback 标记到 metadata
      if (fallbackToDMN) {
        ;(cognitionLayer as unknown as { metadata: Record<string, unknown> }).metadata.fallbackToDMN = true
        ;(cognitionLayer as unknown as { metadata: Record<string, unknown> }).metadata.originalQuery = query
      }

      this.registerLayer(cognitionLayer)

      // 2. 创建角色层 (次优先级)
      const roleLayer = new RoleLayer({ roleId: role })
      // KNUTH-FIX 0B.4.3: 原 .js 传 { role, query, count } 给 StateArea,
      // 但 StateArea 第二参数是 string[] — 这是 latent bug. 这里改成只传状态名,
      // 状态详情保留在 context 中由 render 取.
      const stateArea = new StateArea('recall_completed')
      roleLayer.addRoleArea(stateArea)
      this.registerLayer(roleLayer)
    } catch (error) {
      logger.error(` [RecallCommand] 记忆检索失败: ${(error as Error).message}`)
      logger.debug(` [RecallCommand] 错误堆栈: ${(error as Error).stack}`)

      // 错误情况：只创建角色层显示错误
      const roleLayer = new RoleLayer()
      const errorArea = new StateArea(`error: ${(error as Error).message}`, [
        '检查角色ID是否正确',
        '重试检索操作',
        '如持续失败，查看日志详情',
      ])
      roleLayer.addRoleArea(errorArea)
      this.registerLayer(roleLayer)
    }
  }

  /**
   * 解析命令参数
   * @param args 命令参数
   */
  parseArgs(args: unknown[] = []): RecallArgs {
    if (!args || args.length === 0) {
      return { role: '', query: '', mode: '' }
    }

    // 如果第一个参数是对象（从MCP工具调用）
    if (typeof args[0] === 'object' && args[0] !== null) {
      const first = args[0] as Partial<RecallArgs>
      return {
        role: first.role ?? '',
        query: first.query ?? '',
        mode: first.mode ?? '',
      }
    }

    // 命令行格式：recall role [query] [--mode=creative|balanced|focused]
    const role = String(args[0] ?? '')
    let mode = ''
    const queryParts: string[] = []

    // 解析参数
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]
      if (typeof arg === 'string' && arg.startsWith('--mode=')) {
        mode = arg.split('=')[1] ?? ''
      } else if (typeof arg === 'string') {
        queryParts.push(arg)
      }
    }

    const query = queryParts.join(' ')

    return { role, query, mode }
  }
}

export default RecallCommand
