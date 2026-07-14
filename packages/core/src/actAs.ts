/**
 * actAs - 统一身份激活入口
 *
 * 6 个激活入口（MCP action/lifecycle/learning/organization、Feishu IPC、CLI、
 * Desktop UI）的统一前置校验点。所有激活路径必须先经过 actAs：
 *
 * - 命中 role / skill / persona → 返回 ActAsResult，**绝不**返回"假身份"
 * - 未命中 → 抛 ActAsError，错误码 ACTAS_NOT_FOUND / ACTAS_NO_ACTIVE_ROLE
 *
 * 这是内容契约 (docs/content-contract.md) §5 的落地。
 *
 * 不变量：
 * - I-1: 未知 id 抛错，不返回对象
 * - I-3: 同 session 内对同 id 返回同一 identity
 * - I-5: 缓存命中：第二次校验跳过 registry 查找
 */

// KNUTH-FEAT 2026-07-11: 改回 const+require 模式 — 跟 core 其余 TS 文件一致。
// 原 ESM import 触发 tsup dts TS6307（actAs entry 不在 resource 文件列表）。
// vitest extensionAlias 也会处理 require() 的 .js → .ts 解析。
interface ResourceManagerLike {
  initialized: boolean
  initializeWithNewArchitecture(): Promise<void>
  registryData: {
    findResourceById(id: string, protocol?: string | null): unknown
    getResourcesByProtocol(protocol: string): Array<{ id: string; source?: string }>
    [k: string]: unknown
  }
  [k: string]: unknown
}

interface RegistryResource {
  id: string
  protocol: string
  reference: string
  source?: string
  [k: string]: unknown
}

// KNUTH-FIX 2026-07-13: vitest 4.x ESM 模式下, top-level `require('./resource/index.js')`
// 不经过 extensionAlias .js→.ts 解析, 直接抛 "Cannot find module"; 而
// `await import()` 走 vite-node 全链路正常解析 + vi.mock factory 拦截。
// tsup 把这个 await import 编到 dist/actAs.js 时保持动态 import 形式
// (CJS ESM 互操作正常, dist 仍是 CJS 兼容)。
// 延迟到 actAs() 内部: result 通过 session 缓存, 资源管理器引用延迟到首次调用,
// await 只发生一次。
let _getGlobalResourceManager: (() => ResourceManagerLike) | null = null
async function loadResourceManager(): Promise<() => ResourceManagerLike> {
  if (_getGlobalResourceManager) return _getGlobalResourceManager
  // 双层 unknown cast 避开两个 TS 错:
  //   1) TS2352 (类型不充分重叠): outer ResourceManagerLike 比 resource/index.ts 内部
  //      interface (loose [k]: unknown) 字段更严, 必须过 unknown
  //   2) TS6307 (actAs entry 不在 resource 文件列表): await import 触发静态类型解析
  //      需要先 unknown 强制避检。
  // @ts-ignore — TS6307 actAs entry 不在 resource 文件列表, 静态类型解析跟随 dynamic import
  //               失败; await import 在运行时正常 (dist/actAs.js 仍 CJS 兼容)。
  //               KNUTH-FIX 2026-07-13: vitest 4.x extensionAlias 不覆盖 require 路径解析,
  //               改 await import 才会经 vite-node 解析 + vi.mock factory 拦截。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = ((await import('./resource/index.js')) as unknown) as any
  _getGlobalResourceManager = mod.getGlobalResourceManager as () => ResourceManagerLike
  return _getGlobalResourceManager
}

/** actAs 调用选项 */
export interface ActAsOptions {
  /** 校验范围：'session' = 同一进程实例复用；'task' = 不复用（每次重新查注册表） */
  scope?: 'session' | 'task'
  /** 激活后立即注入的附加资源（knowledge / skill / persona id 列表） */
  attach?: { knowledge?: string[]; skill?: string[]; persona?: string[] }
  /** fallback 行为（仅对 actAs('skill'|'persona') 有效；role 永远 throw） */
  fallback?: 'throw' | 'prompt'
  /** KNUTH-FEAT 2026-07-11: 透传给事件平台的 session/agent 上下文 */
  context?: { sessionId?: string; agentId?: string }
}

