/**
 * Mind - 认知网络（以 Cue 为中心的激活子图）
 *
 * ## 设计理念
 *
 * Mind代表一个当前激活的认知状态，相当于"工作记忆"（Working Memory）。
 * 它不是所有记忆的容器（那是Network的职责），而是当前正在思考的内容。
 *
 * 类比：
 * - Network = 长期记忆（所有你知道的）
 * - Mind = 工作记忆（你现在正在想的）
 *
 * ## 为什么这样设计
 *
 * 1. **动态激活模型**
 *    - Mind是动态生成的，不是静态存储的
 *    - 每次Recall/Prime都会生成新的Mind
 *    - 反映了人类认知的动态性：同一个概念在不同时刻激活的相关内容可能不同
 *
 * 2. **有向无环图（DAG）结构**
 *    - 从中心Cue向外扩散形成的子图
 *    - 避免环路，防止无限激活
 *    - 保持思维的方向性和层次性
 *
 * 3. **轻量级设计**
 *    - 只存储激活的Cue集合和连接关系
 *    - 不复制Cue的内容，只引用
 *    - 便于序列化和传输（给大模型）
 *
 * ## 数据结构说明
 *
 * ```javascript
 * {
 *   center: Cue实例,              // 激活中心（起点）
 *   activatedCues: Set(['认知', '模型', ...]),  // 所有激活的节点
 *   connections: [                // 激活的连接
 *     {from: '认知', to: '模型', weight: 1234567890},
 *     {from: '模型', to: '训练', weight: 1234567880}
 *   ]
 * }
 * ```
 *
 * ## Mind的用途
 *
 * 1. **作为上下文提供给大模型**
 *    - 大模型可以根据Mind理解当前的思维脉络
 *    - 提供相关概念的关联性
 *
 * 2. **可视化思维过程**
 *    - 可以渲染成mindmap
 *    - 展示概念之间的关系强度
 *
 * 3. **思维链的基础**
 *    - 多个Mind可以组合成思维链
 *    - 支持复杂的推理过程
 *
 * @class Mind
 */
import { Cue } from './Cue'
import { Engram } from './Engram'

export interface MindConnection {
  from: string
  to: string
  weight: number
  /** KNUTH-FIX 2026-07-21: 补 Recall.js 实际使用的第 4 参时间戳，JSDoc 漏写 */
  ts: number
}

export interface MindStatistics {
  nodeCount: number
  edgeCount: number
  maxDepth: number
}

export interface MindJSON {
  center: string | null
  centers: string[]
  activatedCues: string[]
  connections: MindConnection[]
  depths: Array<{ word: string; depth: number }>
  statistics: MindStatistics
}

export class Mind {
  /** 激活中心（思维起点）；可能为 null（Prime 失败或多中心激活） */
  public readonly center: Cue | null

  /** 多中心支持（Prime.executeMultiple 等场景） */
  public readonly centers: Cue[]

  /** 激活的概念词集合（只存 word 不存 Cue 引用，节约内存） */
  public readonly activatedCues: Set<string>

  /** 边列表，按插入顺序保留 */
  public readonly connections: MindConnection[]

  /** 每个节点距中心的最近深度 */
  public readonly depths: Map<string, number>

  /**
   * 关联 Engram 列表（TwoPhaseRecallStrategy 在 performCoarseRecall 中动态挂载）。
   * 显式声明 optional；构造器不初始化，由 Recall/Remember 阶段填充。
   */
  public engrams?: Engram[]

  constructor(center: Cue | null) {
    this.center = center
    this.centers = []
    this.activatedCues = new Set<string>()
    this.connections = []
    this.depths = new Map<string, number>()

    if (center) {
      this.activatedCues.add(center.word)
      this.depths.set(center.word, 0)
    }
  }

  /** 添加激活的 cue；保留最小深度 */
  addActivatedCue(word: string, depth: number = 0): void {
    this.activatedCues.add(word)
    const existing = this.depths.get(word)
    if (existing === undefined || existing > depth) {
      this.depths.set(word, depth)
    }
  }

  /**
   * 添加一条连接；重复边（from+to 相同）会被忽略
   * 第 4 参 ts 为时间戳，Recall 实际传 Date.now()，未传则用当前时间兜底
   */
  addConnection(from: string, to: string, weight: number, ts: number = Date.now()): void {
    const exists = this.connections.some((conn) => conn.from === from && conn.to === to)
    if (!exists) {
      this.connections.push({ from, to, weight, ts })
    }
    this.activatedCues.add(from)
    this.activatedCues.add(to)
  }

