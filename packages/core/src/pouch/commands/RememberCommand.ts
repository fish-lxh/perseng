/**
 * 记忆保存命令 - 基于认知体系
 * 使用 CognitionManager 保存角色专属记忆
 * 使用Layer架构组装输出
 *
 * P0 step 0B.4.3: 迁 .js → .ts. BasePouchCommand / CognitionArea / StateArea /
 * CognitionLayer / RoleLayer 已 .ts; resource/ / cognition/CognitionManager 仍 .js.
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
// KNUTH-FEAT 2026-07-11: Phase 3 cast 清理 — CognitionManager 真实 .d.ts 已生成。
// KNUTH-FIX 2026-07-22: CognitionManager 双导出 (class + default)，tsup cjsInterop
// 把整个 exports 对象包成 `{ CognitionManager, default }`，需要解构具名导出才能拿到 class。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CognitionManager } = require('../../cognition/CognitionManager') as {
  CognitionManager: CognitionManagerLike
}

/** ResourceManager 鸭子类型 */
interface ResourceManagerLike {
  [key: string]: unknown
}

/** Mind 对象（来自 CognitionManager.prime） */
// KNUTH-FIX 0B.4.3: engrams 必须是 Engram[] 才能 assign 给 CognitionLayer.createForRemember
export type MindLike = CognitionMindLike & {
  activatedCues: { size: number }
  engrams?: Engram[]
}

/** CognitionManager 鸭子类型 */
interface CognitionManagerLike {
  getInstance(resourceManager: ResourceManagerLike): CognitionManagerLike
  remember(role: string, engrams: Engram[]): Promise<unknown>
  prime(role: string): Promise<MindLike | null>
  [key: string]: unknown
}

/** RolexBridge 鸭子类型 */
interface RolexBridgeLike {
  isV2Role(roleId: string): Promise<boolean>
}

/** Remember 参数 */
interface RememberArgs {
  role: string
  engrams: Engram[]
}

export class RememberCommand extends BasePouchCommand {
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
    // 解析参数：role 和 engrams数组
    const { role, engrams } = this.parseArgs(args)

    if (!role || !engrams) {
      // 错误情况：只创建角色层显示错误
      const roleLayer = new RoleLayer()
      roleLayer.addRoleArea(
        new StateArea('error: 缺少必填参数', [this.getUsageHelp()]),
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
          new StateArea('error: V2 角色不支持 remember 命令', [
            'V2 角色使用 RoleX 记忆系统，请使用以下命令：',
            '- reflect: 反思经历并形成经验',
            '- realize: 从经验中掌握原则',
            '- master: 掌握程序/技能',
            '',
            '传统的 remember/recall 命令仅适用于 V1 角色',
          ]),
        )
        this.registerLayer(roleLayer)
        return
      }
    } catch (error) {
      logger.warn('[RememberCommand] Failed to check V2 role:', error as Error)
      // 如果检查失败，继续执行（向后兼容）
    }

    try {
      logger.info('🧠 [RememberCommand] 开始批量记忆保存流程')
      logger.info(` [RememberCommand] 批量保存 ${engrams.length} 个Engram`)

      // 使用 CognitionManager 批量保存记忆
      await this.cognitionManager.remember(role, engrams)
      logger.info(' [RememberCommand] 批量记忆保存完成')

      // 获取更新后的认知网络
      const mind = await this.cognitionManager.prime(role)

      // 设置上下文
      this.context.roleId = role
      this.context.engrams = engrams
      this.context.mind = mind

      // 1. 创建认知层 (最高优先级)
      const cognitionLayer = CognitionLayer.createForRemember(mind, role, engrams.length)
      this.registerLayer(cognitionLayer)

      // 2. 创建角色层 (次优先级)
      const roleLayer = new RoleLayer({ roleId: role })
      // KNUTH-FIX 0B.4.3: 同 RecallCommand, 状态详情保留在 context.
      const stateArea = new StateArea('remember_completed')
      roleLayer.addRoleArea(stateArea)
      this.registerLayer(roleLayer)
    } catch (error) {
      logger.error(` [RememberCommand] 记忆保存失败: ${(error as Error).message}`)
      logger.debug(` [RememberCommand] 错误堆栈: ${(error as Error).stack}`)

      // 错误情况：创建带错误信息的认知层
      const cognitionLayer = CognitionLayer.createForRemember(null, role, 0)
      ;(cognitionLayer as unknown as { metadata: Record<string, unknown> }).metadata.error = (error as Error).message
      this.registerLayer(cognitionLayer)

      // 同时创建角色层显示状态
      const roleLayer = new RoleLayer({ roleId: role })
      roleLayer.addRoleArea(new StateArea('remember_failed'))
      this.registerLayer(roleLayer)
    }
  }

  /**
   * 解析命令参数
   */
  parseArgs(args: unknown[] = []): RememberArgs {
    if (!args || args.length === 0) {
      return { role: '', engrams: [] }
    }

    // 如果第一个参数是对象（从MCP工具调用）
    if (typeof args[0] === 'object' && args[0] !== null) {
      const first = args[0] as Partial<RememberArgs>
      return {
        role: first.role ?? '',
        engrams: first.engrams ?? [],
      }
    }

    // 命令行格式暂不支持
    return { role: '', engrams: [] }
  }

  /**
   * 获取使用帮助
   */
  getUsageHelp(): string {
    return `❌ 错误：缺少必填参数

🎯 **使用方法**：
remember 工具需要两个参数：
1. role - 角色ID
2. engrams - 记忆数组

📋 **Engram结构**：
{
  content: "要记住的内容",
  schema: "知识结构（用缩进表示层级）",
  strength: 0.8,  // 0-1之间，表示重要程度
  type: "ATOMIC"  // ATOMIC|LINK|PATTERN
}

💡 **记忆类型说明**：
- ATOMIC: 原子概念（名词、定义）
- LINK: 关联关系（动词、连接）
- PATTERN: 行为模式（流程、方法）`
  }
}

export default RememberCommand
