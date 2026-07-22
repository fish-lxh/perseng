/**
 * RoleLifecycle - 角色生命周期抽象层
 *
 * ## 背景
 *
 * V1/V2 角色在迁移后会出现"双角色"问题：dayu 把 V1 迁移到 V2 后，
 * V1 物理上还存在，但用户希望默认看到 V2 而非 V1。
 *
 * 解决方案：引入"归档"状态。
 * - V1: 隐藏标记文件 `.archived` (跟 .role.md 同级)
 * - V2: 复用 rolexjs 原生 retire 机制
 *
 * 跨 V1/V2 的 archive/unarchive/isArchived 统一接口接受 roleId：
 * - `luban`            → V1
 * - `v2:luban`         → V2 (带 v2: 前缀)
 *
 * ## KNUTH-FEAT 2026-07-04
 *
 * 方案 B - 角色迁移的"归档化"体验设计。详见 plan:
 * vast-fluttering-sunset.md 方案 B 步骤 1。
 *
 * ## KNUTH-FIX 2026-07-22 (TS migration)
 *
 * 旧 .js 用 `module.exports = RoleLifecycle` 然后 `module.exports.PROTECTED_ROLES = ...`
 * 这种 property-on-class 的写法。TS `export =` 模式下无法混合 `export const/function` —
 * 必须用 namespace 模式把所有静态属性 + factory 函数 + helpers 挂到类上。
 * 否则消费方 `const { PROTECTED_ROLES } = require(...)` 拿不到。
 */
import path from 'path'
import os from 'os'
import fs from 'fs-extra'
import logger from '@promptx/logger'

// ============================================================
// 类型定义
// ============================================================

type RoleVersion = 'v1' | 'v2'

interface ResolvedRoleId {
  version: RoleVersion
  id: string
}

interface ArchiveResult {
  ok: boolean
  marker?: string
  alreadyArchived?: boolean
  alreadyActive?: boolean
  error?: string
}

interface DeleteOptions {
  force?: boolean
}

interface ProtectedDeleteResult {
  ok: boolean
  protected?: boolean
  error?: string
}

interface UnifiedArchiveResult extends ResolvedRoleId, ArchiveResult {}
interface UnifiedDeleteResult extends ResolvedRoleId, ProtectedDeleteResult {}

interface V1Paths {
  dirPath: string
  filePath: string
  dirRoleFile: string
}

interface RolexBridge {
  retire: (roleId: string) => Promise<void>
  rehire: (roleId: string) => Promise<void>
  die: (roleId: string) => Promise<void>
}

// ============================================================
// RoleLifecycle 静态方法类
// ============================================================

class RoleLifecycle {
  // V1 操作

