/**
 * Replay 服务 — 把事件流 fold 回 projection 状态
 *
 * 关键约束（M2 全面落地，M1 出 stub 即可）：
 * - 纯 fold over rows；handler 不能有副作用
 * - 时间区间 ASC by (ts, id) → 确定性输出
 * - 100 次 replay 同一序列必须 hash 相同（determinism test 测这点）
 *
 * M1 只导出接口与 stub。M2 PR 提交完整实现 + 100x determinism 测试。
 */

import type { EventStore } from './EventStore.js'
import type { EventStoreFilter } from './types.js'
import type { Projection } from './Projection.js'

export interface ReplayOptions {
  projection: Projection<unknown>
  /** 起点 epoch ms（默认 'epoch' = 0） */
  from?: number | 'epoch'
  /** 终点 epoch ms（默认 'now' = Date.now()） */
  to?: number | 'now'
  /** 子集过滤 */
  filter?: EventStoreFilter
}

/**
 * Stub — M2 实现此函数。当前只读取并丢弃 rows，让 type imports 解析。
 *
 * TODO(M2)：把 queryRange(from, to, filter) 流式喂给 projection.reduce。
 */
export async function replay(
  _store: EventStore,
  _options: ReplayOptions,
): Promise<unknown> {
  // 占位 — M2 实现
  throw new Error('replay() not implemented yet — see M2 milestone')
}

/** re-export 类型，方便 import { replay, ReplayOptions, Projection } from '@promptx/events/replay' */
export type { Projection } from './Projection.js'
