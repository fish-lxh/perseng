/**
 * WeightContext - 权重计算上下文
 *
 * ## 设计理念
 *
 * WeightContext封装了计算连接权重所需的所有信息。
 * 这是策略模式（Strategy Pattern）的关键部分，让权重计算与数据收集解耦。
 *
 * ## 为什么这样设计
 *
 * 1. **职责分离**
 *    - WeightContext负责收集数据
 *    - Strategy负责计算逻辑
 *    - 便于测试和扩展
 *
 * 2. **最小化原则**
 *    - 只包含实际使用的参数
 *    - 避免过度设计
 *    - 保持简洁清晰
 *
 * 3. **透明性**
 *    - 所有影响权重的因素都明确定义
 *    - 便于调试和优化
 *    - 易于理解权重的来源
 *
 * ## 权重因子说明
 *
 * 当前包含的因子：
 * 1. **时间因子（timestamp）**
 *    - 作为权重的基数
 *    - 新的记忆自然比旧的权重大
 *    - 体现记忆的时效性
 *
 * 2. **位置因子（position）**
 *    - 在Schema序列中的位置
 *    - 越靠后的连接权重越低（衰减）
 *    - 体现首因效应和近因效应
 *
 * 3. **网络因子（sourceOutDegree）**
 *    - 源节点的出度
 *    - 出度越高，每条边的权重越分散
 *    - 防止hub节点过度激活
 *
 * ## 设计决策
 *
 * Q: 为什么不包含targetCue？
 * A: 目标节点可能还不存在（Remember创建时），而且当前算法不需要目标节点信息。
 *
 * Q: 为什么sourceOutDegree要缓存？
 * A: 避免重复计算，虽然简单但频繁调用。
 *
 * Q: 为什么timestamp可以外部传入？
 * A: 同一批Schema应该使用相同的时间戳，保持批次内的一致性。
 *
 * @class WeightContext
 */
import { Cue } from './Cue'
import { Engram } from './Engram'

export interface WeightContextParams {
  sourceCue: Cue
  targetWord: string
  position: number
  timestamp?: number
  engram?: Engram | null
}

export interface WeightContextJSON {
  sourceWord: string | null
  targetWord: string
  position: number
  timestamp: number
  sourceOutDegree: number
  strength: number
}

export class WeightContext {
  /** 源节点 */
  public readonly sourceCue: Cue

  /** 目标词（而非 Cue 引用：目标节点可能尚未存在） */
  public readonly targetWord: string

  /** 在 Schema 中的位置（0-based） */
  public readonly position: number

  /** 当前时间戳（毫秒） */
  public readonly timestamp: number

  /** 源节点出度（缓存） */
  public readonly sourceOutDegree: number

  /** 完整记忆痕迹对象（可选） */
  public readonly engram: Engram | null

  /** 记忆强度（从 engram 提取，默认 0.8 兼容旧数据） */
  public readonly strength: number

  constructor(data: WeightContextParams) {
    this.sourceCue = data.sourceCue
    this.targetWord = data.targetWord
    this.position = data.position
    this.timestamp = data.timestamp ?? Date.now()
    this.sourceOutDegree = this.sourceCue ? this.sourceCue.connections.size : 0
    this.engram = data.engram ?? null
    this.strength = this.engram ? this.engram.strength : 0.8
  }

  /** 便捷访问源词 */
  getSourceWord(): string | null {
    return this.sourceCue ? this.sourceCue.word : null
  }

  /** 调试字符串 */
  toString(): string {
    const sourceWord = this.getSourceWord()
    return `WeightContext{${sourceWord}->${this.targetWord}, pos:${this.position}, degree:${this.sourceOutDegree}}`
  }

  /** JSON 序列化 */
  toJSON(): WeightContextJSON {
    return {
      sourceWord: this.getSourceWord(),
      targetWord: this.targetWord,
      position: this.position,
      timestamp: this.timestamp,
      sourceOutDegree: this.sourceOutDegree,
      strength: this.strength,
    }
  }
}

export default WeightContext
