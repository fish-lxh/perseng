/**
 * CognitionSystem - 认知系统主控制器
 *
 * ## 设计理念
 *
 * CognitionSystem是整个认知模块的门面（Facade），统一管理所有认知操作。
 * 它协调Network、Remember、Recall、Prime等组件，提供简单的API。
 *
 * ## 为什么这样设计
 *
 * 1. **统一入口**
 *    - 外部只需要与CognitionSystem交互
 *    - 隐藏内部复杂性
 *    - 便于版本升级和重构
 *
 * 2. **生命周期管理**
 *    - 管理Network的创建和销毁
 *    - 协调各操作的执行顺序
 *    - 处理频率更新等统计任务
 *
 * 3. **策略注入**
 *    - 统一的权重策略配置
 *    - 确保Remember和Recall使用相同策略
 *    - 便于切换不同的策略实现
 *
 * ## 架构位置
 *
 * ```
 * 用户代码
 *    ↓
 * CognitionSystem (协调器)
 *    ├── Network (容器)
 *    ├── Remember (写)
 *    ├── Recall (读)
 *    └── Prime (启动)
 * ```
 *
 * @class CognitionSystem
 */
import path from 'path'
import { info as logInfo, debug as logDebug, warn as logWarn, error as logErr } from '@promptx/logger'
import { Network } from './Network'
import { Remember, RememberOptions } from './Remember'
import { Prime } from './Prime'
import { Memory } from './Memory'
import { Engram } from './Engram'
import { TemperatureWeightStrategy } from './WeightStrategy'
import { TwoPhaseRecallStrategy, TwoPhaseRecallOptions } from './TwoPhaseRecallStrategy'
import { Mind } from './Mind'

export interface CognitionSystemOptions {
  dataPath?: string
  strategyOptions?: ConstructorParameters<typeof TemperatureWeightStrategy>[0]
  rememberOptions?: Omit<RememberOptions, 'strategy'>
  recallOptions?: TwoPhaseRecallOptions & { maxActivations?: number; typeWeights?: Record<string, number>; typeQuotas?: Record<string, number>; totalLimit?: number; activationStrategy?: never; weightFactors?: Record<string, number> }
}

export interface LoadedEngramItem {
  id: string
  content: string
  schema: string[] | string
  strength: number
  type: string
  timestamp: number
  activatedBy: string
}

export interface CognitionSystemStatistics {
  network: ReturnType<Network['getStatistics']>
  frequency: ReturnType<Network['getFrequencyStatistics']>
  dataPath: string
  strategy: { type: string; decay: number; frequencyFactor: number }
}

export class CognitionSystem {
  /** 数据持久化路径 */
  public readonly dataPath: string

  /** 全局认知网络 */
  public readonly network: Network

  /** 权重计算策略 */
  public readonly strategy: TemperatureWeightStrategy

  /** Remember引擎配置 */
  public readonly rememberOptions: RememberOptions

  /** Recall引擎配置 */
  public readonly recallOptions: CognitionSystemOptions['recallOptions']

  /** Remember引擎实例（延迟创建） */
  public rememberEngine: Remember | null

  /** Recall引擎实例（延迟创建） */
  public recallEngine: TwoPhaseRecallStrategy | null

  /** Memory存储实例（延迟创建） */
  public memory: Memory | null

  constructor(options: CognitionSystemOptions = {}) {
    this.dataPath = options.dataPath ?? './cognition.json'

    this.network = new Network()

    this.strategy = new TemperatureWeightStrategy({
      decay: 0.9,
      activationThreshold: 0.01,
      frequencyFactor: 0.1,
      temperature: 0.8,
      contrastMode: 'auto',
      ...options.strategyOptions,
    })

    // 让策略能访问network（用于获取频率）
    this.strategy.network = this.network as unknown as NonNullable<TemperatureWeightStrategy['network']>

    this.rememberOptions = {
      ...(options.rememberOptions ?? {}),
      strategy: this.strategy,
    }

    this.recallOptions = options.recallOptions
      ? { ...options.recallOptions }
      : {}

    this.rememberEngine = null
    this.recallEngine = null
    this.memory = null

    logInfo('[CognitionSystem] Initialized', {
      dataPath: this.dataPath,
      strategyType: this.strategy.constructor.name,
    })
  }

