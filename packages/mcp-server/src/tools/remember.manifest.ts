/**
 * remember.manifest.ts — V1 角色记忆沉淀 (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'remember',
  version: '2.4.1',
  capabilities: ['memory:remember'],
  dependencies: ['@promptx/core'],
  schemaVersion: 1,
  inputSchema: {
    type: 'object',
    properties: {
      role: { type: 'string' },
      engrams: { type: 'array' },
    },
    required: ['role', 'engrams'],
  },
}
