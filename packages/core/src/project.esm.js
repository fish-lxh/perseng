/**
 * Project 模块 ESM wrapper
 *
 * tsup onSuccess 钩子会从 dist/index.js 取所有具名导出 + default,
 * 拷贝到 dist/project.mjs。ESM 消费者 (`import ... from '@promptx/core/project'`) 走此文件。
 *
 * KNUTH-FEAT 2026-07-11: 跟 pouch.esm.js / rolex.esm.js 同一模式。
 */
'use strict'

const { createRequire } = require('node:module')
const require_ = createRequire(import.meta.url)
const mod = require_('./project/index.js')

// 拷贝具名导出
export const ProjectManager = mod.ProjectManager
export const ProjectConfig = mod.ProjectConfig
export const ProjectPathResolver = mod.ProjectPathResolver
export const getGlobalProjectManager = mod.getGlobalProjectManager
export const getCurrentMcpId = mod.getCurrentMcpId
export const getCurrentProjectPath = mod.getCurrentProjectPath

export default mod