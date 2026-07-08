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
  utils,

  // 便捷导出
  ...utils,
  ...project,
}