  /** 激活节点数量 */
  size(): number {
    return this.activatedCues.size
  }

  /** 边数 */
  connectionCount(): number {
    return this.connections.length
  }

  /** 是否空 Mind */
  isEmpty(): boolean {
    return this.activatedCues.size === 0
  }

  /** 按权重降序排序后的边列表（副本） */
  getSortedConnections(): MindConnection[] {
    return [...this.connections].sort((a, b) => b.weight - a.weight)
  }

  /** 指定节点的所有出边 */
  getOutgoingConnections(word: string): MindConnection[] {
    return this.connections.filter((conn) => conn.from === word)
  }

  /** 指定节点的所有入边 */
  getIncomingConnections(word: string): MindConnection[] {
    return this.connections.filter((conn) => conn.to === word)
  }

  /** 序列化为 JSON */
  toJSON(): MindJSON {
    const maxDepth = this.depths.size === 0 ? 0 : Math.max(...this.depths.values())
    return {
      center: this.center ? this.center.word : null,
      centers: this.centers.map((c) => c.word),
      activatedCues: Array.from(this.activatedCues),
      connections: this.connections,
      depths: Array.from(this.depths.entries()).map(([word, depth]) => ({ word, depth })),
      statistics: {
        nodeCount: this.activatedCues.size,
        edgeCount: this.connections.length,
        maxDepth,
      },
    }
  }

  /** 生成 Mermaid mindmap 代码 */
  toMermaid(maxNodes: number = 100, maxDepth: number = 5): string {
    if (!this.center || this.activatedCues.size === 0) {
      return 'mindmap\n  root((空))'
    }

    const tree = this.buildTree()
    let mermaid = 'mindmap\n'
    mermaid += `  root((${this.center.word}))\n`

    const visited = new Set<string>()
    let nodeCount = 1

    const addChildren = (parent: string, indent: number, depth: number): void => {
      if (depth > maxDepth) return
      if (nodeCount >= maxNodes) return
      if (visited.has(parent)) return
      visited.add(parent)

      const children = tree.get(parent) ?? []
      for (const child of children) {
        if (nodeCount >= maxNodes) break
        if (visited.has(child)) continue
        mermaid += ' '.repeat(indent) + child + '\n'
        nodeCount++
        addChildren(child, indent + 2, depth + 1)
      }
    }

    try {
      addChildren(this.center.word, 4, 0)
    } catch {
      return `mindmap\n  root((${this.center.word}))\n    [Network too large: ${this.activatedCues.size} nodes]`
    }

    if (nodeCount >= maxNodes) {
      mermaid += `    [...${this.activatedCues.size - nodeCount} more nodes]\n`
    }
    return mermaid
  }

  /** 构建 parent -> children 树（按权重排序） */
  buildTree(): Map<string, string[]> {
    const tree = new Map<string, string[]>()
    const visited = new Set<string>()

    for (const conn of this.connections) {
      let children = tree.get(conn.from)
      if (!children) {
        children = []
        tree.set(conn.from, children)
      }
      const key = `${conn.from}->${conn.to}`
      if (!visited.has(key)) {
        children.push(conn.to)
        visited.add(key)
      }
    }

    for (const [parent, children] of tree) {
      const weighted = children.map((child) => {
        const conn = this.connections.find((c) => c.from === parent && c.to === child)
        return { child, weight: conn ? conn.weight : 0 }
      })
      weighted.sort((a, b) => b.weight - a.weight)
      tree.set(parent, weighted.map((w) => w.child))
    }
    return tree
  }

  /** 合并另一个 Mind */
  merge(otherMind: Mind): void {
    for (const cue of otherMind.activatedCues) {
      this.activatedCues.add(cue)
    }

    const existingConns = new Set(this.connections.map((c) => `${c.from}->${c.to}`))

    for (const conn of otherMind.connections) {
      const key = `${conn.from}->${conn.to}`
      if (!existingConns.has(key)) {
        this.connections.push(conn)
      }
    }

    for (const [word, depth] of otherMind.depths) {
      const existing = this.depths.get(word)
      if (existing === undefined || existing > depth) {
        this.depths.set(word, depth)
      }
    }

    if (otherMind.center) {
      this.centers.push(otherMind.center)
    }
  }
}

export default Mind
