/**
 * 认知系统核心结构（极简版）
 *
 * 三个基础结构：
 * - Cue: 认知网络的节点，自管理连接
 * - Network: 所有 Cue 的容器
 * - Mind: 以某个 Cue 为中心的激活子图
 *
 * 设计原则：
 * - 只定义数据结构，不定义算法
 * - Cue 管理自己的连接（去中心化）
 * - 不存储原始内容（让大模型理解）
 *
 * P0 step 0B.5: 迁 .js → .ts. 纯聚合, 内部子模块保持 .js, 用 const+require.
 * 0B.6 开 dts 后, .d.ts 生成让 apps/cli 不再被 source 拉入 (TS6059 永久消失).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Cue = require('./Cue')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Network = require('./Network')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mind = require('./Mind')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Remember = require('./Remember')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Recall = require('./Recall')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Prime = require('./Prime')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WeightContext = require('./WeightContext')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ActivationContext = require('./ActivationContext')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CognitionSystem = require('./CognitionSystem')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WeightStrategy, SimpleWeightStrategy, TimeBasedWeightStrategy } = require('./WeightStrategy')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ActivationStrategy, HippocampalActivationStrategy } = require('./ActivationStrategy')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ActivationMode = require('./ActivationMode')

export default {
  // 核心数据结构
  Cue,
  Network,
  Mind,
  WeightContext,
  ActivationContext,

  // 操作类
  Remember,
  Recall,
  Prime,

  // 权重策略
  WeightStrategy,
  SimpleWeightStrategy,
  TimeBasedWeightStrategy,

  // 激活策略
  ActivationStrategy,
  HippocampalActivationStrategy,
  ActivationMode,

  // 系统
  CognitionSystem,
}
