/**
 * ESM Wrapper for @promptx/core/rolex
 * KNUTH-FEAT 2026-07-11: 子路径暴露 — 让 ESM 消费者能直接 import rolex 子模块
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const rolex = require('./rolex.js')

export const RolexBridge = rolex.RolexBridge
export const getRolexBridge = rolex.getRolexBridge
export const RolexActionDispatcher = rolex.RolexActionDispatcher

export default rolex