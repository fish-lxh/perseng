/**
 * Anchor - 认知状态锚定器
 *
 * ## 设计理念
 *
 * Anchor负责将当前的认知状态"锚定"（固定）下来，
 * 供下次Prime时恢复，实现意识的连续性。
 *
 * 这就像睡前的最后一个念头，会成为醒来时的第一个念头。
 *
 * ## 认知心理学背景
 *
 * - **State Capture**: 捕获当前工作记忆状态
 * - **Context Preservation**: 保存认知上下文
 * - **Retrieval Cue Persistence**: 持久化提取线索
 *
 * ## 与其他组件的关系
 *
 * - **Recall**: 激活网络，产生Mind
 * - **Anchor**: 锚定Mind状态到State.json
 * - **Prime**: 从State.json恢复上次的认知状态
 *
 * @class Anchor
 */
import fs from 'fs/promises'
import path from 'path'
import { info, error as logErr, debug as logDebug } from '@promptx/logger'
import { Mind, MindConnection } from './Mind'

/**
 * KNUTH-NOTE: Anchor 在 Layer 0 不能依赖 Network（Layer 1）。
 * 仅声明 Anchor 用到的字段；roleId / directory 由 CognitionManager 注入。
 */
interface AnchorNetworkLike {
  directory: string
  roleId?: string
}

export interface AnchorStateMetadata {
  nodeCount: number
  connectionCount: number
  anchorVersion: string
}

export interface AnchorState {
  centerWord: string
  timestamp: number
  roleId: string
  activatedCues: string[]
  connections: MindConnection[]
  metadata: AnchorStateMetadata
}

export interface AnchorMetadata {
  centerWord: string
  timestamp: number
  roleId: string
  nodeCount: number
  connectionCount: number
}

export class Anchor {
  /** 认知网络引用 */
  public readonly network: AnchorNetworkLike

  /** 状态文件路径（${network.directory}/state.json） */
  public readonly statePath: string

  constructor(network: AnchorNetworkLike) {
    this.network = network
    this.statePath = path.join(network.directory, 'state.json')

    logDebug('[Anchor] Initialized', {
      roleId: network.roleId,
      statePath: this.statePath,
    })
  }

  /** 将当前认知状态写入 state.json */
  async execute(centerWord: string, mind: Mind): Promise<AnchorState> {
    logDebug('[Anchor] Starting anchor', {
      centerWord,
      mindSize: mind?.activatedCues?.size ?? 0,
    })

    const state: AnchorState = {
      centerWord,
      timestamp: Date.now(),
      roleId: this.network.roleId as string,

      // activatedCues 是 Set<string>，Array.from 直接转
      activatedCues: Array.from(mind.activatedCues),

      connections: mind.connections.map((conn) => ({
        from: conn.from,
        to: conn.to,
        weight: conn.weight,
        ts: conn.ts,
      })),

      metadata: {
        nodeCount: mind.activatedCues.size,
        connectionCount: mind.connections.length,
        anchorVersion: '1.0.0',
      },
    }

    try {
      const dir = path.dirname(this.statePath)
      await fs.mkdir(dir, { recursive: true })

      await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8')

      info('[Anchor] State anchored successfully', {
        centerWord: state.centerWord,
        roleId: state.roleId,
        nodeCount: state.metadata.nodeCount,
        connectionCount: state.metadata.connectionCount,
      })

      return state
    } catch (error) {
      logErr('[Anchor] Failed to anchor state', {
        error: (error as Error).message,
        centerWord,
        roleId: this.network.roleId,
      })
      throw error
    }
  }

  /** 加载锚定的认知状态（不存在时返回 null） */
  async load(): Promise<AnchorState | null> {
    try {
      const exists = await fs
        .access(this.statePath)
        .then(() => true)
        .catch(() => false)

      if (!exists) {
        logDebug('[Anchor] No anchored state found', {
          roleId: this.network.roleId,
        })
        return null
      }

      const content = await fs.readFile(this.statePath, 'utf-8')
      const state = JSON.parse(content) as AnchorState

      info('[Anchor] State loaded successfully', {
        centerWord: state.centerWord,
        roleId: state.roleId,
        nodeCount: state.metadata?.nodeCount,
        timestamp: new Date(state.timestamp).toISOString(),
      })

      return state
    } catch (error) {
      logErr('[Anchor] Failed to load state', {
        error: (error as Error).message,
        roleId: this.network.roleId,
      })
      return null
    }
  }

  /** 删除锚定状态 */
  async clear(): Promise<boolean> {
    try {
      const exists = await fs
        .access(this.statePath)
        .then(() => true)
        .catch(() => false)

      if (exists) {
        await fs.unlink(this.statePath)
        info('[Anchor] State cleared', {
          roleId: this.network.roleId,
        })
        return true
      }

      return false
    } catch (error) {
      logErr('[Anchor] Failed to clear state', {
        error: (error as Error).message,
        roleId: this.network.roleId,
      })
      return false
    }
  }

  /** 获取状态元信息 */
  async getMetadata(): Promise<AnchorMetadata | null> {
    const state = await this.load()
    if (!state) return null

    return {
      centerWord: state.centerWord,
      timestamp: state.timestamp,
      roleId: state.roleId,
      nodeCount: state.metadata?.nodeCount,
      connectionCount: state.metadata?.connectionCount,
    }
  }
}

export default Anchor
