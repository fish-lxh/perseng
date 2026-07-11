/**
 * manifests.ts — 11 个工具 manifest 聚合导出 + 自动装配 (3.7 P2)
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.7 / 批次 3)
 *
 * tools/index.ts 改为 import 这个聚合，从 ALL_MANIFESTS 拿到全部 tool metadata。
 * 工具 handler (ToolWithHandler) 与 manifest 通过 name 在装配期绑定。
 */
import type { ToolManifest } from '~/registry/ToolRegistry.js'
import { manifest as discover } from './welcome.manifest.js'
import { manifest as action } from './action.manifest.js'
import { manifest as recall } from './recall.manifest.js'
import { manifest as remember } from './remember.manifest.js'
import { manifest as toolx } from './toolx.manifest.js'
import { manifest as timeline } from './timeline.manifest.js'
import { manifest as lifecycle } from './lifecycle.manifest.js'
import { manifest as learning } from './learning.manifest.js'
import { manifest as organization } from './organization.manifest.js'

export const ALL_MANIFESTS: ReadonlyArray<ToolManifest> = [
  discover,
  action,
  recall,
  remember,
  toolx,
  timeline,
  lifecycle,
  learning,
  organization,
] as const

/** 按 capability 标签筛选 manifest */
export function findManifestsByCapability(cap: string): ToolManifest[] {
  return ALL_MANIFESTS.filter((m) => m.capabilities.includes(cap))
}
