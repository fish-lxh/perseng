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
      engrams: {
        type: 'array',
        description: 'Array of engram objects for batch memory storage. Each contains content, schema, strength, type',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Raw experience content to save'
            },
            schema: {
              type: 'string',
              description: 'Space-separated or dash-separated keywords extracted from content. Use original words, do not invent new ones.'
            },
            strength: {
              type: 'number',
              description: 'Memory strength (0-1). Higher = more important, affects retrieval priority.',
              minimum: 0,
              maximum: 1,
              default: 0.8
            },
            type: {
              type: 'string',
              description: 'Engram type: ATOMIC (facts, entities), LINK (relationships, connections), PATTERN (processes, methodologies)',
              enum: ['ATOMIC', 'LINK', 'PATTERN']
            }
          },
          required: ['content', 'schema', 'strength', 'type']
        },
        minItems: 1
      }
    },
    required: ['role', 'engrams']
  },
}
