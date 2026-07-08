/**
 * RolexActionDispatcher - 操作路由
 *
 * 将 MCP action 工具的 operation 参数映射到 RolexBridge 的对应方法。
 * 负责参数校验和错误处理。
 */

import * as logger from '@promptx/logger'
import { getRolexBridge, RolexBridge } from './RolexBridge'

// RoleLifecycle 仍在 ../resource/lifecycle/RoleLifecycle.js (Phase 4 范围)，
// 用 const+require 避免 consumers rootDir TS6059。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RoleLifecycle = require('../resource/lifecycle/RoleLifecycle') as unknown as {
  archiveBatch(
    roleIds: string[],
  ): Promise<Array<{ ok: boolean; version?: string; id?: string; error?: string }>>
  unarchiveBatch(
    roleIds: string[],
  ): Promise<Array<{ ok: boolean; version?: string; id?: string; error?: string }>>
  deleteBatch(
    roleIds: string[],
    options: { force: boolean },
  ): Promise<
    Array<{
      ok: boolean
      version?: string
      id?: string
      error?: string
      protected?: boolean
    }>
  >
}

export type DispatchOperation =
  | 'activate'
  | 'born'
  | 'identity'
  | 'want'
  | 'plan'
  | 'todo'
  | 'finish'
  | 'achieve'
  | 'abandon'
  | 'focus'
  | 'synthesize'
  | 'growup'
  | 'found'
  | 'establish'
  | 'hire'
  | 'fire'
  | 'appoint'
  | 'dismiss'
  | 'directory'
  | 'reflect'
  | 'realize'
  | 'master'
  | 'forget'
  | 'skill'
  | 'retire'
  | 'die'
  | 'rehire'
  | 'train'
  | 'charter'
  | 'dissolve'
  | 'charge'
  | 'require'
  | 'abolish'
  | 'archive'
  | 'unarchive'
  | 'delete'

export interface DispatchArgs {
  role?: string
  name?: string
  source?: string
  roleIds?: string[]
  archiveV1?: string[]
  type?: string
  parent?: string
  org?: string
  position?: string
  encounters?: unknown
  experience?: string
  id?: string
  experiences?: unknown
  principle?: string
  procedure?: string
  nodeId?: string
  locator?: string
  individual?: string
  skillId?: string
  content?: string
  skill?: string
  after?: string
  fallback?: string
  testable?: boolean
  force?: boolean
}

export interface DispatchResult {
  operation: string
  total?: number
  failed?: number
  protected?: number
  force?: boolean
  results?: Array<{ ok: boolean; version?: string; id?: string; error?: string; protected?: boolean }>
  archiveV1Results?: Array<{ ok: boolean; version?: string; id?: string; error?: string }>
  [key: string]: unknown
}

export class RolexActionDispatcher {
  private bridge: RolexBridge

  constructor() {
    this.bridge = getRolexBridge()
  }

