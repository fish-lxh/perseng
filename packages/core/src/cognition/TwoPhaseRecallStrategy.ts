/**
 * TwoPhaseRecallStrategy - 两阶段召回策略
 *
 * ## 设计理念
 * 统一管理召回的两个阶段，提供灵活的配置和扩展能力
 * - 第一阶段（Coarse Recall）：粗召回，快速获取候选集
 * - 第二阶段（Fine Ranking）：精排序，综合权重精确排序
 *
 * ## 设计优势
 * 1. 统一管理：两阶段逻辑集中，便于维护
 * 2. 灵活配置：每个阶段都可以替换策略
 * 3. 性能优化：分阶段处理，逐步精细化
 * 4. 可观测性：每个阶段都有明确的输入输出
 */
import { info as logInfo, debug as logDebug, warn as logWarn, error as logErr } from '@promptx/logger'
import { Mind } from './Mind'
import { ActivationContext } from './ActivationContext'
import { HippocampalActivationStrategy, ActivationStrategy } from './ActivationStrategy'
import { ActivationMode, ActivationModeName } from './ActivationMode'
import { Network } from './Network'
import { Memory } from './Memory'
import { Engram, EngramType } from './Engram'

export interface CoarseRecallConfig {
  activationStrategy: ActivationStrategy
  maxActivations: number
  loadAllEngrams: boolean
}

export interface TypeWeights {
  PATTERN: number
  LINK: number
  ATOMIC: number
}

export interface WeightFactors {
  type: number
  relevance: number
  strength: number
  temporal: number
}

export interface TypeQuotas {
  PATTERN: number
  LINK: number
  ATOMIC: number
}

export interface FineRankingConfig {
  typeWeights: TypeWeights
  weightFactors: WeightFactors
  typeQuotas: TypeQuotas
  totalLimit: number
  temporalDecay: number
}

export interface RankingContext {
  query: string | string[] | null
  activatedCues: Set<string>
  depths: Map<string, number>
  connections: Array<{ from: string; to: string; weight: number; ts: number }>
}

export interface WeightedEngramItem {
  engram: Engram & { activatedBy?: string; [k: string]: unknown }
  weight: number
  scores: {
    typeScore: number
    relevanceScore: number
    strengthScore: number
    temporalScore: number
  }
}

export interface TwoPhaseRecallOptions {
  mode?: ActivationModeName | string
  activationStrategy?: ActivationStrategy
  maxActivations?: number
  loadAllEngrams?: boolean
  typeWeights?: TypeWeights
  weightFactors?: WeightFactors
  typeQuotas?: TypeQuotas
  totalLimit?: number
  temporalDecay?: number
}

export class TwoPhaseRecallStrategy {
  public coarseRecall: CoarseRecallConfig
  public fineRanking: FineRankingConfig
  public network: Network | null
  public memory: Memory | null
  private readonly mode: ActivationModeName | string | undefined

  constructor(options: TwoPhaseRecallOptions = {}) {
    let merged: TwoPhaseRecallOptions = options

    // 如果指定了 mode，使用 ActivationMode 配置
    if (options.mode) {
      const modeConfig = ActivationMode.createRecallConfig(options.mode)
      // modeConfig 提供默认值，options 可以覆盖
      merged = { ...modeConfig, ...options }

      logInfo('[TwoPhaseRecallStrategy] Using ActivationMode', {
        mode: options.mode,
        modeConfig,
      })
    }

    this.mode = merged.mode

    // 第一阶段配置
    this.coarseRecall = {
      // 激活策略（可替换）
      activationStrategy: merged.activationStrategy ?? new HippocampalActivationStrategy(),
      // 最大激活数量
      maxActivations: merged.maxActivations ?? 100,
      // 是否加载所有相关Engrams
      loadAllEngrams: merged.loadAllEngrams !== false,
    }

    // 第二阶段配置
    this.fineRanking = {
      typeWeights: merged.typeWeights ?? { PATTERN: 2.0, LINK: 1.5, ATOMIC: 1.0 },
      weightFactors: merged.weightFactors ?? {
        type: 0.3,
        relevance: 0.4,
        strength: 0.2,
        temporal: 0.1,
      },
      typeQuotas: merged.typeQuotas ?? { PATTERN: 10, LINK: 15, ATOMIC: 25 },
      totalLimit: merged.totalLimit ?? 50,
      temporalDecay: merged.temporalDecay ?? 30,
    }

    // 依赖注入
    this.network = null
    this.memory = null

    logInfo('[TwoPhaseRecallStrategy] Initialized', {
      mode: this.mode,
      coarseRecall: this.coarseRecall,
      fineRanking: this.fineRanking,
    })
  }

