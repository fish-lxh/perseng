/**
 * CognitionManager - 认知系统管理器
 *
 * 负责管理多个角色的认知系统实例
 * 每个角色都有独立的 CognitionSystem 实例和存储路径
 *
 * 使用单例模式确保内存状态一致性
 *
 * 存储结构：
 * ~/.perseng/cognition/
 *   ├── java-developer/
 *   │   └── mind.json
 *   ├── product-manager/
 *   │   └── mind.json
 *   └── copywriter/
 *       └── mind.json
 */
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { info as logInfo, debug as logDebug, warn as logWarn, error as logErr } from '@promptx/logger'
import { CognitionSystem } from './CognitionSystem'
import { Anchor } from './Anchor'
import { Engram, EngramType } from './Engram'
import { Mind } from './Mind'

export interface EngramInput {
  content: string
  schema: string | string[]
  strength: number
  type: EngramType
  [k: string]: unknown
}

export interface CognitionManagerOptions {
  resourceManager?: unknown
}

export class CognitionManager {
  public resourceManager: unknown
  public systems: Map<string, CognitionSystem>
  public basePath: string

  /** 单例实例 */
  static instance: CognitionManager | null = null

  constructor(resourceManager: CognitionManagerOptions['resourceManager'] = null) {
    this.resourceManager = resourceManager
    this.systems = new Map()
    this.basePath = path.join(os.homedir(), '.perseng', 'cognition')
  }

  /**
   * 获取单例实例
   */
  static getInstance(resourceManager: CognitionManagerOptions['resourceManager'] = null): CognitionManager {
    if (!CognitionManager.instance) {
      CognitionManager.instance = new CognitionManager(resourceManager)
      logInfo('[CognitionManager] Created singleton instance')
    }
    return CognitionManager.instance
  }

  /**
   * 获取角色的存储路径
   */
  getRolePath(roleId: string): string {
    return path.join(this.basePath, roleId)
  }

  /**
   * 获取角色的 network.json 文件路径
   */
  getNetworkFilePath(roleId: string): string {
    return path.join(this.getRolePath(roleId), 'network.json')
  }

  /**
   * 确保角色的存储目录存在
   */
  async ensureRoleDirectory(roleId: string): Promise<void> {
    const rolePath = this.getRolePath(roleId)
    try {
      await fs.mkdir(rolePath, { recursive: true })
      logDebug(`[CognitionManager] Ensured directory for role: ${roleId}`)
    } catch (error) {
      logErr(`[CognitionManager] Failed to create directory for role ${roleId}:`, { error: (error as Error).message })
      throw error
    }
  }

  /**
   * 获取或创建角色的认知系统实例
   */
  async getSystem(roleId: string): Promise<CognitionSystem> {
    let system = this.systems.get(roleId)
    if (!system) {
      logInfo(`[CognitionManager] Creating new CognitionSystem for role: ${roleId}`)

      await this.ensureRoleDirectory(roleId)

      system = new CognitionSystem()

      // 为Network添加必要的属性
      system.network.roleId = roleId
      system.network.directory = this.getRolePath(roleId)

      // 尝试加载已有的认知数据
      const networkFilePath = this.getNetworkFilePath(roleId)
      try {
        await system.network.load(networkFilePath)
        logInfo(`[CognitionManager] Loaded existing network data for role: ${roleId}`)
      } catch (error) {
        // 文件不存在或解析失败，使用空的认知系统
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          logWarn(`[CognitionManager] Failed to load network data for role ${roleId}: ${(error as Error).message}`)
        } else {
          logDebug(`[CognitionManager] No existing network data for role: ${roleId}`)
        }
      }

      this.systems.set(roleId, system)
    }

