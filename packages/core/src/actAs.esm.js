/**
 * ESM Wrapper for @promptx/core/actAs
 * KNUTH-FEAT 2026-07-11: 子路径暴露 — 让 ESM 消费者能直接 import actAs
 */

import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const actAs = require('./actAs.js')

export const actAs_ = actAs.actAs
export const isRegistered = actAs.isRegistered
export const ActAsError = actAs.ActAsError
export const ActAsErrorCode = actAs.ActAsErrorCode
export const _resetActAsCache = actAs._resetActAsCache

export default actAs.default ?? actAs