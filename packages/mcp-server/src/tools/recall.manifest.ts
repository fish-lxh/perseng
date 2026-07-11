/**
 * recall.manifest.ts — V1 角色记忆召回 (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'recall',
  version: '2.4.1',
  capabilities: ['memory:recall'],
  dependencies: ['@promptx/core'],
  schemaVersion: 1,
  inputSchema: {
    type: 'object',
    properties: {
      role: { type: 'string' },
      query: { type: ['string', 'null'] },
      mode: { type: 'string', enum: ['creative', 'balanced', 'focused'] },
    },
    required: ['role'],
  },
}