  /**
   * 设置依赖
   */
  setDependencies(network: Network, memory: Memory | null): void {
    this.network = network
    this.memory = memory
  }

  /**
   * 执行完整的两阶段召回
   */
  async recall(query: string | string[] | null): Promise<Mind | null> {
    logInfo('[TwoPhaseRecallStrategy] Starting two-phase recall', { query })

    // 第一阶段：粗召回
    const coarseResult = await this.performCoarseRecall(query)

    // 第二阶段：精排序
    const finalResult = await this.performFineRanking(coarseResult, query)

    logInfo('[TwoPhaseRecallStrategy] Recall completed', {
      query,
      phase1Count: coarseResult.activatedCues.size,
      phase1Engrams: coarseResult.engrams?.length ?? 0,
      phase2Engrams: finalResult.engrams?.length ?? 0,
    })

    return finalResult
  }

  /**
   * 第一阶段：粗召回
   */
  async performCoarseRecall(query: string | string[] | null): Promise<Mind> {
    logDebug('[Phase1] Starting coarse recall', { query, queryType: typeof query })

    // 1. 处理不同类型的query输入
    let centerWords: string[]

    if (query === null || query === undefined || query === 'null') {
      // DMN模式：自动选择枢纽节点
      centerWords = await this.selectHubNodes()
      logInfo('[Phase1] DMN mode: selected hub nodes', {
        hubs: centerWords,
        count: centerWords.length,
      })
    } else if (Array.isArray(query)) {
      // 多词模式：直接使用
      centerWords = query
      logInfo('[Phase1] Multi-word mode', {
        words: centerWords,
        count: centerWords.length,
      })
    } else {
      // 单词模式：分词后选择最佳
      const words = this.tokenize(query)
      logDebug('[Phase1] Tokenized words', { words, networkSize: this.network?.size() ?? 0 })

      const centerCue = await this.findBestCue(words)

      if (!centerCue) {
        logWarn('[Phase1] No center cue found', { query, words, networkSize: this.network?.size() ?? 0 })
        return new Mind(null)
      }

      centerWords = [centerCue.word]
      logInfo('[Phase1] Single-word mode: found center cue', {
        word: centerCue.word,
        connections: centerCue.connections.size,
      })
    }

    // 验证至少有一个有效词
    if (!centerWords || centerWords.length === 0) {
      logWarn('[Phase1] No valid center words', { query })
      return new Mind(null)
    }

    // 2. 使用Recall进行激活扩散
    if (!this.network) {
      logErr('[TwoPhaseRecallStrategy] Network not set')
      return new Mind(null)
    }

    // Dynamic import to avoid TDZ when module graph is in flux
    const { Recall } = await import('./Recall')
    const recall = new Recall(this.network, {
      activationStrategy: this.coarseRecall.activationStrategy,
    })

    const mind = recall.execute(centerWords)

    if (!mind) {
      logWarn('[Phase1] Recall failed', { query, centerWords })
      return new Mind(null)
    }

    // 3. 加载所有激活节点的Engrams
    if (this.coarseRecall.loadAllEngrams) {
      mind.engrams = await this.loadEngrams(mind.activatedCues, query)
    }

    logDebug('[Phase1] Coarse recall completed', {
      activatedCount: mind.activatedCues.size,
      engramCount: mind.engrams?.length ?? 0,
    })

    return mind
  }

  /**
   * 第二阶段：精排序
   */
  async performFineRanking(mind: Mind, query: string | string[] | null): Promise<Mind> {
    logDebug('[Phase2] Starting fine ranking', {
      engramCount: mind.engrams?.length ?? 0,
    })

    if (!mind.engrams || mind.engrams.length === 0) {
      return mind
    }

    // 1. 构建排序上下文
    const rankingContext: RankingContext = {
      query,
      activatedCues: mind.activatedCues,
      depths: mind.depths,
      connections: mind.connections,
    }

    // 2. 计算综合权重
    const weightedEngrams: WeightedEngramItem[] = mind.engrams.map((engram) =>
      this.calculateCompositeWeight(engram as Engram & { activatedBy?: string; [k: string]: unknown }, rankingContext),
    )

    // 3. 排序
    weightedEngrams.sort((a, b) => b.weight - a.weight)

    // 4. 应用筛选策略
    const filtered = this.applyFilterStrategy(weightedEngrams)

    // 5. 更新mind的engrams（扩展字段 _weight/_scores 通过 unknown 索引承载）
    mind.engrams = filtered.map((item) => ({
      ...item.engram,
      _weight: item.weight,
      _scores: item.scores,
    })) as unknown as typeof mind.engrams

    logDebug('[Phase2] Fine ranking completed', {
      originalCount: weightedEngrams.length,
      finalCount: mind.engrams.length,
      typeDistribution: this.getTypeDistribution(mind.engrams),
    })

    return mind
  }