  /**
   * 获取Remember引擎（懒加载）
   */
  getRememberEngine(): Remember {
    if (!this.rememberEngine) {
      this.rememberEngine = new Remember(this.network, this.rememberOptions)
    }
    return this.rememberEngine
  }

  /**
   * 获取Recall引擎（懒加载）
   */
  getRecallEngine(): TwoPhaseRecallStrategy {
    if (!this.recallEngine) {
      // 使用新的两阶段召回策略
      const opts = this.recallOptions ?? {}
      this.recallEngine = new TwoPhaseRecallStrategy({
        maxActivations: opts.maxActivations ?? 100,
        typeWeights: opts.typeWeights as never ?? { PATTERN: 2.0, LINK: 1.5, ATOMIC: 1.0 },
        typeQuotas: opts.typeQuotas as never ?? { PATTERN: 10, LINK: 15, ATOMIC: 25 },
        totalLimit: opts.totalLimit ?? 50,
        activationStrategy: opts.activationStrategy as never,
        weightFactors: opts.weightFactors as never,
      })

      // 注入依赖
      this.recallEngine.setDependencies(this.network, this.getMemory())
    }
    return this.recallEngine
  }

  /**
   * 获取Memory存储（懒加载）
   */
  getMemory(): Memory | null {
    if (!this.memory && this.network.directory) {
      const memoryPath = path.join(this.network.directory, 'engrams.db')
      this.memory = new Memory(memoryPath)
    }
    return this.memory
  }

  /**
   * 记忆操作
   */
  async remember(engram: Engram): Promise<ReturnType<Remember['execute']>> {
    logDebug('[CognitionSystem] Remember operation', {
      id: engram.id,
      schemaLength: engram.length,
      strength: engram.strength,
      preview: engram.getPreview(),
    })

    // 存储到Memory（使用engram.id作为key）
    if (this.getMemory()) {
      try {
        await this.getMemory()!.store(engram)
        logDebug('[CognitionSystem] Stored engram to memory', { id: engram.id })
      } catch (error) {
        logErr('[CognitionSystem] Failed to store engram to memory', {
          id: engram.id,
          error: (error as Error).message,
        })
        throw error
      }
    }

    const remember = this.getRememberEngine()
    const result = remember.execute(engram, engram.id)

    // 注意：持久化由CognitionManager.saveSystem()负责
    // 这里不再自动保存，避免路径冲突

    return result
  }

  /**
   * 回忆操作
   */
  async recall(word: string, options: { mode?: string } = {}): Promise<Mind | null> {
    const mode = options.mode ?? 'balanced'
    logDebug('[CognitionSystem] Recall operation', { word, mode })

    // 如果指定了 mode，创建新的引擎实例
    let recallEngine: TwoPhaseRecallStrategy
    if (mode && mode !== 'balanced') {
      recallEngine = new TwoPhaseRecallStrategy({ mode })
      recallEngine.setDependencies(this.network, this.getMemory())
      logInfo('[CognitionSystem] Created recall engine with mode', { mode })
    } else {
      recallEngine = this.getRecallEngine()
    }

    // TwoPhaseRecallStrategy已经在内部处理了engrams的加载和排序
    const mind = await recallEngine.recall(word)

    if (!mind) {
      return null
    }

    // 更新频率
    if (mind.activatedCues.size > 0) {
      this.network.updateRecallFrequency(mind.activatedCues)
      logDebug('[CognitionSystem] Updated frequencies after recall', {
        activatedCount: mind.activatedCues.size,
        engramCount: mind.engrams?.length ?? 0,
      })
    }

    return mind
  }

