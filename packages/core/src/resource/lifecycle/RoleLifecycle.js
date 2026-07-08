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
 */

const path = require('path')
const os = require('os')
const fs = require('fs-extra')

const logger = require('@promptx/logger').default || require('@promptx/logger')

/**
 * 系统保护角色名单。
 *
 * KNUTH-HARDENING 2026-07-05: 这些角色即便 nuwa 也不允许物理删除，
 * 只能归档（V1 标记文件 / V2 bridge.retire）。`force=true` 可绕过。
 *
 * 列表来源：packages/resource/resources/role/ 下的内置角色目录 + 既有 SEED_ROLES。
 */
const PROTECTED_ROLES = new Set([
  // 系统保留角色（5 个，2026-07-05 清理）：V1/V2 都不允许物理删除
  'nuwa', 'luban', 'dayu', 'jiangziya', 'sean'
])

function isProtectedRole (roleId) {
  return PROTECTED_ROLES.has(roleId)
}

/** V1 role 根目录 */
function v1RoleRoot () {
  return path.join(os.homedir(), '.perseng', 'resource', 'role')
}

/**
 * 探测 V1 role 的两种存储形态。
 *
 * V1 角色既可以是单文件 `<id>.role.md`，也可以是目录式
 * `<id>/<id>.role.md` (带 thought/execution/knowledge 子目录)。
 * 两种形态由 packages/resource 内置角色目录决定。
 *
 * @returns {{ dirPath: string, filePath: string, dirRoleFile: string }}
 *   - dirPath: 目录式父目录 (`<roleRoot>/<id>/`)
 *   - filePath: 单文件路径 (`<roleRoot>/<id>.role.md`)
 *   - dirRoleFile: 目录式主文件路径 (`<roleRoot>/<id>/<id>.role.md`)
 */
function probeV1Paths (roleId) {
  const root = v1RoleRoot()
  return {
    dirPath: path.join(root, roleId),
    filePath: path.join(root, `${roleId}.role.md`),
    dirRoleFile: path.join(root, roleId, `${roleId}.role.md`),
  }
}

/**
 * V1 role 是否存在（任一形态）。
 */
function v1RoleExists (roleId) {
  const { filePath, dirRoleFile } = probeV1Paths(roleId)
  return fs.pathExistsSync(filePath) || fs.pathExistsSync(dirRoleFile)
}

/**
 * 计算 V1 .archived 标记文件路径。
 *
 * 兼容两种 V1 形态：
 * - 目录式: `<roleRoot>/<id>/.archived` (跟 `<id>.role.md` 同目录)
 * - 单文件: `<roleRoot>/<id>.archived` (跟 `<id>.role.md` 同级)
 *
 * 单文件 V1 优先（绝大多数用户新建的角色形态），目录式 V1 兜底
 * （packages/resource 内置角色 + 复杂角色带子目录场景）。
 */
function v1ArchiveMarkerPath (roleId) {
  const { dirPath, filePath } = probeV1Paths(roleId)
  // 单文件形态存在 → 标记文件放同级
  if (fs.pathExistsSync(filePath)) {
    return path.join(path.dirname(filePath), `${roleId}.archived`)
  }
  // 目录式形态存在 → 标记文件放目录内
  if (fs.pathExistsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    return path.join(dirPath, '.archived')
  }
  // 角色不存在 → 默认放单文件同级（archive 时会创建）
  return path.join(path.dirname(filePath), `${roleId}.archived`)
}

/**
 * RoleLifecycle - 静态方法类，跨 V1/V2 角色生命周期操作。
 *
 * 用法：
 *   const { RoleLifecycle } = require('@promptx/core').resource
 *   await RoleLifecycle.archive('luban')          // V1
 *   await RoleLifecycle.archive('v2:luban')       // V2 retire
 */
class RoleLifecycle {
  // ============================================================
  // V1 操作
  // ============================================================

