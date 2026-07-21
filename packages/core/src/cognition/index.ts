/**
 * cognition 模块 barrel
 *
 * ## 设计
 *
 * - 使用 `const X = require('./X')` shield 模式避免 tsup dts worker 触发 TS6307
 *   （与 pouch/rolex/project 的 barrel 一致；ESM `export { X } from` 会让 worker
 *    把整个依赖图拉进来，composite 项目下会触发 file-list 校验失败）
 * - 默认导出 = 21 个类的聚合对象，方便 `require('@promptx/core/cognition')` 旧消费方
 *
 * ## 使用
 *
 * ```ts
 * // 推荐：default + destructure（兼容旧消费方）
 * import cognition from '@promptx/core/cognition'
 * const { Cue, Network, CognitionManager } = cognition
 *
 * // 类型需要时直连深层路径：
 * import type { Cue, Network } from '@promptx/core/cognition/Cue'
 * ```
 */

/* eslint-disable @typescript-eslint/no-var-requires */

// KNUTH-FIX 2026-07-21: tsup CJS interop 把每个 .ts 模块包成 `{ X: class, default: class }` 命名空间。
//   旧 .js 时代 `module.exports = class` 是直接导出类。barrel 必须用 `.default` 拿到真类，
//   否则下游 `new cognition.Cue(...)` 拿到的是 namespace 而不是 constructor。
//
// KNUTH-NOTE: 不能用 `typeof import('./X')` 类型断言 — tsup dts worker 仍把
//   import path 当 file list 引用，触发 TS6307。改用本地 Constructor 接口兜底。

type ClassConstructor = new (...args: any[]) => any
type AnyModule = { default?: unknown } & Record<string, unknown>

const unwrap = (mod: AnyModule): ClassConstructor => (mod.default ?? mod) as ClassConstructor

// 核心数据结构
const Cue = unwrap(require('./Cue'))
const FrequencyCue = unwrap(require('./FrequencyCue'))
const Network = unwrap(require('./Network'))
const Mind = unwrap(require('./Mind'))
const Engram = unwrap(require('./Engram'))
const Memory = unwrap(require('./Memory'))

// 上下文
const WeightContext = unwrap(require('./WeightContext'))
const ActivationContext = unwrap(require('./ActivationContext'))

// 状态管理
const Anchor = unwrap(require('./Anchor'))

// 操作类
const Remember = unwrap(require('./Remember'))
const Recall = unwrap(require('./Recall'))
const Prime = unwrap(require('./Prime'))

// 权重策略（SimpleWeightStrategy / TimeBasedWeightStrategy / TemperatureWeightStrategy
//   都是 WeightStrategy 模块内定义的子类，统一从 WeightStrategy 模块解构）
const WeightStrategyModule = require('./WeightStrategy') as AnyModule
const WeightStrategy = unwrap(WeightStrategyModule)
const SimpleWeightStrategy = (WeightStrategyModule.SimpleWeightStrategy as ClassConstructor) ?? WeightStrategy
const TimeBasedWeightStrategy = (WeightStrategyModule.TimeBasedWeightStrategy as ClassConstructor) ?? WeightStrategy
const TemperatureWeightStrategy = (WeightStrategyModule.TemperatureWeightStrategy as ClassConstructor) ?? WeightStrategy

// 激活策略 + 模式（HippocampalActivationStrategy 是 ActivationStrategy 模块内的子类）
const ActivationStrategyModule = require('./ActivationStrategy') as AnyModule
const ActivationStrategy = unwrap(ActivationStrategyModule)
const HippocampalActivationStrategy = (ActivationStrategyModule.HippocampalActivationStrategy as ClassConstructor) ?? ActivationStrategy
const ActivationMode = unwrap(require('./ActivationMode') as AnyModule)

// 系统层
const TwoPhaseRecallStrategy = unwrap(require('./TwoPhaseRecallStrategy') as AnyModule)
const CognitionSystem = unwrap(require('./CognitionSystem') as AnyModule)
const CognitionManager = unwrap(require('./CognitionManager') as AnyModule)

export default {
  // 核心数据结构
  Cue,
  FrequencyCue,
  Network,
  Mind,
  Engram,
  Memory,

  // 上下文
  WeightContext,
  ActivationContext,

  // 状态
  Anchor,

  // 操作
  Remember,
  Recall,
  Prime,

  // 权重策略
  WeightStrategy,
  SimpleWeightStrategy,
  TimeBasedWeightStrategy,
  TemperatureWeightStrategy,

  // 激活策略
  ActivationStrategy,
  HippocampalActivationStrategy,
  ActivationMode,

  // 系统
  TwoPhaseRecallStrategy,
  CognitionSystem,
  CognitionManager,
}
