/**
 * FrequencyCue - 带频率统计的认知线索
 *
 * ## 设计理念
 *
 * FrequencyCue继承自Cue，在保持Cue纯数据结构的基础上，
 * 添加了频率统计功能。这种设计遵循了开闭原则（OCP）：
 * - 对扩展开放：通过继承添加新功能
 * - 对修改关闭：不改变Cue的原有设计
 *
 * ## 为什么需要FrequencyCue
 *
 * 1. **使用强化原理**
 *    - 神经科学："neurons that fire together wire together"
 *    - 频繁被激活的神经通路会得到强化
 *    - 模拟人类记忆的"越用越强"特性
 *
 * 2. **分离关注点**
 *    - Cue：纯粹的数据结构，表示概念和连接
 *    - FrequencyCue：添加统计信息，用于Network管理
 *    - 清晰的职责边界
 *
 * 3. **向后兼容**
 *    - FrequencyCue IS-A Cue，可以无缝替换
 *    - 所有使用Cue的地方都可以使用FrequencyCue
 *    - 不影响现有代码
 *
 * ## 频率的作用
 *
 * 在Softmax归一化时，频率作为偏置项：
 * ```
 * adjustedLogWeight = log(weight) + log(1 + frequency * α)
 * ```
 *
 * - 高频率的节点获得额外的激活概率
 * - 形成"优先激活常用路径"的模式
 * - 模拟工作记忆的激活模式
 *
 * @class FrequencyCue
 * @extends Cue
 */
import { Cue, CueJSON } from './Cue'
import { debug as logDebug } from '@promptx/logger'

export interface FrequencyCueJSON extends CueJSON {
  recallFrequency: number
  memories?: string[]
}

export class FrequencyCue extends Cue {
  /** Recall 频率（每次被激活时递增） */
  public recallFrequency: number

  constructor(word: string) {
    super(word)
    this.recallFrequency = 0
  }

  /** 递增 recall 频率 */
  incrementFrequency(): void {
    this.recallFrequency++
    logDebug('[FrequencyCue] Frequency incremented', {
      word: this.word,
      newFrequency: this.recallFrequency,
    })
  }

  /** 获取当前频率 */
  getFrequency(): number {
    return this.recallFrequency
  }

  /** 重置频率（用于测试或清理） */
  resetFrequency(): void {
    this.recallFrequency = 0
    logDebug('[FrequencyCue] Frequency reset', { word: this.word })
  }

  /** 序列化为 JSON（含频率与记忆引用） */
  toJSON(): FrequencyCueJSON {
    const json: FrequencyCueJSON = {
      ...super.toJSON(),
      recallFrequency: this.recallFrequency,
    }

    // Cue 基类 declared 的是 optional Set<string>；运行时 Network 实际可能挂载
    if (this.memories && this.memories.size > 0) {
      json.memories = Array.from(this.memories)
    }

    return json
  }

  /** 从 JSON 恢复 FrequencyCue */
  static fromJSON(json: FrequencyCueJSON): FrequencyCue {
    const freqCue = new FrequencyCue(json.word)

    if (json.connections) {
      for (const conn of json.connections) {
        freqCue.connections.set(conn.target, conn.weight)
      }
    }

    freqCue.recallFrequency = json.recallFrequency || 0

    if (json.memories && json.memories.length > 0) {
      freqCue.memories = new Set(json.memories)
    }

    return freqCue
  }

  /** 调试信息 */
  getDebugInfo(): { word: string; outDegree: number; recallFrequency: number; strongestConnection: { word: string; weight: number } | null } {
    return {
      word: this.word,
      outDegree: this.getOutDegree(),
      recallFrequency: this.recallFrequency,
      strongestConnection: this.getStrongestConnection(),
    }
  }
}

export default FrequencyCue
