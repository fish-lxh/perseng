/**
 * Project 模块
 *
 * 统一管理项目配置、路径解析和项目状态
 *
 * KNUTH-FEAT 2026-07-11: 迁 .js → .ts (Phase 3d)。tsup entry 改 src/project/index.ts 即可。
 * 子模块仍是 .js + .d.ts skeleton, 用 `import X = require('./X.js')` 模式取整个模块。
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectManager = require('./ProjectManager.js')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectConfig = require('./ProjectConfig.js')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectPathResolver = require('./ProjectPathResolver.js')

// KNUTH-FAT 2026-07-11: ProjectManager.getGlobalProjectManager 是静态方法,
// 运行时有 instance.getGlobalProjectManager() 两种调用方式, 这里按 .d.ts 取静态方法,
// 与其他 module (DiscoverCommand 等) 保持一致。
const getGlobalProjectManager = ProjectManager.getGlobalProjectManager
const getCurrentMcpId = ProjectManager.getCurrentMcpId
const getCurrentProjectPath = ProjectManager.getCurrentProjectPath

// KNUTH-FEAT 2026-07-11: tsup 把 ESM `export {}` + `export default` 同时挂到 CJS 的
// module.exports (即 exports.X 与 exports.default 双挂)。consumers 既可 require 真名,
// 也可 .default 取整体 namespace, 跟 pouch/rolex/index.ts 一致。
export {
  ProjectManager,
  ProjectConfig,
  ProjectPathResolver,
  getGlobalProjectManager,
  getCurrentMcpId,
  getCurrentProjectPath,
}

export default {
  ProjectManager,
  ProjectConfig,
  ProjectPathResolver,
  getGlobalProjectManager,
  getCurrentMcpId,
  getCurrentProjectPath,
}