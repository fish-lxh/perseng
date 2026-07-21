/**
 * Network - 全局认知网络（所有 Cue 的容器）
 *
 * ## 设计理念
 *
 * Network是整个认知系统的基础设施，相当于生物大脑中的海马体（Hippocampus）。
 * 它不负责思考或推理，只负责存储和管理所有的记忆节点（Cue）。
 *
 * ## 为什么这样设计
 *
 * 1. **纯容器设计**
 *    - Network只是Cue的容器，不包含任何业务逻辑
 *    - 职责单一：存储、检索、持久化
 *    - 便于测试和维护
 *
 * 2. **去中心化架构**
 *    - 连接信息存储在Cue内部，Network不维护全局连接表
 *    - 优点：
 *      a) 避免了数据同步问题
 *      b) 支持局部更新，不需要全局锁
 *      c) 符合神经网络的生物学原理
 *
 * 3. **Map数据结构**
 *    - 使用Map而不是Object存储Cue
 *    - 原因：
 *      a) O(1)的查找性能
 *      b) 支持任何类型的键（虽然这里用string）
 *      c) 保持插入顺序（便于调试）
 *      d) 有明确的size属性
 *
 * ## 持久化设计
 *
 * 采用JSON格式持久化，结构如下：
 * ```json
 * {
 *   "version": "1.0",           // 版本号，便于未来升级
 *   "timestamp": 1234567890,     // 保存时间
 *   "cues": {                    // 所有Cue的集合
 *     "认知": {
 *       "word": "认知",
 *       "connections": [
 *         {"target": "模型", "weight": 1234567890}
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * ## 性能考虑
 *
 * - 单个Network预计存储10000+个Cue
 * - 每个Cue平均10-50个连接
 * - JSON文件大小：约1-10MB
 * - 加载时间：<100ms
 *
 * @class Network
 */
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { info, debug, warn, error as logErr } from '@promptx/logger'
import { FrequencyCue } from './FrequencyCue'
import { Cue } from './Cue'

export interface NetworkStatistics {
  totalCues: number
  totalConnections: number
  averageOutDegree: number
  maxOutDegree: number
  hubNode: string | null
  maxInDegree: number
  sinkNode: string | null
  isolatedNodes: number
}

export interface FrequencyBucket {
  range: string
  count: number
}

export interface FrequencyStatistics {
  totalRecalls: number
  averageFrequency: number
  maxFrequency: number
  mostFrequentNode: string | null
  distribution: FrequencyBucket[]
}

export class Network {
  /** Cue存储映射表：Map<word, Cue> */
  public cues: Map<string, Cue>

  /** KNUTH-NOTE: CognitionManager 注入；声明可选保留 monkey-patch 兼容性 */
  public roleId?: string
  /** KNUTH-NOTE: CognitionManager 注入；声明可选保留 monkey-patch 兼容性 */
  public directory?: string

  constructor() {
    this.cues = new Map()

    debug('[Network] Initialized empty network')
  }

  /**
   * 添加或获取Cue
   *
   * 如果Cue不存在则创建，存在则返回现有的。
   * 这是一个幂等操作，多次调用结果相同。
   */
  getOrCreateCue(word: string): FrequencyCue {
    if (!this.cues.has(word)) {
      const cue = new FrequencyCue(word)
      this.cues.set(word, cue)
      debug('[Network] Created new FrequencyCue', { word })
    }
    return this.cues.get(word) as FrequencyCue
  }

  /**
   * 获取Cue（不创建）
   */
  getCue(word: string): Cue | undefined {
    return this.cues.get(word)
  }

  /**
   * 检查Cue是否存在
   */
  hasCue(word: string): boolean {
    return this.cues.has(word)
  }

  /**
   * 获取网络规模
   */
  size(): number {
    return this.cues.size
  }