/** actAs 成功结果 */
export interface ActAsResult {
  kind: 'role' | 'skill' | 'persona'
  identity: { id: string; name: string }
  reference: string
  source?: string
  /** attach 校验结果（仅在 opts.attach 提供时有意义） */
  attachedRefs?: Array<{ protocol: string; id: string; ok: boolean; reason?: string }>
  /** 警告（例如 skill 注入但无 active role） */
  warnings: string[]
}

/** 错误码常量（外部可枚举） */
export const ActAsErrorCode = {
  NOT_FOUND: 'ACTAS_NOT_FOUND',
  NO_ACTIVE_ROLE: 'ACTAS_NO_ACTIVE_ROLE',
  UNKNOWN_PROTOCOL: 'ACTAS_UNKNOWN_PROTOCOL',
  ALREADY_REJECTED: 'ACTAS_ALREADY_REJECTED',
} as const

export type ActAsErrorCodeValue = typeof ActAsErrorCode[keyof typeof ActAsErrorCode]

/** actAs 抛出的结构化错误 */
export class ActAsError extends Error {
  public readonly code: ActAsErrorCodeValue
  public readonly id: string
  public readonly protocol?: string
  public readonly available?: string[]

  constructor(code: ActAsErrorCodeValue, message: string, ctx: { id: string; protocol?: string; available?: string[] } = { id: '' }) {
    super(message)
    this.name = 'ActAsError'
    this.code = code
    this.id = ctx.id
    this.protocol = ctx.protocol
    this.available = ctx.available
  }
}

/** session 级缓存：同 id 命中直接返回，避免重复 registry lookup */
const sessionCache = new Map<string, ActAsResult>()

/** 测试钩子：清缓存 */
export function _resetActAsCache(): void {
  sessionCache.clear()
}

/** 按协议查找资源；返回 null 时不抛 */
function findResource(rm: ResourceManagerLike, id: string, protocol: string): RegistryResource | null {
  const r = rm.registryData.findResourceById(id, protocol) as RegistryResource | null | undefined
  return r ?? null
}

/** 获取该 protocol 在注册表里的全部 id（用于错误信息） */
function listAvailable(rm: ResourceManagerLike, protocol: string): string[] {
  return rm.registryData.getResourcesByProtocol(protocol).map(r => r.id)
}

/**
 * 统一身份激活入口
 *
 * @param id     角色 / 技能 / 人格 id
 * @param opts   可选；scope 默认 'session'（命中缓存）
 *
 * @throws ActAsError NOT_FOUND        role / skill / persona 不在册
 * @throws ActAsError UNKNOWN_PROTOCOL protocol 不存在（内部错误）
 */