  static async archiveV1(roleId: string): Promise<ArchiveResult> {
    const marker = RoleLifecycle.v1ArchiveMarkerPath(roleId)
    try {
      if (await fs.pathExists(marker)) {
        logger.debug(`[RoleLifecycle] V1 already archived roleId=${roleId}`)
        return { ok: true, marker, alreadyArchived: true }
      }
      await fs.ensureFile(marker)
      logger.info(`[RoleLifecycle] V1 archived roleId=${roleId} marker=${marker}`)
      return { ok: true, marker, alreadyArchived: false }
    } catch (err) {
      logger.warn(
        `[RoleLifecycle] V1 archive failed roleId=${roleId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  static async unarchiveV1(roleId: string): Promise<ArchiveResult> {
    const marker = RoleLifecycle.v1ArchiveMarkerPath(roleId)
    try {
      if (!(await fs.pathExists(marker))) {
        logger.debug(`[RoleLifecycle] V1 not archived roleId=${roleId}`)
        return { ok: true, alreadyActive: true }
      }
      await fs.remove(marker)
      logger.info(`[RoleLifecycle] V1 unarchived roleId=${roleId}`)
      return { ok: true, alreadyActive: false }
    } catch (err) {
      logger.warn(
        `[RoleLifecycle] V1 unarchive failed roleId=${roleId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  static async isV1Archived(roleId: string): Promise<boolean> {
    const marker = RoleLifecycle.v1ArchiveMarkerPath(roleId)
    return fs.pathExists(marker)
  }

  static async listArchivedV1(): Promise<string[]> {
    const root = RoleLifecycle.v1RoleRoot()
    if (!fs.pathExistsSync(root)) return []
    const items = await fs.readdir(root)
    const result: string[] = []
    for (const item of items) {
      const fullPath = path.join(root, item)
      const stat = await fs.stat(fullPath)
      if (stat.isDirectory()) {
        const marker = path.join(fullPath, '.archived')
        if (await fs.pathExists(marker)) {
          result.push(item)
        }
      } else if (item.endsWith('.archived')) {
        const roleId = item.slice(0, -'.archived'.length)
        if (roleId) result.push(roleId)
      }
    }
    return result
  }

  // V2 操作（走 rolexjs bridge）

  static async archiveV2(roleId: string): Promise<ArchiveResult> {
    try {
      const bridge = RoleLifecycle._getRolexBridge()
      await bridge.retire(roleId)
      logger.info(`[RoleLifecycle] V2 archived (retired) roleId=${roleId}`)
      return { ok: true }
    } catch (err) {
      logger.warn(
        `[RoleLifecycle] V2 archive failed roleId=${roleId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  static async unarchiveV2(roleId: string): Promise<ArchiveResult> {
    try {
      const bridge = RoleLifecycle._getRolexBridge()
      await bridge.rehire(roleId)
      logger.info(`[RoleLifecycle] V2 unarchived (rehired) roleId=${roleId}`)
      return { ok: true }
    } catch (err) {
      logger.warn(
        `[RoleLifecycle] V2 unarchive failed roleId=${roleId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // 跨 V1/V2 统一接口

  static resolveVersion(roleId: string): ResolvedRoleId {
    if (typeof roleId !== 'string' || !roleId) {
      return { version: 'v1', id: '' }
    }
    if (roleId.startsWith('v2:')) {
      return { version: 'v2', id: roleId.slice(3) }
    }
    return { version: 'v1', id: roleId }
  }

  static async archive(roleId: string): Promise<UnifiedArchiveResult> {
    const { version, id } = this.resolveVersion(roleId)
    if (!id) return { version, id, ok: false, error: 'empty roleId' }
    if (version === 'v2') {
      const result = await this.archiveV2(id)
      return { version, id, ...result }
    }
    const result = await this.archiveV1(id)
    return { version, id, ...result }
  }

  static async unarchive(roleId: string): Promise<UnifiedArchiveResult> {
    const { version, id } = this.resolveVersion(roleId)
    if (!id) return { version, id, ok: false, error: 'empty roleId' }
    if (version === 'v2') {
      const result = await this.unarchiveV2(id)
      return { version, id, ...result }
    }
    const result = await this.unarchiveV1(id)
    return { version, id, ...result }
  }

  static async isArchived(roleId: string): Promise<boolean> {
    const { version, id } = this.resolveVersion(roleId)
    if (version === 'v2') {
      return false
    }
    return this.isV1Archived(id)
  }

  static async archiveBatch(roleIds: string[]): Promise<UnifiedArchiveResult[]> {
    if (!Array.isArray(roleIds)) return []
    const results: UnifiedArchiveResult[] = []
    for (const roleId of roleIds) {
      try {
        const result = await this.archive(roleId)
        results.push(result)
      } catch (err) {
        results.push({
          ...this.resolveVersion(roleId),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return results
  }

  static async unarchiveBatch(roleIds: string[]): Promise<UnifiedArchiveResult[]> {
    if (!Array.isArray(roleIds)) return []
    const results: UnifiedArchiveResult[] = []
    for (const roleId of roleIds) {
      try {
        const result = await this.unarchive(roleId)
        results.push(result)
      } catch (err) {
        results.push({
          ...this.resolveVersion(roleId),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return results
  }

  // 物理删除

  static async delete(roleId: string, opts: DeleteOptions = {}): Promise<UnifiedDeleteResult> {
    const { version, id } = this.resolveVersion(roleId)
    if (!id) return { version, id, ok: false, error: 'empty roleId' }

    if (!opts.force && RoleLifecycle.isProtectedRole(id)) {
      logger.warn(
        `[RoleLifecycle] delete denied for protected role "${id}" (force=false). Use archive for soft-delete.`,
      )
      return {
        version,
        id,
        ok: false,
        protected: true,
        error: `Role "${id}" is system-protected; use archive for soft-delete or pass { force: true } to override`,
      }
    }

    if (version === 'v2') {
      const result = await this.deleteV2(id)
      return { version, id, ...result }
    }
    const result = await this.deleteV1(id)
    return { version, id, ...result }
  }

  static async deleteV1(roleId: string): Promise<ProtectedDeleteResult> {
    const { filePath, dirPath, dirRoleFile } = this.probeV1Paths(roleId)
    try {
      const targets = [filePath, dirRoleFile, dirPath].filter((p) => fs.pathExistsSync(p))
      if (targets.length === 0) {
        return { ok: false, error: `V1 role "${roleId}" does not exist` }
      }
      for (const target of targets) {
        await fs.remove(target)
      }
      const marker = this.v1ArchiveMarkerPath(roleId)
      if (await fs.pathExists(marker)) {
        await fs.remove(marker)
      }
      logger.info(`[RoleLifecycle] V1 deleted (physical) roleId=${roleId}`)
      return { ok: true }
    } catch (err) {
      logger.warn(
        `[RoleLifecycle] V1 delete failed roleId=${roleId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  static async deleteV2(roleId: string): Promise<ProtectedDeleteResult> {
    try {
      const bridge = RoleLifecycle._getRolexBridge()
      await bridge.die(roleId)
      logger.info(`[RoleLifecycle] V2 deleted (died) roleId=${roleId}`)
      return { ok: true }
    } catch (err) {
      logger.warn(
        `[RoleLifecycle] V2 delete failed roleId=${roleId}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  static async deleteBatch(roleIds: string[], opts: DeleteOptions = {}): Promise<UnifiedDeleteResult[]> {
    if (!Array.isArray(roleIds)) return []
    const results: UnifiedDeleteResult[] = []
    for (const roleId of roleIds) {
      try {
        const result = await this.delete(roleId, opts)
        results.push(result)
      } catch (err) {
        results.push({
          ...this.resolveVersion(roleId),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return results
  }

  // ============================================================
  // 依赖注入：bridge 工厂（顶层 static, 走 namespace attach 暴露）
  // ============================================================

  static _getRolexBridge(): RolexBridge {
    if (RoleLifecycle._bridgeFactory) {
      return RoleLifecycle._bridgeFactory() as RolexBridge
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRolexBridge } = require('../../rolex/RolexBridge') as {
      getRolexBridge: () => RolexBridge
    }
    return getRolexBridge()
  }

  static _bridgeFactory: (() => unknown) | null = null
}

// ============================================================
// namespace: helpers + factory 函数 + PROTECTED_ROLES 集合
// 兼容旧 .js 消费方 `const { RoleLifecycle, PROTECTED_ROLES, probeV1Paths } = require(...)`
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace RoleLifecycle {
  /**
   * 系统保护角色名单。
   *
   * KNUTH-HARDENING 2026-07-05: 这些角色即便 nuwa 也不允许物理删除，
   * 只能归档（V1 标记文件 / V2 bridge.retire）。`force=true` 可绕过。
   */
  export const PROTECTED_ROLES: Set<string> = new Set([
    'nuwa', 'luban', 'dayu', 'jiangziya', 'sean',
  ])

  export function isProtectedRole(roleId: string): boolean {
    return PROTECTED_ROLES.has(roleId)
  }

  export function v1RoleRoot(): string {
    return path.join(os.homedir(), '.perseng', 'resource', 'role')
  }

  export function probeV1Paths(roleId: string): V1Paths {
    const root = v1RoleRoot()
    return {
      dirPath: path.join(root, roleId),
      filePath: path.join(root, `${roleId}.role.md`),
      dirRoleFile: path.join(root, roleId, `${roleId}.role.md`),
    }
  }

  export function v1RoleExists(roleId: string): boolean {
    const { filePath, dirRoleFile } = probeV1Paths(roleId)
    return fs.pathExistsSync(filePath) || fs.pathExistsSync(dirRoleFile)
  }

  export function v1ArchiveMarkerPath(roleId: string): string {
    const { dirPath, filePath } = probeV1Paths(roleId)
    if (fs.pathExistsSync(filePath)) {
      return path.join(path.dirname(filePath), `${roleId}.archived`)
    }
    if (fs.pathExistsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      return path.join(dirPath, '.archived')
    }
    return path.join(path.dirname(filePath), `${roleId}.archived`)
  }

  /**
   * 测试钩子：注入自定义 bridge 工厂。
   */
  export function setRolexBridgeFactory(factory: (() => unknown) | null): void {
    RoleLifecycle._bridgeFactory = factory
  }

  export function resetRolexBridgeFactory(): void {
    RoleLifecycle._bridgeFactory = null
  }
}

// 注意：lifecycleState.cjs 仍保留供 vitest 测试桥接，TS 不直接 require 它。

export = RoleLifecycle