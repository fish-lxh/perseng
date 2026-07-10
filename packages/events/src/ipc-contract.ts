/**
 * IPC 契约 — 渲染层调用 EventStore 时用的 type 集合
 *
 * 命名对齐 TimelinePanel 既有的 legacy 字段名（sessionId / types / roles 等）
 * 同时新增 producer / correlationId 给 V2 视图用。
 *
 * M1 出 type，M3 PR 接入 desktop IPC。
 */

import type { EventRole, EventStoreFilter, EventStoreQueryOptions } from './types.js'

/** renderer 友好的查询过滤器 V2 */
export interface TimelineQueryFilterV2 extends EventStoreFilter {
  /** 与 EventStore 同步 */
  type?: string
  types?: string[]
  /** 与 legacy role 概念对齐（事件级 role） */
  roles?: EventRole[]
}

/** renderer 调 IPC 时的完整 options */
export interface IpcQueryOptions extends EventStoreQueryOptions {
  roles?: EventRole[]
}

/**
 * 与 legacy TimelineQueryFilter 兼容的窄集（M3 写入说明文件用）
 */
export type LegacyCompatFilter = Pick<
  TimelineQueryFilterV2,
  'sessionId' | 'agentId' | 'imageId' | 'types' | 'roles' | 'sinceTs' | 'untilTs'
>
