/**
 * Replay 服务 — 把事件流 fold 回 projection 状态
 *
 * 设计约束（M2 全面落地）：
 * - 纯 fold over rows；handler 不能有副作用
 * - 时间区间 ASC by (ts, id) → 确定性输出
 * - 100 次 replay 同一序列必须 hash 相同（determinism test 测这点）
 *
 * 关键实现点：
 * - 同步 streaming：从 EventStore.queryRange() 一次性拿所有 row（store 是同步 better-sqlite3）
 * - 从 initial state 开始 fold，每次调用 projection.reduce(state, row)
 * - sessionId / agentId / type 等可选过滤维度由 store 侧处理
 * - from='epoch' = 0；to='now' = Date.now()
 */

import type { EventStore } from './EventStore.js'
import type { EventStoreFilter, EventStoreRow } from './types.js'
import type { Projection } from './Projection.js'
import { validatePure } from './Projection.js'

export interface ReplayOptions<S = unknown> {
  projection: Projection<S>
  /** 起点 epoch ms（默认 'epoch' = 0） */
  from?: number | 'epoch'
  /** 终点 epoch ms（默认 'now' = Date.now()） */
  to?: number | 'now'
  /** 子集过滤 — session / agent / type 等 */
  filter?: EventStoreFilter
}

/**
 * Resolve a ReplayOption numeric boundary to an ms epoch.
 * Sentinel 'epoch' = 0; 'now' = the moment of the call.
 * Wrapping in a getter keeps callers from caching stale values across replays.
 */
function boundToMs(v: number | 'epoch' | 'now' | undefined, fallback: number): number {
  if (v === undefined) return fallback
  if (v === 'epoch') return 0
  if (v === 'now') return Date.now()
  return v
}

/**
 * Replay events through a projection.
 *
 * Returns the final state (type `S`) — initial if no rows match.
 *
 * Steps:
 * 1. Validate the projection is pure (best-effort; not all violations detectable).
 * 2. Resolve [from, to] to ms timestamps.
 * 3. Stream rows from store in (ts ASC, id ASC) via `queryRange`.
 * 4. Fold: state = projection.reduce(state, row).
 * 5. Return final state.
 */
export async function replay<S>(
  store: EventStore,
  options: ReplayOptions<S>,
): Promise<S> {
  const p = options.projection
  const guard = validatePure(p)
  if (!guard.ok) {
    // 不抛 — 让 caller 决定怎么处理；只 warn
    // eslint-disable-next-line no-console
    console.warn(
      `[replay] projection '${p.name}' failed validatePure: ${guard.reason}`,
    )
  }

  const fromMs = boundToMs(options.from, 0)
  const toMs = boundToMs(options.to, Number.MAX_SAFE_INTEGER)
  const filter = options.filter ?? {}

  // queryRange 内部已经 ASC by (ts, id)，从 from (inclusive) 到 to (inclusive)
  const rows: EventStoreRow[] = await store.queryRange(fromMs, toMs, filter)

  let state: S = p.initial
  for (const row of rows) {
    state = p.reduce(state, row)
  }
  return state
}
