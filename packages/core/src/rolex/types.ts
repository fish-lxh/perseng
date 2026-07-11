/**
 * KNUTH-FEAT 2026-07-11: Phase 3c — 为 RolexBridge 暴露的 V2 角色句柄补完整类型。
 * Rolex.activate() 返回 rolexjs 的 Role 类, 含 project/want/plan/todo/finish/reflect/realize/master/forget/skill
 * 等 30+ 方法, 这里只暴露桥接器订阅的子集。
 *
 * 优先复用 rolexjs 的 Role 接口; 仅在需要 facade 收口时再用 RoleLike。
 */
import type { Role as RolexRole } from 'rolexjs'

/** @rolexjs/core.activate() 返回值 (桥订阅的子集, 即整个 Role 表面) */
export type RolexActivationResult = RolexRole

/**
 * 本地 RoleLike — 仅在 mock/fake 测试场景用, 避免循环依赖 rolexjs。
 * 生产代码请直接用 RolexActivationResult (来自 rolexjs 的 Role)。
 */
export interface RoleLike {
  project(): Promise<string>
  want(goal: string, id: string, options?: Record<string, unknown>): Promise<string>
  plan(plan: string, id: string, after?: string, fallback?: string): Promise<string>
  todo(task: string, id: string, options?: Record<string, unknown>): Promise<string>
  finish(task: string, options?: Record<string, unknown>): Promise<string>
  abandon(experience?: string): Promise<string>
  focus(goal: string): Promise<string>
  reflect(encounters: unknown, experience: string, id?: string): Promise<string>
  realize(experiences: unknown, principle: string, id?: string): Promise<string>
  master(procedure: string, id: string, experiences?: unknown): Promise<string>
  forget(nodeId: string): Promise<string>
  skill(locator: string): Promise<string>
  synthesize(name: string, source: string, type: string, targetRole?: string): Promise<string>
  growup(name: string, source: string, type: string, targetRole?: string): Promise<string>
  found(name: string, source: string, parent?: string): Promise<string>
  establish(positionName: string, source: string, orgName?: string): Promise<string>
  hire(roleName: string, orgName: string): Promise<string>
  fire(roleName: string, orgName: string): Promise<string>
  appoint(roleName: string, positionName: string, orgName?: string): Promise<string>
  dismiss(roleName: string, orgName: string): Promise<string>
  charter(orgName: string, content: string): Promise<string>
  dissolve(orgName: string): Promise<string>
  charge(positionName: string, content: string): Promise<string>
  require(positionName: string, skillId: string): Promise<string>
  abolish(positionName: string): Promise<string>
}