  /**
   * 计算网络的入度信息
   *
   * 入度 = 有多少其他Cue指向这个Cue
   * 这需要遍历整个网络，因为我们只存储出边。
   */
  calculateInDegrees(): Map<string, number> {
    const inDegrees = new Map<string, number>()

    // 初始化所有Cue的入度为0
    for (const word of this.cues.keys()) {
      inDegrees.set(word, 0)
    }

    // 遍历所有连接，累计入度
    for (const [, sourceCue] of this.cues) {
      for (const targetWord of sourceCue.connections.keys()) {
        const currentDegree = inDegrees.get(targetWord) ?? 0
        inDegrees.set(targetWord, currentDegree + 1)
      }
    }

    return inDegrees
  }

  /**
   * 计算网络的入度权重（每个节点被指向的总权重）
   *
   * 用于Prime选择最重要的节点。
   */
  calculateInWeights(): Map<string, number> {
    const inWeights = new Map<string, number>()

    // 遍历所有连接，累计权重
    for (const [, sourceCue] of this.cues) {
      for (const [targetWord, weight] of sourceCue.connections) {
        const currentWeight = inWeights.get(targetWord) ?? 0
        inWeights.set(targetWord, currentWeight + weight)
      }
    }

    return inWeights
  }

  /**
   * 获取网络统计信息
   */
  getStatistics(): NetworkStatistics {
    let totalConnections = 0
    let maxOutDegree = 0
    let hubNode: string | null = null
    let isolatedNodes = 0

    for (const [word, cue] of this.cues) {
      const outDegree = cue.connections.size
      totalConnections += outDegree

      if (outDegree === 0) {
        isolatedNodes++
      }

      if (outDegree > maxOutDegree) {
        maxOutDegree = outDegree
        hubNode = word
      }
    }

    const inDegrees = this.calculateInDegrees()
    let maxInDegree = 0
    let sinkNode: string | null = null

    for (const [word, inDegree] of inDegrees) {
      if (inDegree > maxInDegree) {
        maxInDegree = inDegree
        sinkNode = word
      }
    }

    return {
      totalCues: this.cues.size,
      totalConnections,
      averageOutDegree: this.cues.size > 0 ? totalConnections / this.cues.size : 0,
      maxOutDegree,
      hubNode,       // 出度最高的节点（发散中心）
      maxInDegree,
      sinkNode,      // 入度最高的节点（汇聚中心）
      isolatedNodes, // 孤立节点数量
    }
  }

