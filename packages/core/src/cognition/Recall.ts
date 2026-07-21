/**
 * Recall - 记忆检索执行器
 *
 * ## 设计理念
 *
 * Recall是记忆系统的读取端，负责从Network中检索相关记忆。
 * 现在使用可插拔的激活策略，支持不同的激活扩散算法。
 *
 * ## 为什么这样设计
 *
 * 1. **策略模式**
 *    - 激活算法通过ActivationStrategy实现
 *    - 可以灵活切换不同的算法
 *    - Recall只负责流程控制
 *
 * 2. **关注点分离**
 *    - Recall：流程控制和Mind构建
 *    - ActivationStrategy：激活决策
 *    - ActivationContext：状态管理
 *
 * 3. **可扩展性**
 *    - 轻松添加新的激活算法
 *    - 不影响现有代码
 *    - 便于A/B测试不同算法
 *
 * @class Recall
 */
import { debug as logDebug, info as logInfo, warn as logWarn } from '@promptx/logger'
import { Network } from './Network'
import { Mind } from './Mind'
import { Cue } from './Cue'
import { WeightStrategy } from './WeightStrategy'
import { ActivationStrategy, HippocampalActivationStrategy } from './ActivationStrategy'
import { ActivationContext } from './ActivationContext'

export interface RecallOptions {
  activationStrategy?: ActivationStrategy
  weightStrategy?: WeightStrategy | null
}

export class Recall {
  /** 认知网络引用 */
  public readonly network: Network

  /** 权重策略（用于Softmax归一化等） */
  public weightStrategy: WeightStrategy | null

  /** 激活策略 */
  public activationStrategy: ActivationStrategy

  constructor(network: Network, options: RecallOptions = {}) {
    this.network = network
    this.weightStrategy = options.weightStrategy ?? null

    if (options.activationStrategy) {
      this.activationStrategy = options.activationStrategy
      // 注入权重策略（兼容 setWeightStrategy 旧接口与新字段直赋值）
      if (this.weightStrategy) {
        const strategyWithSetter = this.activationStrategy as unknown as {
          setWeightStrategy?: (s: WeightStrategy | null) => void
          weightStrategy?: WeightStrategy | null
        }
        if (typeof strategyWithSetter.setWeightStrategy === 'function') {
          strategyWithSetter.setWeightStrategy(this.weightStrategy)
        } else {
          strategyWithSetter.weightStrategy = this.weightStrategy
        }
      }
    } else {
      // 默认使用海马体策略
      this.activationStrategy = new HippocampalActivationStrategy({
        weightStrategy: this.weightStrategy,
      })
    }

    logDebug('[Recall] Initialized', {
      strategy: this.activationStrategy.name,
      hasWeightStrategy: !!this.weightStrategy,
    })
  }

