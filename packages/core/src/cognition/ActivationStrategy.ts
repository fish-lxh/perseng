/**
 * ActivationStrategy - 激活策略族（Strategy Pattern）
 *
 * ## 设计理念
 *
 * 定义激活扩散的策略接口，让不同的激活算法可以灵活切换。
 * 这是策略模式在激活扩散中的应用。
 *
 * ## 为什么这样设计
 *
 * 1. **算法独立**
 *    - 激活算法独立于Recall的流程控制
 *    - 便于实现和测试不同的算法
 *    - 可以根据场景选择不同策略
 *
 * 2. **职责清晰**
 *    - Strategy负责决策（是否激活、如何激活）
 *    - Recall负责执行（管理流程、构建Mind）
 *    - Context负责状态（数据和状态管理）
 *
 * 3. **易于扩展**
 *    - 新算法只需继承基类
 *    - 不影响现有代码
 *    - 可以组合不同的策略
 */
import { debug as logDebug } from '@promptx/logger'
import { WeightStrategy, ActivationEdge } from './WeightStrategy'
import { ActivationContext } from './ActivationContext'

export interface ActivationDecision {
  shouldActivate: boolean
  edges: ActivationEdge[]
}

export interface ProcessedActivationEdge extends ActivationEdge {
  energy: number
  shouldFire: boolean
}

export interface ActivationStrategyOptions {
  firingThreshold?: number
  synapticDecay?: number
  inhibitionFactor?: number
  maxCycles?: number
  cycleDecay?: number
  frequencyBoost?: number
  weightStrategy?: WeightStrategy | null
}

export class ActivationStrategy {
  public name: string
  public readonly options: ActivationStrategyOptions

  constructor(options: ActivationStrategyOptions = {}) {
    this.name = 'base'
    this.options = options
  }

  /** 子类必须实现 */
  activate(_context: ActivationContext): ActivationDecision {
    throw new Error('ActivationStrategy.activate() must be implemented')
  }

  /** 默认始终继续 */
  shouldContinue(_context: ActivationContext): boolean {
    return true
  }

  /** 默认无操作 */
  applyDecay(_context: ActivationContext): void {
    // 默认不做任何事
  }
}

/**
 * HippocampalActivationStrategy - 海马体激活策略
 *
 * 模拟海马体的激活扩散：能量流动 + 频率增强 + 侧抑制 + 自然终止
 */
export class HippocampalActivationStrategy extends ActivationStrategy {
  public override name: string
  public readonly firingThreshold: number
  public readonly synapticDecay: number
  public readonly inhibitionFactor: number
  public readonly maxCycles: number
  public readonly cycleDecay: number
  public readonly frequencyBoost: number
  /** 注入权重策略 */
  public weightStrategy: WeightStrategy | null

  constructor(options: ActivationStrategyOptions = {}) {
    super(options)
    this.name = 'hippocampal'
    this.firingThreshold = options.firingThreshold ?? 0.1
    this.synapticDecay = options.synapticDecay ?? 0.9
    this.inhibitionFactor = options.inhibitionFactor ?? 0.1
    this.maxCycles = options.maxCycles ?? 10
    this.cycleDecay = options.cycleDecay ?? 0.9
    this.frequencyBoost = options.frequencyBoost ?? 0.1
    this.weightStrategy = options.weightStrategy ?? null

    logDebug('[HippocampalActivationStrategy] Initialized', {
      firingThreshold: this.firingThreshold,
      synapticDecay: this.synapticDecay,
      maxCycles: this.maxCycles,
    })
  }

  override activate(context: ActivationContext): ActivationDecision {
    if (context.currentEnergy < this.firingThreshold) {
      logDebug('[HippocampalActivationStrategy] Energy below threshold', {
        word: context.sourceCue?.word,
        energy: context.currentEnergy,
        threshold: this.firingThreshold,
      })
      return { shouldActivate: false, edges: [] }
    }

    const sourceCue = context.sourceCue
    if (!sourceCue || !sourceCue.connections) {
      return { shouldActivate: false, edges: [] }
    }

    let edges: ActivationEdge[] = Array.from(sourceCue.connections.entries()).map(([targetWord, weight]) => ({
      targetWord,
      weight,
      frequency: context.getTargetFrequency(targetWord),
    }))

    const degree = edges.length
    const SAMPLE_SIZE = Math.min(8, Math.max(3, Math.ceil(Math.log2(degree + 1))))

    const sampledEdges = edges
      .sort((a, b) => b.weight - a.weight)
      .slice(0, SAMPLE_SIZE)

    const hubCompensation = 1 + Math.log(1 + degree) * 0.3
    const availableEnergy = context.currentEnergy * hubCompensation

    const energyPerEdge = (availableEnergy * this.synapticDecay) / Math.max(1, sampledEdges.length)

    const processedEdges = sampledEdges.map((edge) => {
      const freqBonus = 1 + Math.log(1 + (edge.frequency ?? 0)) * this.frequencyBoost
      const transmittedEnergy = energyPerEdge * freqBonus
      const inhibition = 1 - (this.inhibitionFactor * context.activatedNodes.size) / 200
      const finalEnergy = transmittedEnergy * Math.max(0.5, inhibition)
      return {
        targetWord: edge.targetWord,
        weight: edge.weight,
        energy: finalEnergy,
        frequency: edge.frequency ?? 0,
        shouldFire: finalEnergy >= this.firingThreshold,
      } as ProcessedActivationEdge
    })

    const activeEdges = processedEdges.filter(
      (e) => e.shouldFire && !context.isActivated(e.targetWord),
    )

    logDebug('[HippocampalActivationStrategy] GraphSAGE activation', {
      source: sourceCue.word,
      sourceEnergy: context.currentEnergy,
      degree,
      sampleSize: SAMPLE_SIZE,
      hubCompensation: hubCompensation.toFixed(2),
      energyPerEdge: energyPerEdge.toFixed(3),
      totalEdges: edges.length,
      sampledEdges: sampledEdges.length,
      activeEdges: activeEdges.length,
      cycle: context.cycle,
    })

    return { shouldActivate: true, edges: activeEdges }
  }

  override shouldContinue(context: ActivationContext): boolean {
    if (context.cycle >= this.maxCycles) {
      logDebug('[HippocampalActivationStrategy] Max cycles reached', {
        cycle: context.cycle,
        maxCycles: this.maxCycles,
      })
      return false
    }

    let hasHighEnergyNode = false
    for (const [, energy] of context.energyPool) {
      if (energy >= this.firingThreshold) {
        hasHighEnergyNode = true
        break
      }
    }

    if (!hasHighEnergyNode) {
      logDebug('[HippocampalActivationStrategy] No high energy nodes', {
        cycle: context.cycle,
        poolSize: context.energyPool.size,
      })
    }

    return hasHighEnergyNode
  }

  /** 应用 cycleDecay 衰减，过低节点移除 */
  override applyDecay(context: ActivationContext): void {
    for (const [word, energy] of context.energyPool) {
      const decayedEnergy = energy * this.cycleDecay
      if (decayedEnergy < 0.01) {
        context.energyPool.delete(word)
      } else {
        context.energyPool.set(word, decayedEnergy)
      }
    }

    logDebug('[HippocampalActivationStrategy] Applied decay', {
      cycle: context.cycle,
      remainingNodes: context.energyPool.size,
      totalEnergy: Array.from(context.energyPool.values())
        .reduce((sum, e) => sum + e, 0)
        .toFixed(2),
    })
  }
}

export default {
  ActivationStrategy,
  HippocampalActivationStrategy,
}
