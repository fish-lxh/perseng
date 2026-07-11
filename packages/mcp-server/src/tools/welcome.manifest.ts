/**
 * welcome.manifest.ts — discover tool 声明 (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'

export const manifest: ToolManifest = {
  name: 'discover',
  version: '2.4.1',
  capabilities: ['role:discover', 'role:welcome'],
  dependencies: ['@promptx/core'],
  schemaVersion: 1,
  inputSchema: { type: 'object' },
}