  /**
   * 加载与查询词直接相关的Engrams
   */
  async loadEngrams(mind: Mind, originalQuery: string): Promise<void> {
    mind.engrams = []

    logInfo('[CognitionSystem] DEBUG - loadEngrams process:', {
      originalQuery,
      networkCuesSize: this.network.cues.size,
      hasMemorySystem: !!this.getMemory(),
      networkCuesKeys: Array.from(this.network.cues.keys()),
    })

    const queryCue = this.network.cues.get(originalQuery)

    logInfo('[CognitionSystem] DEBUG - queryCue lookup:', {
      originalQuery,
      hasQueryCue: !!queryCue,
      queryCueMemories: queryCue?.memories,
      memoriesLength: queryCue?.memories?.size,
    })

    if (queryCue && queryCue.memories) {
      for (const engramId of queryCue.memories) {
        const engramData = await this.getMemory()?.get(engramId)

        logDebug('[CognitionSystem] DEBUG - loading engram:', {
          engramId,
          hasEngramData: !!engramData,
          engramContent: engramData?.content?.substring(0, 50),
        })

        if (engramData) {
          mind.engrams = mind.engrams ?? []
          mind.engrams.push({
            id: engramData.id,
            content: engramData.content,
            schema: engramData.schema,
            strength: engramData.strength,
            type: engramData.type,
            timestamp: engramData.timestamp,
            activatedBy: originalQuery,
          } as unknown as Engram)
        }
      }
    } else {
      logInfo('[CognitionSystem] DEBUG - No engrams loaded - reason:', {
        hasQueryCue: !!queryCue,
        hasMemories: !!queryCue?.memories,
        query: originalQuery,
      })
    }

    logDebug('[CognitionSystem] Loaded engrams', {
      query: originalQuery,
      engramCount: mind.engrams.length,
    })
  }

  /**
   * 启动操作
   */
  async prime(): Promise<Mind | null> {
    logDebug('[CognitionSystem] Prime operation')

    logInfo('[CognitionSystem] Using existing network', {
      cues: this.network.size(),
    })

    const prime = new Prime(this.network)
    const mind = prime.execute()

    if (!mind) {
      logWarn('[CognitionSystem] Prime found no suitable starting point or recall failed')
      return null
    }

    const centerWord = mind.center?.word

    logInfo('[CognitionSystem] Prime completed', {
      activatedNodes: mind.activatedCues?.size ?? 0,
      connections: mind.connections?.length ?? 0,
      centerWord,
    })

    // 加载与prime中心词相关的engrams
    if (this.getMemory() && centerWord) {
      try {
        await this.loadEngrams(mind, centerWord)
        logInfo('[CognitionSystem] Loaded engrams for prime center word', {
          centerWord,
          engramCount: mind.engrams?.length ?? 0,
        })
      } catch (error) {
        logErr('[CognitionSystem] Failed to load engrams for prime', {
          centerWord,
          error: (error as Error).message,
        })
        // 不影响prime的核心功能，继续执行
      }
    }

    // Prime时不更新频率，因为这是系统自动触发的
    return mind
  }

  /**
   * 获取系统统计信息
   */
  getStatistics(): CognitionSystemStatistics {
    const networkStats = this.network.getStatistics()
    const frequencyStats = this.network.getFrequencyStatistics()

    return {
      network: networkStats,
      frequency: frequencyStats,
      dataPath: this.dataPath,
      strategy: {
        type: this.strategy.constructor.name,
        decay: this.strategy.decay,
        frequencyFactor: this.strategy.frequencyFactor ?? 0,
      },
    }
  }

  /**
   * 清空系统
   */
  clear(): void {
    this.network.clear()
    this.rememberEngine = null
    this.recallEngine = null
    logInfo('[CognitionSystem] System cleared')
  }

  /**
   * 手动保存
   */
  save(): void {
    this.network.persistSync(this.dataPath)
    logInfo('[CognitionSystem] Manual save completed')
  }

  /**
   * 手动加载
   */
  load(): void {
    this.network.loadSync(this.dataPath)
    // 重置引擎，因为network变了
    this.rememberEngine = null
    this.recallEngine = null
    logInfo('[CognitionSystem] Manual load completed')
  }
}

export default CognitionSystem