  /**
   * 计算综合权重
   */
  calculateCompositeWeight(engram: Engram & { activatedBy?: string; [k: string]: unknown }, context: RankingContext): WeightedEngramItem {
    const factors = this.fineRanking.weightFactors

    // 1. 类型权重
    const typeScore = this.fineRanking.typeWeights[engram.type as EngramType] ?? 1.0

    // 2. 相关性权重
    const relevanceScore = this.calculateRelevance(engram, context)

    // 3. 记忆强度
    const strengthScore = engram.strength || 0.5

    // 4. 时间权重
    const ageInDays = (Date.now() - engram.timestamp) / (1000 * 60 * 60 * 24)
    const temporalScore = Math.exp(-ageInDays / this.fineRanking.temporalDecay)

    // 综合权重
    const weight =
      factors.type * typeScore +
      factors.relevance * relevanceScore +
      factors.strength * strengthScore +
      factors.temporal * temporalScore

    return {
      engram,
      weight,
      scores: { typeScore, relevanceScore, strengthScore, temporalScore },
    }
  }

  /**
   * 计算相关性分数
   */
  calculateRelevance(engram: Engram & { activatedBy?: string; [k: string]: unknown }, context: RankingContext): number {
    // 基于激活深度
    const activatedBy = engram.activatedBy ?? ''
    if (context.depths && context.depths.has(activatedBy)) {
      const depth = context.depths.get(activatedBy)
      if (depth !== undefined) {
        return 1.0 / (1 + depth * 0.2)
      }
    }

    // 基于query匹配度（简化版）
    const queryWords = (context.query ?? '').toString().toLowerCase().split(/\s+/)
    const schemaStr = Array.isArray(engram.schema) ? engram.schema.join(' ') : (engram.schema ?? '')
    const schemaWords = schemaStr.toLowerCase().split(/[\s\n]+/)
    const overlap = schemaWords.filter((w) =>
      queryWords.some((q) => w.includes(q)),
    ).length

    return Math.min(1.0, overlap / Math.max(1, queryWords.length))
  }

  /**
   * 应用筛选策略
   */
  applyFilterStrategy(weightedEngrams: WeightedEngramItem[]): WeightedEngramItem[] {
    const quotas = this.fineRanking.typeQuotas
    const limit = this.fineRanking.totalLimit

    const result: WeightedEngramItem[] = []
    const counts: Record<EngramType, number> = { PATTERN: 0, LINK: 0, ATOMIC: 0 }

    // 按配额筛选
    for (const item of weightedEngrams) {
      const type = item.engram.type as EngramType
      if (counts[type] < quotas[type]) {
        result.push(item)
        counts[type]++
        if (result.length >= limit) break
      }
    }

    // 如果没有达到限制，补充剩余的
    if (result.length < limit) {
      for (const item of weightedEngrams) {
        if (!result.includes(item)) {
          result.push(item)
          if (result.length >= limit) break
        }
      }
    }

    return result
  }

  /**
   * 辅助方法：分词
   */
  tokenize(query: string): string[] {
    return query.split(/\s+/).filter((w) => w.length > 0)
  }

  /**
   * 辅助方法：查找最佳中心Cue
   */
  async findBestCue(words: string[]): Promise<{ word: string; connections: Map<string, number> } | null> {
    if (!this.network) {
      logErr('[TwoPhaseRecallStrategy] Network not set')
      return null
    }

    // 从network中查找权重最高的Cue
    let bestCue: { word: string; connections: Map<string, number> } | null = null
    let maxConnections = 0

    for (const word of words) {
      const cue = this.network.getCue(word)
      if (cue && cue.connections.size > maxConnections) {
        bestCue = cue as unknown as { word: string; connections: Map<string, number> }
        maxConnections = cue.connections.size
      }
    }

    return bestCue
  }

