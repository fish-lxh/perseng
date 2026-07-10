/**
 * Perseng 核心库
 *
 * 提供AI prompt框架的核心功能，包括：
 * - 认知系统和记忆管理
 * - 资源管理和协议解析
 * - MCP协议支持
 * - 工具扩展系统
 *
 * P0 step 0B.5: 迁 .js → .ts. 顶层聚合边界, const+require 模式
 * (apps/cli TS6059 rootDir 回避), 0B.6 开 dts 后可改回 import.
 */

// 认知模块
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cognition = require('./cognition')

// 资源管理模块
// eslint-disable-next-line @typescript-eslint/no-var-requires
const resource = require('./resource')

// 工具扩展模块
// eslint-disable-next-line @typescript-eslint/no-var-requires
const toolx = require('./toolx')

// Pouch CLI 框架
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pouch = require('./pouch')

// 项目管理模块
// eslint-disable-next-line @typescript-eslint/no-var-requires
const project = require('./project')

// RoleX V2 角色系统桥接
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rolex = require('./rolex')

// KNUTH-FEAT 2026-07-10: 内容契约 (M3) — 统一身份激活入口
// eslint-disable-next-line @typescript-eslint/no-var-requires
const actAsModule = require('./actAs')

// 工具模块
// eslint-disable-next-line @typescript-eslint/no-var-requires
const versionModule = require('./utils/version')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DirectoryService = require('./utils/DirectoryService')

const utils = {
  version: versionModule,
  DirectoryService,
  // Project 相关已移动到 project 模块
  ProjectManager: project.ProjectManager,
  ProjectPathResolver: project.ProjectPathResolver,
  ProjectConfig: project.ProjectConfig,
}

export default {
  cognition,
  resource,
  toolx,
  pouch,
  project,
  rolex,
  actAs: actAsModule,

  // 便捷导出
  ...utils,
  ...project,
}

// KNUTH-FIX 2026-07-08: 顶层 named re-export —— 之前 `export default` 让
// tsup CJS 输出为 { default: {...} }, 消费方 `const core = require('@promptx/core')`
// 拿到的 .pouch / .rolex / .ProjectPathResolver 全是 undefined (都在 default 里面)。
// 加 named export 后 tsup 会在 module.exports 上同时挂出 cognition/pouch/rolex/
// utils 等命名属性, 兼容 require 模式消费 (PersengResourceRepository, ResourceListWindow 等)。
// 注意: export default 里有 ...utils, ...project 把 ProjectPathResolver/ProjectManager
// spread 到 default 顶层; 这里也要把常用的 Project 类单独 re-export, 兼容
// `const { ProjectPathResolver } = require('@promptx/core')` 的解构用法。
export const ProjectManager = project.ProjectManager
export const ProjectPathResolver = project.ProjectPathResolver
export const ProjectConfig = project.ProjectConfig
export {
  cognition,
  resource,
  toolx,
  pouch,
  project,
  rolex,
  utils,
}
export const actAs = actAsModule.actAs
export const isRegistered = actAsModule.isRegistered
export const ActAsError = actAsModule.ActAsError
export const ActAsErrorCode = actAsModule.ActAsErrorCode
export const _resetActAsCache = actAsModule._resetActAsCache
