/**
 * ActivationContext - 激活扩散上下文
 *
 * ## 设计理念
 *
 * ActivationContext封装了激活扩散过程中的所有状态和数据。
 * 与WeightContext不同，这是一个有状态的对象，会在激活过程中不断更新。
 *
 * ## 为什么这样设计
 *
 * 1. **状态管理**
 *    - 集中管理激活过程的所有状态
 *    - 避免在Recall中维护大量状态变量
 *    - 便于不同策略共享和访问状态
 *
 * 2. **策略解耦**
 *    - 策略只需要关注算法逻辑
 *    - 状态管理由Context负责
 *    - 便于实现不同的激活算法
 *
 * 3. **可扩展性**
 *    - 新策略可能需要新的状态
 *    - 通过Context统一管理
 *    - 不影响现有代码
 *
 * ## 海马体算法需要的状态
 *
 * - **能量池（energyPool）**：每个节点的当前能量水平
 * - **激活集（activatedNodes）**：已激活的节点集合
 * - **循环计数（cycle）**：当前的激活循环次数
 * - **连接记录（connections）**：已建立的连接关系
 *
 * @class ActivationContext
 */
import { Cue } from './Cue'

/**
 * KNUTH-NOTE: Anchor/ActivationContext 在 Layer 0 阶段不能依赖 Network（Layer 1）。
 * 这里只声明实际访问的 surface，Network 迁完类型将被结构化兼容。
 */
interface NetworkLike {
  getCue(word: string): Cue | undefined
}

export interface ActivationConnection {
  from: string
  to: string
  weight: number
}

export interface ActivationContextParams {
  network?: NetworkLike
  sourceCue?: Cue | null
  depth?: number
  currentEnergy?: number
  activatedNodes?: Set<string>
  energyPool?: Map<string, number>
  cycle?: number
  connections?: ActivationConnection[]
  timestamp?: number
}

export interface ActivationStatistics {
  activatedNodes: number
  totalEnergy: number
  highEnergyNodes: number
  connections: number
  cycle: number
}

export class ActivationContext {
  /** 认知网络引用 */
  public network?: NetworkLike

  /** 当前源节点 */
  public sourceCue: Cue | null

  /** 当前深度（兼容旧代码） */
  public depth: number

  /** 当前节点能量水平 */
  public currentEnergy: number

  /** 已激活节点集合 */
  public activatedNodes: Set<string>

  /** 节点能量池 */
  public energyPool: Map<string, number>

  /** 循环计数 */
  public cycle: number

  /** 已建立的连接记录 */
  public connections: ActivationConnection[]

  /** 时间戳 */
  public timestamp: number

  constructor(params: ActivationContextParams = {}) {
    this.network = params.network
    this.sourceCue = params.sourceCue ?? null
    this.depth = params.depth ?? 0
    this.currentEnergy = params.currentEnergy ?? 1.0
    this.activatedNodes = params.activatedNodes ?? new Set<string>()
    this.energyPool = params.energyPool ?? new Map<string, number>()
    this.cycle = params.cycle ?? 0
    this.connections = params.connections ?? []
    this.timestamp = params.timestamp ?? Date.now()
  }

  /** 获取目标节点 recallFrequency（Cue 基类无此字段时为 0） */
  getTargetFrequency(targetWord: string): number {
    const targetCue = this.network?.getCue(targetWord) as (Cue & { recallFrequency?: number }) | undefined
    return targetCue?.recallFrequency ?? 0
  }

  /** 检查节点是否已激活 */
  isActivated(word: string): boolean {
    return this.activatedNodes.has(word)
  }

  /** 获取节点的当前能量（默认为 0） */
  getNodeEnergy(word: string): number {
    return this.energyPool.get(word) ?? 0
  }

  /** 设置节点能量（≤ 0 时移除） */
  setNodeEnergy(word: string, energy: number): void {
    if (energy > 0) {
      this.energyPool.set(word, energy)
    } else {
      this.energyPool.delete(word)
    }
  }

  /** 累加节点能量，返回新值 */
  addNodeEnergy(word: string, energyToAdd: number): number {
    const current = this.getNodeEnergy(word)
    const newEnergy = current + energyToAdd
    this.setNodeEnergy(word, newEnergy)
    return newEnergy
  }

  /** 标记节点为已激活 */
  markActivated(word: string): void {
    this.activatedNodes.add(word)
  }

  /** 记录一条新连接 */
  recordConnection(from: string, to: string, weight: number): void {
    this.connections.push({ from, to, weight })
  }

  /** 循环计数 +1 */
  incrementCycle(): void {
    this.cycle++
  }

  /** 统计信息 */
  getStatistics(): ActivationStatistics {
    const totalEnergy = Array.from(this.energyPool.values()).reduce((sum, e) => sum + e, 0)
    const highEnergyNodes = Array.from(this.energyPool.entries()).filter(([, energy]) => energy > 0.5).length
    return {
      activatedNodes: this.activatedNodes.size,
      totalEnergy,
      highEnergyNodes,
      connections: this.connections.length,
      cycle: this.cycle,
    }
  }

  /** 调试字符串 */
  toString(): string {
    const stats = this.getStatistics()
    return `ActivationContext{cycle:${this.cycle}, activated:${stats.activatedNodes}, energy:${stats.totalEnergy.toFixed(2)}}`
  }
}

export default ActivationContext