  /**
   * 辅助方法：选择枢纽节点（DMN模式）
   */
  async selectHubNodes(count: number = 15): Promise<string[]> {
    if (!this.network) {
      logErr('[TwoPhaseRecallStrategy] Network not set for hub selection')
      return []
    }

    // 获取所有Cue并按连接度排序
    const allCues = Array.from(this.network.cues.values())
      .map((cue) => ({
        word: cue.word,
        degree: cue.connections.size,
        frequency: (cue as unknown as { recallFrequency?: number }).recallFrequency ?? 0,
      }))
      .filter((cue) => cue.degree > 0) // 过滤孤立节点

    if (allCues.length === 0) {
      logWarn('[TwoPhaseRecallStrategy] No connected nodes in network')
      return []
    }

    // 按连接度降序排序，取Top-N
    const hubs = allCues
      .sort((a, b) => b.degree - a.degree)
      .slice(0, count)
      .map((cue) => cue.word)

    logInfo('[TwoPhaseRecallStrategy] Selected hub nodes for DMN overview', {
      totalNodes: allCues.length,
      selectedCount: hubs.length,
      topHubs: hubs.slice(0, 10).map((word) => ({
        word,
        degree: allCues.find((c) => c.word === word)?.degree,
      })),
    })

    return hubs
  }

  /**
   * 辅助方法：激活扩散
   */
  async spread(mind: Mind, context: ActivationContext): Promise<void> {
    const strategy = this.coarseRecall.activationStrategy
    const maxActivations = this.coarseRecall.maxActivations

    // 添加中心节点
    if (mind.center) {
      mind.addActivatedCue(mind.center.word, 0)
    }

    // 执行激活循环
    while (strategy.shouldContinue(context)) {
      // 检查激活数量限制
      if (mind.activatedCues.size >= maxActivations) {
        logDebug('[TwoPhaseRecallStrategy] Max activations reached', {
          count: mind.activatedCues.size,
        })
        break
      }

      const decision = strategy.activate(context)
      if (!decision.shouldActivate) break

      // 处理激活的边
      for (const edge of decision.edges) {
        if (!this.network) continue
        if (!mind.activatedCues.has(edge.targetWord)) {
          // 获取目标Cue
          const targetCue = this.network.getCue(edge.targetWord)
          if (targetCue) {
            mind.addActivatedCue(edge.targetWord, context.cycle + 1)
            if (context.sourceCue) {
              mind.addConnection(context.sourceCue.word, edge.targetWord, edge.weight)
            }

            // 准备下一轮激活
            context.sourceCue = targetCue
            context.currentEnergy = (edge as unknown as { energy?: number }).energy ?? 0
          }
        }
      }

      // 循环计数 + 1（兼容 ActivationContext.incrementCycle 与旧 nextCycle 接口）
      if (typeof (context as unknown as { nextCycle?: () => void }).nextCycle === 'function') {
        ;(context as unknown as { nextCycle: () => void }).nextCycle()
      } else {
        context.incrementCycle()
      }
    }
  }

  /**
   * 辅助方法：加载Engrams
   */
  async loadEngrams(activatedCues: Set<string>, _query: string | string[] | null): Promise<Array<Engram & { activatedBy: string; [k: string]: unknown }>> {
    if (!this.memory) {
      logErr('[TwoPhaseRecallStrategy] Memory not set')
      return []
    }

    const engrams: Array<Engram & { activatedBy: string; [k: string]: unknown }> = []
    const engramSet = new Set<string>() // 去重

    for (const word of activatedCues) {
      const engramList = await this.memory.getByWord(word)
      if (engramList) {
        for (const engramData of engramList) {
          const engramId = engramData.id
          if (!engramSet.has(engramId)) {
            engramSet.add(engramId)
            engrams.push({
              ...(engramData as unknown as Engram),
              activatedBy: word,
            } as unknown as Engram & { activatedBy: string; [k: string]: unknown })
          }
        }
      }
    }

    logDebug('[TwoPhaseRecallStrategy] Loaded engrams', {
      activatedCues: activatedCues.size,
      totalEngrams: engrams.length,
    })

    return engrams
  }

  /**
   * 辅助方法：统计类型分布
   */
  getTypeDistribution(engrams: Array<Engram | (Engram & { [k: string]: unknown })>): Record<EngramType, number> {
    const distribution: Record<EngramType, number> = { PATTERN: 0, LINK: 0, ATOMIC: 0 }
    for (const engram of engrams) {
      const type = (engram.type as EngramType) ?? 'ATOMIC'
      distribution[type] = (distribution[type] ?? 0) + 1
    }
    return distribution
  }
}

export default TwoPhaseRecallStrategy
