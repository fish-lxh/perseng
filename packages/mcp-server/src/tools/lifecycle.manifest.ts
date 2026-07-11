/**
 * lifecycle.manifest.ts — 目标 + 计划 + todo (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'lifecycle',
  version: '2.4.1',
  capabilities: [
    'lifecycle:want',
    'lifecycle:plan',
    'lifecycle:todo',
    'lifecycle:finish',
    'lifecycle:achieve',
    'lifecycle:focus',
  ],
  dependencies: ['@promptx/core'],
  schemaVersion: 1,
  inputSchema: { type: 'object', required: ['operation', 'role'] },
}
