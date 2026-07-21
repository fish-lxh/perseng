/**
 * Cue - 认知线索（记忆网络节点）
 *
 * ## 设计理念
 *
 * Cue是整个认知系统的原子单位，代表一个最小的认知概念。
 * 基于认知心理学的"线索依赖记忆"（Cue-dependent memory）理论：
 * - 记忆不是孤立存储的，而是通过线索（cue）相互连接
 * - 一个线索被激活时，会激活与其相连的其他线索
 * - 连接的强度（权重）决定了激活传播的概率和强度
 *
 * ## 为什么这样设计
 *
 * 1. **去中心化的连接管理**
 *    - 每个Cue管理自己的出边（connections），像神经元管理自己的突触
 *    - 避免了中央连接表的复杂性，符合生物神经网络的结构
 *    - 便于并行处理和局部更新
 *
 * 2. **极简的数据结构**
 *    - 只存储word（概念）和connections（连接）
 *    - 不存储原始内容，因为：
 *      a) 大模型本身就能理解word的语义
 *      b) 记忆本身就是模糊的、重构性的
 *      c) 节省存储空间，提高检索效率
 *
 * 3. **单向连接设计**
 *    - connections只记录出边，不记录入边
 *    - 原因：认知过程是有方向的（从A想到B，不一定从B想到A）
 *    - 简化了数据结构，避免了双向同步的复杂性
 *
 * ## 数据结构说明
 *
 * ```javascript
 * {
 *   word: "认知",                    // 概念本身
 *   connections: Map {               // 出边集合
 *     "模型" => 1234567890.5,       // 目标词 => 权重（时间戳*衰减因子）
 *     "理解" => 1234567880.3
 *   }
 * }
 * ```
 *
 * ## 权重的含义
 *
 * 权重不是简单的强度值，而是编码了多个维度的信息：
 * - 时间信息：通过时间戳基数体现新旧
 * - 位置信息：通过位置衰减体现序列中的重要性
 * - 网络信息：通过出度调整体现节点的hub特性
 *
 * @class Cue
 */

export interface CueConnection {
  target: string
  weight: number
}

export interface CueJSON {
  word: string
  connections: CueConnection[]
}

export class Cue {
  /** 概念词 - Cue 的核心标识 */
  public readonly word: string

  /** 出边映射表：targetWord -> weight */
  public readonly connections: Map<string, number>

  /**
   * FrequencyCue 引入的 optional 记忆引用集合。
   * 在 Cue 基类上保留为可选字段，避免运行期 `this.memories` 类型缺失。
   */
  public memories?: Set<string>

  constructor(word: string) {
    this.word = word
    this.connections = new Map<string, number>()
  }

  /** 获取节点的出度（连接到多少个其他节点） */
  getOutDegree(): number {
    return this.connections.size
  }

  /**
   * 获取最强连接（权重最高的出边）
   *
   * @returns 最强连接；无连接时返回 null
   */
  getStrongestConnection(): { word: string; weight: number } | null {
    if (this.connections.size === 0) return null

    let maxWeight = -Infinity
    let strongestWord: string | null = null

    for (const [word, weight] of this.connections) {
      if (weight > maxWeight) {
        maxWeight = weight
        strongestWord = word
      }
    }

    return { word: strongestWord as string, weight: maxWeight }
  }

  /** 按权重排序的连接列表（降序），limit 默认 Infinity */
  getSortedConnections(limit: number = Infinity): Array<{ word: string; weight: number }> {
    return Array.from(this.connections.entries())
      .map(([word, weight]) => ({ word, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit)
  }

  /** 序列化为 JSON 对象（用于持久化） */
  toJSON(): CueJSON {
    return {
      word: this.word,
      connections: Array.from(this.connections.entries()).map(([target, weight]) => ({
        target,
        weight,
      })),
    }
  }

  /** 从 JSON 对象恢复 */
  static fromJSON(json: CueJSON): Cue {
    const cue = new Cue(json.word)
    if (json.connections) {
      for (const conn of json.connections) {
        cue.connections.set(conn.target, conn.weight)
      }
    }
    return cue
  }
}

export default Cue
