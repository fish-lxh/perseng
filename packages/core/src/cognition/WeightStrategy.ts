/**
 * WeightStrategy - 权重计算策略族（Strategy Pattern）
 *
 * ## 设计理念
 *
 * 采用策略模式（Strategy Pattern）来封装权重计算算法，让算法可以独立变化。
 * 这样设计的好处是：
 * - 算法与使用者（Remember）解耦
 * - 便于测试不同的权重算法
 * - 支持运行时切换策略
 *
 * ## 为什么这样设计
 *
 * 1. **可扩展性**
 *    - 未来可能需要不同的权重算法（如基于频率、基于重要性等）
 *    - 不同场景可能需要不同的策略（学习模式 vs 复习模式）
 *    - 避免在Remember类中写死算法
 *
 * 2. **测试友好**
 *    - 可以独立测试每个策略
 *    - 可以使用mock策略进行单元测试
 *    - 便于对比不同策略的效果
 *
 * 3. **关注点分离**
 *    - Remember只负责构建网络结构
 *    - Strategy只负责计算权重
 *    - WeightContext负责传递数据
 *
 * ## 策略接口约定
 *
 * 所有策略必须实现calculate方法：
 * - 输入：WeightContext对象（包含所有计算所需信息）
 * - 输出：number类型的权重值
 * - 约束：权重应该是正数，且有合理的数值范围
 */
import { WeightContext } from './WeightContext'

export interface ActivationEdge {
  targetWord: string
  weight: number
  frequency?: number
  probability?: number
  adjustedLogWeight?: number
  temperature?: number
  [k: string]: unknown
}

/** WeightStrategy 基类 */
export class WeightStrategy {
  /**
   * 计算权重（子类必须实现）
   *
   * @param context 权重计算上下文
   */
  calculate(_context: WeightContext): number {
    throw new Error('WeightStrategy.calculate() must be implemented')
  }

  /**
   * 激活时归一化（默认：按 weight 比例归一化为 probability）
   */
  normalizeForActivation(edges: ActivationEdge[]): ActivationEdge[] {
    if (edges.length === 0) return edges
    const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0)
    return edges.map((edge) => ({
      ...edge,
      probability: edge.weight / totalWeight,
    }))
  }
}

/**
 * SimpleWeightStrategy - 简单权重策略（仅位置衰减）
 *
 * weight = baseWeight * decay^position
 */
export class SimpleWeightStrategy extends WeightStrategy {
  public readonly baseWeight: number
  public readonly decay: number

  constructor(options: { baseWeight?: number; decay?: number } = {}) {
    super()
    this.baseWeight = options.baseWeight ?? 1.0
    this.decay = options.decay ?? 0.9
  }

  calculate(context: WeightContext): number {
    return this.baseWeight * Math.pow(this.decay, context.position)
  }
}

/** 网络标识（最小 surface，只取 cues Map + recallFrequency） */
interface WeightStrategyNetworkLike {
  cues: Map<string, { recallFrequency?: number }>
}

export interface TimeBasedWeightStrategyOptions {
  decay?: number
  activationThreshold?: number
  frequencyFactor?: number
}

/**
 * TimeBasedWeightStrategy - 基于时间戳的权重策略（核心策略）
 *
 * weight = timestamp * decay^position
 * 激活时通过带频率偏置的 Softmax 归一化。
 */
export class TimeBasedWeightStrategy extends WeightStrategy {
  public readonly decay: number
  public readonly activationThreshold: number
  public readonly frequencyFactor: number
  /** 由 CognitionSystem 注入 */
  public network: WeightStrategyNetworkLike | null

  constructor(options: TimeBasedWeightStrategyOptions = {}) {
    super()
    this.decay = options.decay ?? 0.9
    this.activationThreshold = options.activationThreshold ?? 0.05
    this.frequencyFactor = options.frequencyFactor ?? 0.1
    this.network = null
  }

  calculate(context: WeightContext): number {
    const timestamp = context.timestamp
    const positionFactor = Math.pow(this.decay, context.position)
    const strengthFactor = context.strength || 0.8
    return timestamp * positionFactor * strengthFactor
  }

