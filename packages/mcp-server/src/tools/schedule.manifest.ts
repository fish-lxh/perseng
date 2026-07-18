/**
 * schedule.manifest.ts — 调度系统工具 manifest
 * KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 3)
 *
 * 7 个 sub-ops（不含 run_now — 由 Commit 4 / ScheduleEngine 提供）：
 *   create / list / get / pause / resume / delete / history
 *
 * 与 enableV2 正交 — V1/V2 都能用（设计稿 §2.3）。
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'schedule',
  version: '2.4.1',
  capabilities: [
    'schedule:create',
    'schedule:list',
    'schedule:get',
    'schedule:pause',
    'schedule:resume',
    'schedule:delete',
    'schedule:history',
  ],
  dependencies: ['@promptx/core', 'croner'],
  schemaVersion: 1,
  inputSchema: { type: 'object', required: ['operation'] },
}