  /**
   * 分发操作到对应的 RolexBridge 方法
   * @param operation - 操作类型
   * @param args - 操作参数
   * @returns 操作结果
   */
  async dispatch(operation: DispatchOperation, args: DispatchArgs = {}): Promise<unknown> {
    logger.info(`[RolexActionDispatcher] Dispatching: ${operation}`)

    switch (operation) {
      case 'activate':
        return this.activateOp(args)
      case 'born':
        return this.bornOp(args)
      case 'identity':
        return this.identityOp(args)
      case 'want':
        return this.wantOp(args)
      case 'plan':
        return this.planOp(args)
      case 'todo':
        return this.todoOp(args)
      case 'finish':
        return this.finishOp(args)
      case 'achieve':
        return this.achieveOp(args)
      case 'abandon':
        return this.abandonOp(args)
      case 'focus':
        return this.focusOp(args)
      case 'synthesize':
        return this.synthesizeOp(args)
      case 'growup':
        // 向后兼容：growup 已重命名为 synthesize
        return this.synthesizeOp(args)
      case 'found':
        return this.foundOp(args)
      case 'establish':
        return this.establishOp(args)
      case 'hire':
        return this.hireOp(args)
      case 'fire':
        return this.fireOp(args)
      case 'appoint':
        return this.appointOp(args)
      case 'dismiss':
        return this.dismissOp(args)
      case 'directory':
        return this.directoryOp(args)
      // 新增：学习循环操作
      case 'reflect':
        return this.reflectOp(args)
      case 'realize':
        return this.realizeOp(args)
      case 'master':
        return this.masterOp(args)
      case 'forget':
        return this.forgetOp(args)
      case 'skill':
        return this.skillOp(args)
      // 新增：个体生命周期
      case 'retire':
        return this.retireOp(args)
      case 'die':
        return this.dieOp(args)
      case 'rehire':
        return this.rehireOp(args)
      case 'train':
        return this.trainOp(args)
      // 新增：组织管理
      case 'charter':
        return this.charterOp(args)
      case 'dissolve':
        return this.dissolveOp(args)
      // 新增：职位管理
      case 'charge':
        return this.chargeOp(args)
      case 'require':
        return this.requireOp(args)
      case 'abolish':
        return this.abolishOp(args)
      // KNUTH-FEAT 2026-07-04: 跨 V1/V2 归档/恢复（统一接口）
      case 'archive':
        return this.archiveOp(args)
      case 'unarchive':
        return this.unarchiveOp(args)
      // KNUTH-HARDENING 2026-07-05: 物理删除（不可恢复）— 受系统角色护栏保护
      case 'delete':
        return this.deleteOp(args)
      default:
        throw new Error(`Unknown RoleX operation: ${operation as string}`)
    }
  }

  private async activateOp(args: DispatchArgs): Promise<string> {
    if (!args.role) throw new Error('role is required for activate operation')
    return this.bridge.activate(args.role)
  }

  private async bornOp(args: DispatchArgs): Promise<unknown> {
    if (!args.name) throw new Error('name is required for born operation')
    const bornResult = await this.bridge.born(args.name, args.source ?? '')

    // KNUTH-FEAT 2026-07-04: 迁移完成原子化 —— born 成功后自动归档对应的 V1 角色。
    // 单条归档失败不影响 born 结果（V2 已创建，V1 归档是可恢复的标记）。
    if (Array.isArray(args.archiveV1) && args.archiveV1.length > 0) {
      const archiveResults = await RoleLifecycle.archiveBatch(args.archiveV1)
      const failed = archiveResults.filter((r) => !r.ok)
      if (failed.length > 0) {
        logger.warn(
          `[RolexActionDispatcher] born "${args.name}" succeeded but ${failed.length}/${archiveResults.length} V1 archive failed:`,
          failed as unknown as Error,
        )
      } else {
        logger.info(
          `[RolexActionDispatcher] born "${args.name}" → auto-archived ${archiveResults.length} V1 role(s): ${args.archiveV1.join(', ')}`,
        )
      }
      return { ...(bornResult as unknown as Record<string, unknown>), archiveV1Results: archiveResults }
    }

    return bornResult
  }

  private async identityOp(args: DispatchArgs): Promise<string> {
    return this.bridge.identity(args.role)
  }

  private async wantOp(args: DispatchArgs): Promise<unknown> {
    if (!args.name) throw new Error('name is required for want operation')
    return this.bridge.want(args.name, args.source ?? '', {
      testable: args.testable,
    })
  }

  private async planOp(args: DispatchArgs): Promise<unknown> {
    return this.bridge.plan(args.source ?? '', args.id ?? '', args.after, args.fallback)
  }

  private async todoOp(args: DispatchArgs): Promise<unknown> {
    if (!args.name) throw new Error('name is required for todo operation')
    return this.bridge.todo(args.name, args.source ?? '', {
      testable: args.testable,
    })
  }

  private async finishOp(args: DispatchArgs): Promise<unknown> {
    return this.bridge.finish(args.name ?? '')
  }

  private async achieveOp(args: DispatchArgs): Promise<unknown> {
    return this.bridge.achieve(args.experience)
  }