export async function actAs(id: string, opts: ActAsOptions = {}): Promise<ActAsResult> {
  const scope = opts.scope ?? 'session'
  const cacheKey = `${scope}:${id}`

  // I-5: 同 session 同 id 命中缓存
  if (scope === 'session' && sessionCache.has(cacheKey)) {
    const cached = sessionCache.get(cacheKey)
    if (cached) return cached
  }

  const rm = (await loadResourceManager())() as ResourceManagerLike
  if (!rm.initialized) {
    await rm.initializeWithNewArchitecture()
  }

  const warnings: string[] = []

  // 按 role → skill → persona 顺序查找。第一个命中即返回，避免歧义。
  const order: Array<ActAsResult['kind']> = ['role', 'skill', 'persona']
  let resolvedKind: ActAsResult['kind'] | null = null
  let resolvedResource: RegistryResource | null = null

  for (const protocol of order) {
    const r = findResource(rm, id, protocol)
    if (r) {
      resolvedKind = protocol
      resolvedResource = r
      break
    }
  }

  if (!resolvedResource || !resolvedKind) {
    // KNUTH-FIX 2026-07-14: V1 registry 未命中 -> 尝试 V2 (RoleX) 角色。
    // V2 角色由 born 创建于 rolexjs census，不在 V1 resource registry。此前 actAs 只查 V1，
    // 导致 action(activate)/lifecycle/learning/organization 的 actAs 前置校验误判 V2 角色
    // "不存在"，而 action(identity) 因无此校验能成功（见 RolexBridge.identity）。
    // 修复：V1 未命中时 fallback 查 bridge.isV2Role，命中则返回 V2 ActAsResult，
    // 让所有走 actAs 校验的入口都能识别 V2 角色。
    if (process.env.PERSENG_ENABLE_V2 !== '0') {
      try {
        // @ts-ignore - TS6307: actAs entry 不含 rolex/RolexBridge.ts (与 resource import 同模式);
        //               运行时 dynamic import 正常, dist/actAs.js 仍 CJS 兼容。
        const rolexMod = (await import('./rolex/RolexBridge.js')) as unknown as {
          getRolexBridge: () => { isV2Role: (roleId: string) => Promise<boolean> }
        }
        const bridge = rolexMod.getRolexBridge()
        if (await bridge.isV2Role(id)) {
          const v2Result: ActAsResult = {
            kind: 'role',
            identity: { id, name: id },
            reference: `rolex://${id}`,
            source: 'rolex',
            warnings: [],
          }
          if (scope === 'session') {
            sessionCache.set(cacheKey, v2Result)
          }
          void emitRoleActivated(v2Result, opts.context, 'v2')
          return v2Result
        }
      } catch (v2err) {
        // V2 探测失败（rolex 未就绪 / census 查询异常）-> 继续走 NOT_FOUND
        if (process.env['PERSENG_DEBUG']) {
          // eslint-disable-next-line no-console
          console.warn(
            `[actAs] V2 role check failed for '${id}': ${v2err instanceof Error ? v2err.message : String(v2err)}`,
          )
        }
      }
    }

    // 构造最全 available 列表（role 优先）
    const available: string[] = []
    for (const protocol of order) {
      available.push(...listAvailable(rm, protocol))
    }
    const dedupedAvailable = Array.from(new Set(available))

    // I-1: 不返回任何对象，强制抛错
    throw new ActAsError(
      ActAsErrorCode.NOT_FOUND,
      `身份 '${id}' 未找到。请用 discover 工具查看可用角色 / 技能 / 人格。`,
      { id, available: dedupedAvailable },
    )
  }

  // I-4: skill / persona 要求先激活 role（除非显式 fallback）
  if (resolvedKind !== 'role') {
    // 简化：session 内没有"当前激活 role"概念（无全局状态机），
    // 因此对 skill / persona 直接允许，但附加 warning。
    if (opts.fallback === 'throw') {
      throw new ActAsError(
        ActAsErrorCode.NO_ACTIVE_ROLE,
        `技能 / 人格 '${id}' 需要先激活一个 role。请先调用 actAs(<role>)。`,
        { id, protocol: resolvedKind },
      )
    }
    warnings.push(`激活 '${id}' (${resolvedKind}) 但未关联 role，建议先激活 role 再注入 skill/persona。`)
  }

  // attach 校验：仅检查这些 id 也能解析（best-effort；解析失败不阻断）
  const attachedRefs: ActAsResult['attachedRefs'] = []
  if (opts.attach) {
    for (const [proto, ids] of Object.entries(opts.attach)) {
      if (!ids || ids.length === 0) continue
      for (const attachedId of ids) {
        const r = findResource(rm, attachedId, proto)
        if (r) {
          attachedRefs.push({ protocol: proto, id: attachedId, ok: true })
        } else {
          attachedRefs.push({ protocol: proto, id: attachedId, ok: false, reason: 'not_found' })
          warnings.push(`附加资源 ${proto}://${attachedId} 未找到，已跳过。`)
        }
      }
    }
  }

  const result: ActAsResult = {
    kind: resolvedKind,
    identity: {
      id: resolvedResource.id,
      name: resolvedResource.id, // RegistryData 没有 name 字段；用 id 兜底
    },
    reference: resolvedResource.reference,
    source: resolvedResource.source,
    attachedRefs: opts.attach ? attachedRefs : undefined,
    warnings,
  }

  if (scope === 'session') {
    sessionCache.set(cacheKey, result)
  }

  // KNUTH-FEAT 2026-07-11 (M1 事件平台 PR-1): actAs 成功 → emit 一条 core.role.activated。
  // Fire-and-forget：调用方不需要等事件落库。emit 内部已 try/catch；这里只 catch import 失败。
  // 失败不影响 result 返回值。
  if (result.kind === 'role') {
    void emitRoleActivated(result, opts.context)
  }

  return result
}

