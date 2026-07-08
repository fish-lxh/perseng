/**
 * Perseng Resource Module
 * 基于DPML资源协议的统一资源管理模块
 *
 * 提供完整的资源协议解析、注册表管理、资源加载功能
 *
 * P0 step 0B.5: 迁 .js → .ts. const+require 模式 (apps/cli TS6059 rootDir 回避),
 * 0B.6 开 dts 后可改回 import.
 */

// 核心管理器
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ResourceManager = require('./resourceManager') as new (options?: unknown) => ResourceManagerInstance
// 核心组件
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ResourceProtocolParser = require('./resourceProtocolParser') as new () => ResourceProtocolParserInstance
// 生命周期管理
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoleLifecycle = require('./lifecycle/RoleLifecycle') as unknown as RoleLifecycleClass

/** ResourceManager 鸭子类型 */
interface ResourceManagerInstance {
  // intentionally loose — index.ts 只是 re-export hub
  [key: string]: unknown
}
/** ResourceProtocolParser 鸭子类型 */
interface ResourceProtocolParserInstance {
  parse(ref: string): unknown
}
/** RoleLifecycle 鸭子类型 (实际是 class) */
interface RoleLifecycleClass {
  new (): unknown
}

// 数据类型
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  LoadingSemantics,
  ParsedReference,
  QueryParams,
  NestedReference,
  ResourceContent,
  LazyResource,
  ProcessedResult,
  ResourceResult,
  ProtocolInfo,
} = require('./types')

// 全局单例 ResourceManager 实例
let globalResourceManager: ResourceManagerInstance | null = null

/**
 * 获取全局单例 ResourceManager 实例
 * 确保整个应用程序使用同一个 ResourceManager 实例
 */
function getGlobalResourceManager(): ResourceManagerInstance {
  if (!globalResourceManager) {
    globalResourceManager = new (ResourceManager as new () => ResourceManagerInstance)()
  }
  return globalResourceManager
}

/**
 * 重置全局 ResourceManager 实例
 * 主要用于测试或需要完全重新初始化的场景
 */
function resetGlobalResourceManager(): void {
  globalResourceManager = null
}

// 导出主接口
export default {
  // 主管理器类
  ResourceManager,

  // 全局单例实例
  getGlobalResourceManager,
  resetGlobalResourceManager,

  // 核心组件
  ResourceProtocolParser,

  // 生命周期管理（角色归档/恢复）
  RoleLifecycle,

  // 数据类型
  LoadingSemantics,
  ParsedReference,
  QueryParams,
  NestedReference,
  ResourceContent,
  LazyResource,
  ProcessedResult,
  ResourceResult,
  ProtocolInfo,

  // 便捷方法 - 创建默认实例（保持向后兼容）
  createManager: (options?: unknown) => new (ResourceManager as new (o?: unknown) => ResourceManagerInstance)(options),

  // 便捷方法 - 快速解析
  parse: (resourceRef: string) => {
    const parser = new (ResourceProtocolParser as new () => ResourceProtocolParserInstance)()
    return parser.parse(resourceRef)
  },

  // 便捷方法 - 快速验证
  validate: (resourceRef: string) => {
    try {
      const parser = new (ResourceProtocolParser as new () => ResourceProtocolParserInstance)()
      parser.parse(resourceRef)
      return true
    } catch (error) {
      return false
    }
  },
}

// KNUTH-FIX 2026-07-08: 顶层 named re-export —— 之前只有 export default,
// tsup CJS 输出 module.exports = { default: {...} }, 消费方
// const { getGlobalResourceManager } = require('../../resource')
// 解出来是 undefined (在 default 里面)。加 named export 后 tsup 同步挂出
// 命名属性, 兼容 pouch/commands/* 的 destructure 模式。
export {
  ResourceManager,
  ResourceProtocolParser,
  RoleLifecycle,
  getGlobalResourceManager,
  resetGlobalResourceManager,
  LoadingSemantics,
  ParsedReference,
  QueryParams,
  NestedReference,
  ResourceContent,
  LazyResource,
  ProcessedResult,
  ResourceResult,
  ProtocolInfo,
}
