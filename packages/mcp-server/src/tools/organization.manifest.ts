/**
 * organization.manifest.ts — 组织 / 部门 / 人员 (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'organization',
  version: '2.4.1',
  capabilities: [
    'organization:found',
    'organization:charter',
    'organization:establish',
    'organization:hire',
    'organization:fire',
  ],
  dependencies: ['@promptx/core'],
  schemaVersion: 1,
  inputSchema: { type: 'object', required: ['operation'] },
}