/**
 * 内部 emit 包装 — 动态 import @promptx/events 避免 core build 时强依赖。
 *
 * actAs 是 6 个激活入口的唯一闸口；事件平台可用时（infra 已构建），
 * 每次成功激活生成一条事件。失败被 catch + warn，不影响返回值。
 */
async function emitRoleActivated(
  result: ActAsResult,
  context: { sessionId?: string; agentId?: string } | undefined,
  version: 'v1' | 'v2' = 'v1',
): Promise<void> {
  try {
    const events = (await import('@promptx/events')) as {
      getEventStore?: () => unknown
      isEventsEnabled?: () => boolean
    }
    if (typeof events.isEventsEnabled === 'function' && !events.isEventsEnabled()) return
    if (typeof events.getEventStore !== 'function') return
    const store = (events.getEventStore() as {
      append?: (env: unknown) => Promise<void>
    }) ?? null
    if (!store || typeof store.append !== 'function') return
    await store.append({
      type: 'core.role.activated',
      ts: Date.now(),
      producer: 'core:actAs',
      producerVersion: '2.4.1', // 与 package.json version 对齐；后续抽常量
      sessionId: context?.sessionId ?? null,
      agentId: context?.agentId ?? null,
      payload: {
        roleId: result.identity.id,
        kind: result.kind,
        reference: result.reference,
        version,
      },
      role: 'system',
      schemaVersion: 1,
    })
  } catch (err) {
    // 静默：事件平台不可用 / events 包未构建时，actAs 主流程不被打断
    if (process.env['PERSENG_DEBUG']) {
      // eslint-disable-next-line no-console
      console.warn(
        `[actAs] emit role.activated failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 同步版：仅校验 id 是否在册，不返回内容。用于 hot path 校验（如 CLI quick check）。
 *  依赖 loadResourceManager() 的副作用 — 模块加载时启动加载, 调用时若未完成则保守返回 false。
 *  KNUTH-FIX 2026-07-13: actAs 改 await import 后, getGlobalResourceManager 不再同步可得。
 *  isRegistered 选择"加载未完成 = 未注册"的保守语义, 不抛错。*/
export function isRegistered(id: string, protocol?: string): boolean {
  if (!_getGlobalResourceManager) {
    // 显式启动后台加载 (用于下次 actAs() 时无需再次 await)。
    void loadResourceManager()
    return false
  }
  const rm = _getGlobalResourceManager() as ResourceManagerLike
  if (!rm.initialized || !rm.registryData) return false
  if (protocol) {
    return findResource(rm, id, protocol) !== null
  }
  // 不指定 protocol 时，按 role → skill → persona 顺序查
  return (
    findResource(rm, id, 'role') !== null ||
    findResource(rm, id, 'skill') !== null ||
    findResource(rm, id, 'persona') !== null
  )
}

export default { actAs, isRegistered, ActAsError, ActAsErrorCode, _resetActAsCache }