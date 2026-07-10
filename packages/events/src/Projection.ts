/**
 * Projection — replay 用的纯 fold handler
 *
 * 关键约束：
 * - 纯函数 reduce(state, event) → state'
 * - 不允许 Date.now / Math.random / setTimeout / 任何 I/O
 * - validatePure 在注册时跑一次（runtime guard，best-effort）
 *
 * M2 实现完整 API；M1 先把 interface 占位导出以便 EventBus 等后续模块 type-only 引用。
 */

import type { EventStoreRow } from './types.js'

export interface Projection<S> {
  readonly name: string
  readonly initial: S
  reduce(state: S, event: EventStoreRow): S
}

/**
 * Best-effort 运行时校验 — 通过函数源码字符串扫描禁用符号。
 *
 * 注意：仅 AST-级检查，不做完整沙盒。
 * 对于"自己写的 fold 函数"够用；防御外部恶意代码不在范围内。
 */
export function validatePure<S>(p: Projection<S>): { ok: boolean; reason?: string } {
  const fnSrc = p.reduce.toString()
  const banned: Array<[string, RegExp]> = [
    ['Date.now', /\bDate\.now\s*\(/],
    ['new Date', /\bnew\s+Date\s*\(/],
    ['Math.random', /\bMath\.random\s*\(/],
    ['setTimeout', /\bsetTimeout\s*\(/],
    ['setInterval', /\bsetInterval\s*\(/],
    ['fetch', /\bfetch\s*\(/],
    ['process.env', /\bprocess\.env\b/],
  ]
  for (const [name, re] of banned) {
    if (re.test(fnSrc)) {
      return { ok: false, reason: `reduce uses banned API: ${name}` }
    }
  }
  return { ok: true }
}