  /**
   * 归档 V1 角色（创建 .archived 标记文件）。
   *
   * 幂等：标记文件已存在时直接返回 ok=true。
   * 不存在时仍创建标记（强制归档，用于"恢复旧版本"场景）。
   */
  static async archiveV1 (roleId) {
    const marker = v1ArchiveMarkerPath(roleId)
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

  /**
   * 取消归档 V1 角色（删除 .archived 标记文件）。
   *
   * 幂等：标记文件不存在时直接返回 ok=true。
   */
  static async unarchiveV1 (roleId) {
    const marker = v1ArchiveMarkerPath(roleId)
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

  /**
   * 检查 V1 角色是否已归档。
   */
  static async isV1Archived (roleId) {
    const marker = v1ArchiveMarkerPath(roleId)
    return fs.pathExists(marker)
  }

  /**
   * 列出所有已归档的 V1 角色 ID。
   *
   * 扫描 `<roleRoot>/` 下两种形态：
   * - 目录式: `<id>/.archived` 存在 → roleId = `<id>`
   * - 单文件式: `<id>.archived` 文件 → roleId = `<id>`
   */
  static async listArchivedV1 () {
    const root = v1RoleRoot()
    if (!fs.pathExistsSync(root)) return []
    const items = await fs.readdir(root)
    const result = []
    for (const item of items) {
      const fullPath = path.join(root, item)
      const stat = await fs.stat(fullPath)
      if (stat.isDirectory()) {
        // 目录式：检查 <id>/.archived
        const marker = path.join(fullPath, '.archived')
        if (await fs.pathExists(marker)) {
          result.push(item)
        }
      } else if (item.endsWith('.archived')) {
        // 单文件式：item = '<id>.archived'
        const roleId = item.slice(0, -'.archived'.length)
        if (roleId) result.push(roleId)
      }
    }
    return result
  }

  // ============================================================
  // V2 操作（走 rolexjs bridge）
  // ============================================================

  /**
   * 归档 V2 角色（= bridge.retire，软删除）。
   *
   * rolexjs 1.6.3 retire 语义：标记个体为 retired 状态，可 rehire 恢复。
   */
  static async archiveV2 (roleId) {
    try {
      const bridge = _getRolexBridge()
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

  /**
   * 取消归档 V2 角色（= bridge.rehire）。
   */
  static async unarchiveV2 (roleId) {
    try {
      const bridge = _getRolexBridge()
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

  // ============================================================
  // 跨 V1/V2 统一接口
  // ============================================================

  /**
   * 解析 roleId → { version: 'v1' | 'v2', id: string }。
   *
   * `v2:` 前缀显式标识 V2；无前缀默认 V1。
   * 自动探测：roleId 实际存在形态优先，V1/V2 都不存在时返回默认 V1。
   */
  static resolveVersion (roleId) {
    if (typeof roleId !== 'string' || !roleId) {
      return { version: 'v1', id: '' }
    }
    if (roleId.startsWith('v2:')) {
      return { version: 'v2', id: roleId.slice(3) }
    }
    return { version: 'v1', id: roleId }
  }

  /**
   * 统一归档接口。
   *
   * @param {string} roleId - `luban` (V1) 或 `v2:luban` (V2)
   * @returns {Promise<{ version: 'v1' | 'v2', ok: boolean, ... }>}
   */
  static async archive (roleId) {
    const { version, id } = this.resolveVersion(roleId)
    if (!id) return { version, id, ok: false, error: 'empty roleId' }
    if (version === 'v2') {
      const result = await this.archiveV2(id)
      return { version, id, ...result }
    }
    const result = await this.archiveV1(id)
    return { version, id, ...result }
  }

  /**
   * 统一取消归档接口。
   */
  static async unarchive (roleId) {
    const { version, id } = this.resolveVersion(roleId)
    if (!id) return { version, id, ok: false, error: 'empty roleId' }
    if (version === 'v2') {
      const result = await this.unarchiveV2(id)
      return { version, id, ...result }
    }
    const result = await this.unarchiveV1(id)
    return { version, id, ...result }
  }

  /**
   * 统一检查归档状态。
   *
   * V1: 检查 .archived 标记文件
   * V2: 当前 rolexjs 1.6.3 不直接暴露 retire 状态查询，保守返回 false
   *     (step 3 改 listV2Roles 加 includeRetired 时会做完整 V2 过滤)
   */
  static async isArchived (roleId) {
    const { version, id } = this.resolveVersion(roleId)
    if (version === 'v2') {
      // V2 retire 状态查询在 step 3 通过 listV2Roles 过滤实现
      // 此处保守返回 false，避免误报
      return false
    }
    return this.isV1Archived(id)
  }

  /**
   * 批量归档。串行执行，单条失败不影响其他。
   *
   * @param {string[]} roleIds
   * @returns {Promise<Array<{ version, id, ok, ... }>>}
   */
  static async archiveBatch (roleIds) {
    if (!Array.isArray(roleIds)) return []
    const results = []
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

  /**
   * 批量取消归档。
   */
  static async unarchiveBatch (roleIds) {
    if (!Array.isArray(roleIds)) return []
    const results = []
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

  // ============================================================
  // 物理删除（hardening 1 — 受系统角色护栏保护）
  // ============================================================

  /**
   * 物理删除角色（不可恢复）。
   *
   * 与 archive/unarchive 的核心区别：
   * - archive = 软删除（标记文件 / retire 状态），可恢复
   * - delete = 硬删除（rm 文件 / die 状态），不可恢复
   *
   * 默认拒绝删除系统保护角色（luban/nuwa/dayu/jiangziya/sean），
   * 调用方需传 `{ force: true }` 显式覆盖。
   *
   * @param {string} roleId - `luban` (V1) 或 `v2:luban` (V2)
   * @param {Object} [opts]
   * @param {boolean} [opts.force=false] - 允许删除系统保护角色（escape hatch）
   * @returns {Promise<{ version, id, ok, protected?, error?, ... }>}
   */
  static async delete (roleId, opts = {}) {
    const { version, id } = this.resolveVersion(roleId)
    if (!id) return { version, id, ok: false, error: 'empty roleId' }

    // KNUTH-HARDENING: 系统角色保护护栏
    if (!opts.force && isProtectedRole(id)) {
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

  /**
   * 删除 V1 角色（删除 role 文件或目录）。不可恢复。
   */
  static async deleteV1 (roleId) {
    const { filePath, dirPath, dirRoleFile } = probeV1Paths(roleId)
    try {
      // 兼容单文件 + 目录式两种 V1 形态
      const targets = [filePath, dirRoleFile, dirPath].filter(p => fs.pathExistsSync(p))
      if (targets.length === 0) {
        return { ok: false, error: `V1 role "${roleId}" does not exist` }
      }
      for (const target of targets) {
        await fs.remove(target)
      }
      // 同时删除 .archived 标记文件（如有）
      const marker = v1ArchiveMarkerPath(roleId)
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

  /**
   * 删除 V2 角色（= bridge.die，硬删除）。不可恢复。
   */
  static async deleteV2 (roleId) {
    try {
      const bridge = _getRolexBridge()
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

  /**
   * 批量物理删除。
   *
   * @param {string[]} roleIds
   * @param {Object} [opts] - { force }
   */
  static async deleteBatch (roleIds, opts = {}) {
    if (!Array.isArray(roleIds)) return []
    const results = []
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
}

module.exports = RoleLifecycle
module.exports.PROTECTED_ROLES = PROTECTED_ROLES
module.exports.isProtectedRole = isProtectedRole

// ============================================================
// 依赖注入：测试时可替换 RolexBridge
// ============================================================

/**
 * 获取 RolexBridge 单例。
 *
 * 默认行为：从真实模块加载。测试可通过 `setRolexBridgeFactory` 注入 mock，
 * 完全避开 vitest 4 CJS mock 在绝对路径上的拦截问题。
 *
 * `_bridgeFactory` 状态放在独立 `.cjs` 文件里共享 — vitest 的 SSR ESM transform
 * 会把 ESM `import` 和 CJS `require` 拆成不同 module instance，导致 dispatcher
 * (CJS) 与测试 (ESM) 注入的 factory 落到不同 instance。`.cjs` 强制走 Node 的
 * require cache（按绝对路径索引），无论从哪边 require 都拿到同一份 state。
 *
 * P0 step 0B.3: 去掉 .js 扩展名 — 由 vitest/tsx 的 resolver 走 extensionAlias
 * 解析到 rolex/RolexBridge.ts（生产构建由 tsup 在打包时处理）。
 */
const lifecycleState = require('./lifecycleState.cjs')

function _getRolexBridge () {
  if (lifecycleState.bridgeFactory) return lifecycleState.bridgeFactory()
  const { getRolexBridge } = require('../../rolex/RolexBridge')
  return getRolexBridge()
}

/**
 * 测试钩子：注入自定义 bridge 工厂。
 *
 * 接受工厂函数而非实例，避免单例副作用跨测试泄漏。
 *
 * @example
 *   RoleLifecycle.setRolexBridgeFactory(() => mockBridge)
 *   // 测试结束：RoleLifecycle.resetRolexBridgeFactory()
 */
function setRolexBridgeFactory (factory) {
  lifecycleState.setBridgeFactory(factory)
}

function resetRolexBridgeFactory () {
  lifecycleState.resetBridgeFactory()
}

module.exports.probeV1Paths = probeV1Paths
module.exports.v1ArchiveMarkerPath = v1ArchiveMarkerPath
module.exports.v1RoleExists = v1RoleExists
module.exports.v1RoleRoot = v1RoleRoot
module.exports.setRolexBridgeFactory = setRolexBridgeFactory
module.exports.resetRolexBridgeFactory = resetRolexBridgeFactory