  /**
   * 执行记忆检索
   *
   * @param words 起始词（单词或多词数组）
   * @returns 激活的认知网络
   */
  execute(words: string | string[]): Mind | null {
    // 1. 标准化输入：单词转数组
    const wordList = Array.isArray(words) ? words : [words]
    logDebug('[Recall] Starting recall', { words: wordList })

    // 2. 验证所有词是否存在
    type ValidCue = { word: string; cue: Cue }
    const validCues: ValidCue[] = []
    for (const word of wordList) {
      const cue = this.network.cues.get(word)
      if (cue) {
        validCues.push({ word, cue })
      } else {
        logWarn('[Recall] Cue not found', { word })
      }
    }

    if (validCues.length === 0) {
      logWarn('[Recall] No valid cues found', { words: wordList })
      return null
    }

    // 3. 创建虚拟mind节点（不加入network）
    const virtualMind = new Cue('mind')

    // 4. 构建多中心能量池
    // For DMN mode with multiple centers, give each node full energy for comprehensive activation
    // DMN should explore the network deeply, not conserve energy
    const initialEnergy = validCues.length > 5 ? 1.0 : (1.0 / validCues.length)
    const energyPool = new Map<string, number>()
    const activatedNodes = new Set<string>()

    for (const { word, cue } of validCues) {
      // 虚拟mind节点连接到输入词
      virtualMind.connections.set(word, initialEnergy)
      // 初始能量分配
      energyPool.set(word, initialEnergy)
      activatedNodes.add(word)

      logDebug('[Recall] Added center cue', {
        word,
        energy: initialEnergy,
        outDegree: cue.connections.size,
        frequency: (cue as unknown as { recallFrequency?: number }).recallFrequency ?? 0,
      })
    }

    logInfo('[Recall] Multi-center recall initialized', {
      centerCount: validCues.length,
      energyPerCenter: initialEnergy,
      totalEnergy: initialEnergy * validCues.length,
    })

    // 5. 创建Mind对象，以virtualMind为center
    const mind = new Mind(virtualMind)

    // 6. 标记所有输入词为depth=1，并添加虚拟mind到输入词的连接
    const now = Date.now()
    for (const word of activatedNodes) {
      mind.addActivatedCue(word, 1)
      // 添加虚拟mind节点到输入词的连接，用于toMermaid可视化
      mind.addConnection('mind', word, initialEnergy, now)
    }

    // 7. 创建激活上下文
    const firstValid = validCues[0]
    if (!firstValid) return mind

    const context = new ActivationContext({
      network: this.network as unknown as ConstructorParameters<typeof ActivationContext>[0] extends infer P
        ? P extends { network?: infer N } ? N : never : never,
      sourceCue: firstValid.cue,
      energyPool,
      activatedNodes,
      connections: [],
    })

    // Provide concrete Network reference too (covers the wider surface used by activation)
    ;(context as unknown as { network: Network }).network = this.network

    const startTime = Date.now()

    // 激活循环
    while (this.activationStrategy.shouldContinue(context)) {
      const newActivations = new Map<string, number>()

      // 处理当前能量池中的所有节点
      for (const [word, energy] of context.energyPool) {
        const sourceCue = this.network.getCue(word)
        if (!sourceCue) continue

        // 更新上下文
        context.sourceCue = sourceCue
        context.currentEnergy = energy

        // 获取激活决策
        const { shouldActivate, edges } = this.activationStrategy.activate(context)

        if (shouldActivate && edges.length > 0) {
          logDebug('[Recall] Activating from node', {
            source: word,
            energy: energy.toFixed(3),
            edgeCount: edges.length,
            cycle: context.cycle,
          })

          // 处理每条激活的边
          for (const edge of edges) {
            const edgeEnergy = (edge as unknown as { energy?: number }).energy ?? 0
            // 累积能量（可能从多个源获得）
            const currentEnergy = newActivations.get(edge.targetWord) ?? 0
            const totalEnergy = currentEnergy + edgeEnergy
            newActivations.set(edge.targetWord, totalEnergy)

            // 记录连接
            mind.addConnection(word, edge.targetWord, edge.weight)
            context.recordConnection(word, edge.targetWord, edge.weight)

            logDebug('[Recall] Edge activated', {
              from: word,
              to: edge.targetWord,
              transmittedEnergy: edgeEnergy.toFixed(3),
              totalEnergy: totalEnergy.toFixed(3),
            })
          }
        }
      }

      // 清空旧能量池，使用新的
      context.energyPool.clear()

      // 更新能量池和激活集
      const firingThreshold = (this.activationStrategy as HippocampalActivationStrategy).firingThreshold ?? 0.01
      for (const [word, energy] of newActivations) {
        context.setNodeEnergy(word, energy)

        // 能量足够高的节点标记为激活
        if (energy >= firingThreshold) {
          if (!context.isActivated(word)) {
            context.markActivated(word)
            mind.addActivatedCue(word, context.cycle + 1) // 记录激活深度
          }
        }
      }

      // 应用衰减
      this.activationStrategy.applyDecay(context)

      // 增加循环计数
      context.incrementCycle()

      // 如果没有新的激活，提前结束
      if (newActivations.size === 0) {
        logDebug('[Recall] No new activations, stopping', {
          cycle: context.cycle,
        })
        break
      }
    }

    const duration = Date.now() - startTime

    // 更新节点的recall频率
    this.network.updateRecallFrequency(context.activatedNodes)

    logInfo('[Recall] Recall completed', {
      centers: wordList,
      strategy: this.activationStrategy.name,
      cycles: context.cycle,
      activatedNodes: context.activatedNodes.size,
      connections: context.connections.length,
      duration: `${duration}ms`,
    })

    return mind
  }
}

export default Recall