  /**
   * 带频率偏置的 Softmax 归一化（对数空间计算防溢出）
   */
  override normalizeForActivation(edges: ActivationEdge[]): ActivationEdge[] {
    if (edges.length === 0) return edges

    const enhancedEdges = edges.map((edge) => {
      let frequency = 0
      if (this.network) {
        const targetCue = this.network.cues.get(edge.targetWord)
        frequency = targetCue ? targetCue.recallFrequency ?? 0 : 0
      }
      const logWeight = Math.log(edge.weight)
      const frequencyBias = Math.log(1 + frequency * this.frequencyFactor)
      return {
        ...edge,
        adjustedLogWeight: logWeight + frequencyBias,
        frequency,
      }
    })

    const maxLogWeight = Math.max(...enhancedEdges.map((e) => e.adjustedLogWeight as number))
    const expWeights = enhancedEdges.map((e) => Math.exp((e.adjustedLogWeight as number) - maxLogWeight))
    const sumExp = expWeights.reduce((a, b) => a + b, 0)

    const normalizedEdges = edges.map((edge, i) => ({
      ...edge,
      probability: expWeights[i]! / sumExp,
      frequency: enhancedEdges[i]!.frequency,
    })).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))

    return normalizedEdges.filter((edge) => (edge.probability ?? 0) >= this.activationThreshold)
  }
}

export type ContrastMode = 'auto' | 'low' | 'medium' | 'high' | 'custom'
export type ContrastLevel = 'low' | 'medium' | 'high'

export interface TemperatureWeightStrategyOptions extends TimeBasedWeightStrategyOptions {
  temperature?: number
  contrastMode?: ContrastMode
}

/**
 * TemperatureWeightStrategy - 温度控制的权重策略
 *
 * `probability = exp((weight + batch_bonus) / T) / Σexp(...)`
 */
export class TemperatureWeightStrategy extends TimeBasedWeightStrategy {
  public temperature: number
  public contrastMode: ContrastMode

  constructor(options: TemperatureWeightStrategyOptions = {}) {
    super(options)
    this.temperature = options.temperature ?? 0.5
    this.contrastMode = options.contrastMode ?? 'auto'
  }

  setContrastLevel(level: ContrastLevel): void {
    const contrastMap: Record<ContrastLevel, number> = {
      low: 2.0,
      medium: 1.0,
      high: 0.3,
    }
    this.temperature = contrastMap[level] ?? 1.0
    this.contrastMode = level
  }

  setContrastPercentage(percentage: number): void {
    const clamped = Math.max(0, Math.min(100, percentage))
    this.temperature = 2.0 - (clamped / 100) * 1.8
    this.contrastMode = 'custom'
  }

  /**
   * auto 模式下根据平均连接数动态调整温度
   */
  autoAdjustTemperature(edges: ActivationEdge[]): number {
    if (this.contrastMode !== 'auto') {
      return this.temperature
    }
    const avgConnections = edges.length
    const hubThreshold = 5
    if (avgConnections > hubThreshold * 2) return 0.3
    if (avgConnections > hubThreshold) return 0.5
    return 1.0
  }

  /**
   * 带温度控制的 Softmax 归一化
   */
  override normalizeForActivation(edges: ActivationEdge[]): ActivationEdge[] {
    if (edges.length === 0) return edges

    const effectiveTemperature = this.autoAdjustTemperature(edges)

    const enhancedEdges = edges.map((edge) => {
      let frequency = 0
      if (this.network) {
        const targetCue = this.network.cues.get(edge.targetWord)
        frequency = targetCue ? targetCue.recallFrequency ?? 0 : 0
      }
      const logWeight = Math.log(edge.weight)
      const frequencyBias = Math.log(1 + frequency * this.frequencyFactor)
      return {
        ...edge,
        adjustedLogWeight: logWeight + frequencyBias,
        frequency,
      }
    })

    const maxLogWeight = Math.max(...enhancedEdges.map((e) => e.adjustedLogWeight as number))
    const expWeights = enhancedEdges.map((e) => Math.exp((e.adjustedLogWeight as number - maxLogWeight) / effectiveTemperature))
    const sumExp = expWeights.reduce((a, b) => a + b, 0)

    const normalizedEdges = enhancedEdges.map((enhanced, i) => {
      const baseEdge = edges[i]!
      return {
        ...baseEdge,
        probability: expWeights[i]! / sumExp,
        frequency: enhanced.frequency,
        temperature: effectiveTemperature,
      }
    }).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))

    return normalizedEdges.filter((edge) => (edge.probability ?? 0) >= this.activationThreshold)
  }
}

export default {
  WeightStrategy,
  SimpleWeightStrategy,
  TimeBasedWeightStrategy,
  TemperatureWeightStrategy,
}
