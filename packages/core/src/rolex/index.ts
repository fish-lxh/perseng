/**
 * rolex 模块入口
 *
 * 迁移说明 (P0 step 0B.1): 保留原 .js 的 const+require 模式而非 ES re-export，
 * 以避免在 consumers (如 apps/cli) 的 rootDir 约束下触发 TS6059。
 * rolex/*.js → rolex/*.ts 的完整迁移在 Phase 3。
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RolexBridge, getRolexBridge } = require('./RolexBridge') as {
  RolexBridge: unknown
  getRolexBridge: unknown
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RolexActionDispatcher } = require('./RolexActionDispatcher') as {
  RolexActionDispatcher: unknown
}

export { RolexBridge, getRolexBridge, RolexActionDispatcher }
