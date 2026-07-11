/**
 * ESM Wrapper for @promptx/core/pouch
 * KNUTH-FEAT 2026-07-11: 子路径暴露 — 让 ESM 消费者能直接 import pouch 子模块
 */

import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const require = createRequire(import.meta.url)
const pouch = require('./pouch.js')

export const PouchCLI = pouch.PouchCLI
export const cli = pouch.cli
export const PouchRegistry = pouch.PouchRegistry
export const PouchStateMachine = pouch.PouchStateMachine
export const BasePouchCommand = pouch.BasePouchCommand
export const commands = pouch.commands
export const execute = pouch.execute
export const help = pouch.help
export const status = pouch.status

export default pouch.default ?? pouch