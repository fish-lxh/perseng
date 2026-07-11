/**
 * action.manifest.ts — V1+V2 角色激活 (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'action',
  version: '2.4.1',
  capabilities: [
    'role:activate',
    'role:born',
    'role:identity',
    'role:archive',
    'role:delete',
  ],
  dependencies: ['@promptx/core'],
  schemaVersion: 1,
  inputSchema: { type: 'object', required: ['role'] },
}
