/**
 * 引用解析器：把 Ref 列表对照 registry JSON 分类
 *
 * 规则：
 * 1. registry 中 protocol + id 都命中 → ok
 * 2. protocol 不在注册表 → unknown-protocol（含已注册 protocol 列表）
 * 3. protocol 存在但 id 找不到 → unknown-id（含该 protocol 已注册 id 列表）
 *
 * 注意：本次实现对 v1 / v2 / user / project 等 protocol 一视同仁；
 * "unknown-protocol" 只判定 registry 中是否存在该 protocol 类型的资源条目，
 * 而不判断 ResourceManager 是否真的实现了该 protocol。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Ref, RegistryEntry, RegistryJson, ResolveResult } from './types.js'

/**
 * 从 registry JSON 构造索引
 */
function buildIndex(registry: RegistryJson): {
  byProtocolAndId: Map<string, RegistryEntry>
  byProtocol: Map<string, Set<string>>
} {
  const byProtocolAndId = new Map<string, RegistryEntry>()
  const byProtocol = new Map<string, Set<string>>()
  for (const entry of registry.resources ?? []) {
    const key = `${entry.protocol}:${entry.id}`
    byProtocolAndId.set(key, entry)
    if (!byProtocol.has(entry.protocol)) byProtocol.set(entry.protocol, new Set())
    byProtocol.get(entry.protocol)!.add(entry.id)
  }
  return { byProtocolAndId, byProtocol }
}

/**
 * 加载 registry JSON
 */
export async function loadRegistry(registryPath: string): Promise<RegistryJson> {
  const raw = await readFile(registryPath, 'utf-8')
  return JSON.parse(raw) as RegistryJson
}

/**
 * 把一个 Ref 解析为 ResolveResult
 */
export function resolveOne(ref: Ref, index: ReturnType<typeof buildIndex>): ResolveResult {
  // 基础 protocol 不需要查 registry（package / project / file / user）
  // 它们不通过 id 寻址，而是路径
  const basicProtocols = new Set(['package', 'project', 'file', 'user'])
  if (basicProtocols.has(ref.protocol)) {
    return { kind: 'ok', protocol: ref.protocol, entry: { id: ref.id, reference: `@${ref.protocol}://${ref.id}` } }
  }

  // 查 (protocol, id)
  const entry = index.byProtocolAndId.get(`${ref.protocol}:${ref.id}`)
  if (entry) {
    return { kind: 'ok', protocol: ref.protocol, entry: { id: entry.id, reference: entry.reference } }
  }

  // protocol 是否存在？
  if (!index.byProtocol.has(ref.protocol)) {
    return {
      kind: 'unknown-protocol',
      protocol: ref.protocol,
      registered: Array.from(index.byProtocol.keys()).sort(),
    }
  }

  // protocol 存在，id 找不到
  return {
    kind: 'unknown-id',
    protocol: ref.protocol,
    availableIds: Array.from(index.byProtocol.get(ref.protocol)!).sort(),
  }
}

/**
 * 批量解析
 */
export function resolveRefs(refs: Ref[], registry: RegistryJson): ResolveResult[] {
  const index = buildIndex(registry)
  return refs.map((r) => resolveOne(r, index))
}

/**
 * 工具：从 registry JSON 提取 protocol 列表
 */
export function listProtocols(registry: RegistryJson): string[] {
  return Array.from(new Set((registry.resources ?? []).map((r) => r.protocol))).sort()
}