  /**
   * 序列化Network到JSON文件
   */
  async persist(filePath: string): Promise<void> {
    try {
      // 转换Map为可序列化的对象
      const data: Record<string, unknown> = {
        version: '1.0',
        timestamp: Date.now(),
        cues: {},
      }

      // 序列化每个Cue
      for (const [word, cue] of this.cues) {
        (data.cues as Record<string, unknown>)[word] = cue.toJSON()
      }

      // 确保目录存在
      const dir = path.dirname(filePath)
      await fsp.mkdir(dir, { recursive: true })

      // 写入文件
      await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')

      info('[Network] Persisted to file', {
        path: filePath,
        cues: this.cues.size,
        size: JSON.stringify(data).length,
      })
    } catch (error) {
      logErr('[Network] Failed to persist', {
        path: filePath,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /**
   * 从JSON文件加载Network
   */
  async load(filePath: string): Promise<void> {
    try {
      // 读取文件
      const content = await fsp.readFile(filePath, 'utf8')
      const data = JSON.parse(content) as { version: string; timestamp: number; cues: Record<string, unknown> }

      // 版本检查
      if (data.version !== '1.0') {
        warn('[Network] Version mismatch', {
          expected: '1.0',
          actual: data.version,
        })
      }

      // 清空当前网络
      this.cues.clear()

      // 重建所有Cue
      for (const [word, cueData] of Object.entries(data.cues)) {
        const cue = FrequencyCue.fromJSON(cueData as unknown as Parameters<typeof FrequencyCue.fromJSON>[0])
        this.cues.set(word, cue)
      }

      info('[Network] Loaded from file', {
        path: filePath,
        cues: this.cues.size,
        timestamp: new Date(data.timestamp).toISOString(),
      })
    } catch (error) {
      logErr('[Network] Failed to load', {
        path: filePath,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /**
   * 同步版本的persist
   *
   * Remember需要同步保存，避免异步复杂性。
   */
  persistSync(filePath: string): void {
    try {
      // 转换Map为可序列化的对象
      const data: Record<string, unknown> = {
        version: '1.0',
        timestamp: Date.now(),
        cues: {},
      }

      // 序列化每个Cue
      for (const [word, cue] of this.cues) {
        (data.cues as Record<string, unknown>)[word] = cue.toJSON()
      }

      // 确保目录存在
      const dir = path.dirname(filePath)
      fs.mkdirSync(dir, { recursive: true })

      // 写入文件
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')

      debug('[Network] Persisted (sync) to file', {
        path: filePath,
        cues: this.cues.size,
      })
    } catch (error) {
      logErr('[Network] Failed to persist (sync)', {
        path: filePath,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /**
   * 同步版本的load
   *
   * Prime需要同步加载，避免异步复杂性。
   */
  loadSync(filePath: string): void {
    try {
      // 读取文件
      const content = fs.readFileSync(filePath, 'utf8')
      const data = JSON.parse(content) as { version: string; timestamp: number; cues: Record<string, unknown> }

      // 版本检查
      if (data.version !== '1.0') {
        warn('[Network] Version mismatch', {
          expected: '1.0',
          actual: data.version,
        })
      }

      // 清空当前网络
      this.cues.clear()

      // 重建所有Cue
      for (const [word, cueData] of Object.entries(data.cues)) {
        const cue = FrequencyCue.fromJSON(cueData as unknown as Parameters<typeof FrequencyCue.fromJSON>[0])
        this.cues.set(word, cue)
      }

      debug('[Network] Loaded (sync) from file', {
        path: filePath,
        cues: this.cues.size,
      })
    } catch (error) {
      logErr('[Network] Failed to load (sync)', {
        path: filePath,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /**
   * 更新Recall频率
   *
   * 当Recall操作完成后，更新所有被激活节点的频率。
   * 这是Network作为容器管理统计信息的体现。
   */
  updateRecallFrequency(activatedCues: Set<string>): void {
    if (!activatedCues || activatedCues.size === 0) {
      return
    }

    let updatedCount = 0
    for (const word of activatedCues) {
      const cue = this.cues.get(word)
      if (cue && typeof (cue as FrequencyCue).incrementFrequency === 'function') {
        (cue as FrequencyCue).incrementFrequency()
        updatedCount++
      }
    }

    debug('[Network] Updated recall frequencies', {
      requested: activatedCues.size,
      updated: updatedCount,
    })
  }

  /**
   * 获取频率统计信息
   */
  getFrequencyStatistics(): FrequencyStatistics {
    let totalFrequency = 0
    let maxFrequency = 0
    let mostFrequentNode: string | null = null
    const frequencyDistribution = new Map<number, number>()

    for (const [word, cue] of this.cues) {
      const frequency = (cue as FrequencyCue).recallFrequency ?? 0
      totalFrequency += frequency

      if (frequency > maxFrequency) {
        maxFrequency = frequency
        mostFrequentNode = word
      }

      // 统计频率分布
      const bucket = Math.floor(frequency / 10) * 10 // 10为一档
      frequencyDistribution.set(bucket, (frequencyDistribution.get(bucket) ?? 0) + 1)
    }

    return {
      totalRecalls: totalFrequency,
      averageFrequency: this.cues.size > 0 ? totalFrequency / this.cues.size : 0,
      maxFrequency,
      mostFrequentNode,
      distribution: Array.from(frequencyDistribution.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([bucket, count]) => ({ range: `${bucket}-${bucket + 9}`, count })),
    }
  }

  /**
   * 清空网络
   *
   * 用于测试或重置。
   */
  clear(): void {
    const previousSize = this.cues.size
    this.cues.clear()
    info('[Network] Cleared', { previousSize })
  }
}

export default Network