  private async abandonOp(args: DispatchArgs): Promise<unknown> {
    return this.bridge.abandon(args.experience)
  }

  private async focusOp(args: DispatchArgs): Promise<unknown> {
    return this.bridge.focus(args.name ?? '')
  }

  private async synthesizeOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for synthesize operation')
    return this.bridge.synthesize(args.name, args.source ?? '', args.type ?? 'knowledge', args.role)
  }

  private async foundOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for found')
    return this.bridge.found(args.name, args.source ?? '', args.parent)
  }

  private async establishOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for establish')
    if (!args.source) throw new Error('source is required for establish')
    if (!args.org) throw new Error('org is required for establish')
    return this.bridge.establish(args.name, args.source, args.org)
  }

  private async hireOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for hire')
    if (!args.org) throw new Error('org is required for hire')
    return this.bridge.hire(args.name, args.org)
  }

  private async fireOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for fire')
    if (!args.org) throw new Error('org is required for fire')
    return this.bridge.fire(args.name, args.org)
  }

  private async appointOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for appoint')
    if (!args.position) throw new Error('position is required for appoint')
    if (!args.org) throw new Error('org is required for appoint')
    return this.bridge.appoint(args.name, args.position, args.org)
  }

  private async dismissOp(args: DispatchArgs): Promise<string> {
    if (!args.name) throw new Error('name is required for dismiss')
    if (!args.org) throw new Error('org is required for dismiss')
    return this.bridge.dismiss(args.name, args.org)
  }

  private async directoryOp(_args: DispatchArgs): Promise<unknown> {
    return this.bridge.directory()
  }

  // ---- 学习循环操作 ----

  private async reflectOp(args: DispatchArgs): Promise<unknown> {
    if (!args.encounters) throw new Error('encounters is required for reflect')
    return this.bridge.reflect(args.encounters, args.experience ?? '', args.id)
  }

  private async realizeOp(args: DispatchArgs): Promise<unknown> {
    if (!args.experiences) throw new Error('experiences is required for realize')
    return this.bridge.realize(args.experiences, args.principle ?? '', args.id)
  }

  private async masterOp(args: DispatchArgs): Promise<unknown> {
    if (!args.procedure) throw new Error('procedure is required for master')
    return this.bridge.master(args.procedure, args.id ?? '', args.experiences)
  }

  private async forgetOp(args: DispatchArgs): Promise<unknown> {
    if (!args.nodeId) throw new Error('nodeId is required for forget')
    return this.bridge.forget(args.nodeId)
  }

  private async skillOp(args: DispatchArgs): Promise<unknown> {
    if (!args.locator) throw new Error('locator is required for skill')
    return this.bridge.skill(args.locator)
  }

  // ---- 个体生命周期 ----

  private async retireOp(args: DispatchArgs): Promise<string> {
    if (!args.individual) throw new Error('individual is required for retire')
    return this.bridge.retire(args.individual)
  }

  private async dieOp(args: DispatchArgs): Promise<string> {
    if (!args.individual) throw new Error('individual is required for die')
    return this.bridge.die(args.individual)
  }

  private async rehireOp(args: DispatchArgs): Promise<string> {
    if (!args.individual) throw new Error('individual is required for rehire')
    return this.bridge.rehire(args.individual)
  }

  private async trainOp(args: DispatchArgs): Promise<string> {
    if (!args.individual) throw new Error('individual is required for train')
    if (!args.skillId) throw new Error('skillId is required for train')
    return this.bridge.train(args.individual, args.skillId, args.content ?? '')
  }

  // ---- 组织管理 ----

  private async charterOp(args: DispatchArgs): Promise<string> {
    if (!args.org) throw new Error('org is required for charter')
    if (!args.content) throw new Error('content is required for charter')
    return this.bridge.charter(args.org, args.content)
  }

  private async dissolveOp(args: DispatchArgs): Promise<string> {
    if (!args.org) throw new Error('org is required for dissolve')
    return this.bridge.dissolve(args.org)
  }

  // ---- 职位管理 ----

  private async chargeOp(args: DispatchArgs): Promise<string> {
    if (!args.position) throw new Error('position is required for charge')
    if (!args.content) throw new Error('content is required for charge')
    return this.bridge.charge(args.position, args.content)
  }

  private async requireOp(args: DispatchArgs): Promise<string> {
    if (!args.position) throw new Error('position is required for require')
    if (!args.skill) throw new Error('skill is required for require')
    return this.bridge.require(args.position, args.skill)
  }

  private async abolishOp(args: DispatchArgs): Promise<string> {
    if (!args.position) throw new Error('position is required for abolish')
    return this.bridge.abolish(args.position)
  }

  // ---- 跨 V1/V2 归档/恢复（走 RoleLifecycle） ----

  /**
   * 批量归档角色。
   *
   * 输入：args.roleIds (string[])，无前缀 = V1，"v2:" 前缀 = V2
   * 输出：{ operation: 'archive', results: Array<{ version, id, ok, error? }> }
   */
  private async archiveOp(args: DispatchArgs): Promise<DispatchResult> {
    if (!Array.isArray(args.roleIds) || args.roleIds.length === 0) {
      throw new Error('roleIds (non-empty array) is required for archive operation')
    }
    const results = await RoleLifecycle.archiveBatch(args.roleIds)
    const failures = results.filter((r) => !r.ok)
    if (failures.length > 0) {
      logger.warn(
        `[RolexActionDispatcher] archive ${failures.length}/${results.length} failed:`,
        failures as unknown as Error,
      )
    }
    return { operation: 'archive', total: results.length, failed: failures.length, results }
  }

  /**
   * 批量取消归档。
   */
  private async unarchiveOp(args: DispatchArgs): Promise<DispatchResult> {
    if (!Array.isArray(args.roleIds) || args.roleIds.length === 0) {
      throw new Error('roleIds (non-empty array) is required for unarchive operation')
    }
    const results = await RoleLifecycle.unarchiveBatch(args.roleIds)
    const failures = results.filter((r) => !r.ok)
    if (failures.length > 0) {
      logger.warn(
        `[RolexActionDispatcher] unarchive ${failures.length}/${results.length} failed:`,
        failures as unknown as Error,
      )
    }
    return { operation: 'unarchive', total: results.length, failed: failures.length, results }
  }

  /**
   * KNUTH-HARDENING 2026-07-05: 物理删除（不可恢复）。
   *
   * 与 archive 区分：archive = 软删除可恢复；delete = 硬删除不可恢复。
   * 默认拒绝删除系统保护角色（luban/nuwa/dayu/jiangziya/sean），
   * `args.force === true` 时可绕过。
   *
   * 输入：args.roleIds (string[]), args.force (boolean 可选)
   * 输出：{ operation: 'delete', total, failed, protected, results }
   */
  private async deleteOp(args: DispatchArgs): Promise<DispatchResult> {
    if (!Array.isArray(args.roleIds) || args.roleIds.length === 0) {
      throw new Error('roleIds (non-empty array) is required for delete operation')
    }
    const force = !!args.force
    const results = await RoleLifecycle.deleteBatch(args.roleIds, { force })
    const failures = results.filter((r) => !r.ok)
    const protectedCount = results.filter((r) => r.protected).length
    if (protectedCount > 0 && !force) {
      logger.warn(
        `[RolexActionDispatcher] delete denied for ${protectedCount} protected role(s) (force=false). Pass force=true to override.`,
      )
    }
    if (failures.length > 0) {
      logger.warn(
        `[RolexActionDispatcher] delete ${failures.length}/${results.length} failed:`,
        failures as unknown as Error,
      )
    }
    return {
      operation: 'delete',
      total: results.length,
      failed: failures.length,
      protected: protectedCount,
      force,
      results,
    }
  }

  /**
   * 检查指定角色是否为 V2 角色
   */
  async isV2Role(roleId: string): Promise<boolean> {
    return this.bridge.isV2Role(roleId)
  }
}