    return system
  }

  /**
   * 保存角色的认知数据
   */
  async saveSystem(roleId: string): Promise<void> {
    const system = this.systems.get(roleId)
    if (!system) {
      logWarn(`[CognitionManager] No system to save for role: ${roleId}`)
      return
    }

    try {
      await this.ensureRoleDirectory(roleId)

      const networkFilePath = this.getNetworkFilePath(roleId)
      await system.network.persist(networkFilePath)

      logInfo(`[CognitionManager] Saved network data for role: ${roleId}`)
    } catch (error) {
      logErr(`[CognitionManager] Failed to save network data for role ${roleId}: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * Prime - 获取角色的认知概览
   * 优先从锚定状态恢复，如果没有则执行常规prime
   */
  async prime(roleId: string): Promise<Mind | null> {
    logInfo(`[CognitionManager] Prime for role: ${roleId}`)

    const system = await this.getSystem(roleId)
    logDebug(`[CognitionManager] System network size before prime: ${system.network.size()}`)

    // 尝试从锚定状态恢复
    const anchor = new Anchor(system.network as unknown as ConstructorParameters<typeof Anchor>[0])
    const anchoredState = await anchor.load()

    let mind: Mind | null = null

    if (anchoredState && anchoredState.centerWord) {
      logInfo(`[CognitionManager] Prime from anchored state`, {
        centerWord: anchoredState.centerWord,
        timestamp: new Date(anchoredState.timestamp).toISOString(),
        nodeCount: anchoredState.metadata?.nodeCount,
      })

      mind = await system.recall(anchoredState.centerWord)

      if (mind) {
        logInfo(`[CognitionManager] Successfully primed from anchored state: "${anchoredState.centerWord}"`)
      }
    }

    // 如果没有锚定状态或恢复失败，执行常规prime
    if (!mind) {
      logDebug(`[CognitionManager] No anchored state or recovery failed, using regular prime`)
      mind = await system.prime()
    }

    if (!mind) {
      logWarn(`[CognitionManager] Prime returned null for role: ${roleId}`)
      return null
    }

    logDebug(`[CognitionManager] Prime returned Mind:`, {
      hasMind: !!mind,
      activatedCuesSize: mind.activatedCues.size,
      connectionsCount: mind.connections.length,
    })

    return mind
  }

  /**
   * Recall - 从角色的认知中检索相关记忆
   */
  async recall(roleId: string, query: string, options: { mode?: string } = {}): Promise<Mind | null> {
    const mode = options.mode ?? 'balanced'
    logInfo(`[CognitionManager] Recall for role: ${roleId}, query: "${query}", mode: ${mode}`)

    const system = await this.getSystem(roleId)

    const mind = await system.recall(query, { mode })

    if (!mind) {
      logWarn(`[CognitionManager] Recall returned null for role: ${roleId}, query: ${query}`)
      return null
    }

    // 自动锚定当前认知状态（仅当recall成功激活了节点）
    if (mind.activatedCues.size > 0) {
      try {
        const anchor = new Anchor(system.network as unknown as ConstructorParameters<typeof Anchor>[0])
        await anchor.execute(query, mind)
        logDebug(`[CognitionManager] Auto-anchored state after recall: "${query}"`, {
          activatedNodes: mind.activatedCues.size,
        })
      } catch (error) {
        logErr(`[CognitionManager] Failed to auto-anchor state: ${(error as Error).message}`)
        // 锚定失败不影响recall结果
      }
    } else {
      logDebug(`[CognitionManager] Skip anchoring - recall returned empty mind`, {
        query,
        hasActivatedCues: mind.activatedCues.size,
      })
    }

    return mind
  }

  /**
   * Remember - 保存新的记忆到角色的认知系统
   */
  async remember(roleId: string, engrams: EngramInput[]): Promise<void> {
    logInfo(`[CognitionManager] Remember for role: ${roleId}, ${engrams.length} engrams`)

    const system = await this.getSystem(roleId)

    for (const engramData of engrams) {
      try {
        const engram = new Engram({
          content: engramData.content,
          schema: engramData.schema,
          strength: engramData.strength,
          type: engramData.type,
          timestamp: Date.now(),
        })

        if (!engram.isValid()) {
          logWarn(`[CognitionManager] Invalid engram (schema too short):`, engramData)
          continue
        }

        await system.remember(engram)

        logDebug(`[CognitionManager] Processed engram:`, {
          preview: engram.getPreview(),
          strength: engram.strength,
        })
      } catch (error) {
        logErr(`[CognitionManager] Failed to process engram: ${(error as Error).message}`)
        // 重新抛出错误，让上层感知到失败
        throw error
      }
    }

    await this.saveSystem(roleId)

    logInfo(`[CognitionManager] Successfully saved ${engrams.length} engrams for role: ${roleId}`)
  }

  /**
   * 解析 schema 字符串为概念列表
   */
  parseSchema(schema: string): string[] {
    if (!schema) return []

    let concepts: string[] = []

    if (schema.includes(' - ')) {
      concepts = schema.split(/\s*-\s*/).filter((c) => c.trim())
    } else if (schema.includes('\n')) {
      const lines = schema.split('\n').filter((line) => line.trim())
      for (const line of lines) {
        const concept = line.trim().replace(/^[-*>#\s]+/, '').trim()
        if (concept) {
          concepts.push(concept)
        }
      }
    } else {
      concepts = schema.split(/\s+/).filter((c) => c.trim())
    }

    return concepts
  }

  /**
   * 清理角色的认知数据
   */
  async clearRole(roleId: string): Promise<void> {
    logWarn(`[CognitionManager] Clearing cognition data for role: ${roleId}`)

    this.systems.delete(roleId)

    try {
      const networkFilePath = this.getNetworkFilePath(roleId)
      await fs.unlink(networkFilePath)
      logInfo(`[CognitionManager] Deleted network file for role: ${roleId}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logErr(`[CognitionManager] Failed to delete network file for role ${roleId}: ${(error as Error).message}`)
      }
    }
  }

  /**
   * 获取所有已存储的角色列表
   */
  async listRoles(): Promise<string[]> {
    try {
      await fs.mkdir(this.basePath, { recursive: true })
      const entries = await fs.readdir(this.basePath, { withFileTypes: true })

      const roles: string[] = []
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const networkFilePath = this.getNetworkFilePath(entry.name)
          try {
            await fs.access(networkFilePath)
            roles.push(entry.name)
          } catch {
            // 没有 network.json 文件，跳过
          }
        }
      }

      return roles
    } catch (error) {
      logErr(`[CognitionManager] Failed to list roles: ${(error as Error).message}`)
      return []
    }
  }
}

export default CognitionManager
