/**
 * 时间线 MCP 工具 (V2)
 *
 * 暴露两个工具：
 *   - query_timeline: 查询活动事件流（AGENT 主动查自己的历史）
 *   - clear_timeline: 清空持久化事件（用户操作）
 *
 * KNUTH-FEAT 2026-07-11 (M5 cutover): 数据源从 legacy `getEventLog()`
 * 切到 V2 `getEventStore()`（`~/.perseng/events/events.db`）。
 * 与 renderer Timeline UI 同源；AgentX 双写关闭后这是唯一数据源。
 */

import type { ToolWithHandler } from '~/interfaces/MCPServer.js'
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js'
import { getEventStore } from '@promptx/events'
import type {
  ClearFilter,
  EventRole,
  EventStoreFilter,
  EventStoreQueryOptions,
  EventStoreRow,
} from '@promptx/events'

const outputAdapter = new MCPOutputAdapter()

const ROLES: EventRole[] = [
  'user',
  'assistant',
  'tool_call',
  'tool_result',
  'system',
  'unknown',
]

/**
 * 把 V2 EventStoreRow 拍平为 MCP 客户端友好的形状：
 * - payload 已经是 parsed object（V2 store 内部 JSON.parse），直传
 * - 客户端不用关心 schemaVersion / producer / causation 这些 V2 内部字段
 */
function flattenRow(r: EventStoreRow): {
  id: number
  ts: number
  type: string
  role: EventRole
  producer: string
  sessionId: string | null
  agentId: string | null
  imageId: string | null
  payload: unknown
} {
  return {
    id: r.id,
    ts: r.ts,
    type: r.type,
    role: r.role,
    producer: r.producer,
    sessionId: r.sessionId,
    agentId: r.agentId,
    imageId: r.imageId,
    payload: r.payload,
  }
}

export const queryTimelineTool: ToolWithHandler = {
  name: 'query_timeline',
  description: `查询活动事件流时间线（V2 — events_v2 单源）

## 用途
当用户问"昨天/上周/上次我们聊了什么" / "我最近读了哪些文件" / "这段会话我们都做了什么"时调用此工具。
时间线数据由 Runtime Event Platform 统一持久化（无需手动 record），包括：
- core.actAs 激活（producer=core:actAs）
- MCP action / lifecycle / learning / organization 工具调用（producer=tool:*）
- AgentX runtime 事件（producer=runtime:agentx）

## 典型用法

**1. 看最近 10 条活动（默认按时间倒序）：**
\`\`\`json
{ "limit": 10 }
\`\`\`

**2. 看某个时间窗内的活动：**
\`\`\`json
{ "sinceTs": 1719792000000, "untilTs": 1719878400000 }
\`\`\`

**3. 只看用户消息和 assistant 响应：**
\`\`\`json
{ "roles": ["user", "assistant"], "limit": 100 }
\`\`\`

**4. 翻页（用上次返回的 nextCursor）：**
\`\`\`json
{ "cursor": 73, "limit": 50 }
\`\`\`

**5. 按 producer 过滤（看某个 producer 的全部事件）：**
\`\`\`json
{ "producer": "tool:action", "limit": 100 }
\`\`\`

## 返回结构
\`\`\`json
{
  "events": [ { id, ts, type, role, producer, sessionId, agentId, imageId, payload } ],
  "nextCursor": 73,
  "total": 412
}
\`\`\`
- nextCursor 为 null 表示最后一页
- payload 是 V2 envelope 的 payload 字段（已是 parsed object）`,

  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: '按 sessionId 过滤',
      },
      agentId: {
        type: 'string',
        description: '按 agentId 过滤',
      },
      imageId: {
        type: 'string',
        description: '按 imageId 过滤',
      },
      producer: {
        type: 'string',
        description: '按 producer 过滤（tool:action / core:actAs / runtime:agentx ...）',
      },
      types: {
        type: 'array',
        items: { type: 'string' },
        description: '按事件类型过滤（V2 envelope.type 列表）',
      },
      roles: {
        type: 'array',
        items: {
          type: 'string',
          enum: ROLES,
        },
        description: '按角色过滤（user/assistant/tool_call/tool_result/system/unknown）',
      },
      sinceTs: {
        type: 'number',
        description: '起始时间戳（毫秒）',
      },
      untilTs: {
        type: 'number',
        description: '结束时间戳（毫秒）',
      },
      limit: {
        type: 'number',
        default: 50,
        minimum: 1,
        maximum: 500,
        description: '单次返回条数上限（默认 50）',
      },
      cursor: {
        type: 'number',
        description: '翻页游标（= 上次返回的 nextCursor）',
      },
      order: {
        type: 'string',
        enum: ['asc', 'desc'],
        default: 'desc',
        description: '时间排序方向',
      },
    },
  },

  handler: async (args: {
    sessionId?: string
    agentId?: string
    imageId?: string
    producer?: string
    types?: string[]
    roles?: EventRole[]
    sinceTs?: number
    untilTs?: number
    limit?: number
    cursor?: number
    order?: 'asc' | 'desc'
  }) => {
    const store = getEventStore()
    if (!store) {
      return outputAdapter.convertToMCPFormat({
        type: 'error',
        content: 'EventStore unavailable — events 平台未初始化',
      })
    }
    const limit = args.limit ?? 50

    try {
      const queryOpts: EventStoreQueryOptions = {
        sessionId: args.sessionId,
        agentId: args.agentId,
        imageId: args.imageId,
        producer: args.producer,
        types: args.types,
        sinceTs: args.sinceTs,
        untilTs: args.untilTs,
        cursor: args.cursor,
        order: args.order ?? 'desc',
        limit,
      }

      const filter: EventStoreFilter = {
        sessionId: args.sessionId,
        agentId: args.agentId,
        imageId: args.imageId,
        producer: args.producer,
        types: args.types,
        sinceTs: args.sinceTs,
        untilTs: args.untilTs,
      }

      const [rowsAll, total] = await Promise.all([
        store.query(queryOpts),
        store.count(filter),
      ])

      // KNUTH-FEAT 2026-07-11 (M5): V2 EventStore SQL 层不支持 roles 过滤
      // （role 是 producer 标注的入参字段，不是查询维度）；legacy EventLog 支持。
      // 在 client-side 二次过滤保持工具对外接口稳定。代价：roles 过滤后 total 反映 SQL 数。
      const rows = args.roles && args.roles.length > 0
        ? rowsAll.filter((r) => args.roles!.includes(r.role))
        : rowsAll

      const events = rows.map(flattenRow)

      // KNUTH-FEAT 2026-07-11 (M5): cursor 用 id 严格小于 — V2 store 内部已按 (ts,id) 排序
      const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id ?? null : null

      return outputAdapter.convertToMCPFormat({
        type: 'text',
        content: JSON.stringify(
          {
            events,
            nextCursor,
            total,
            hint: nextCursor
              ? `还有更多结果，使用 cursor=${nextCursor} 翻页`
              : '已到最后一页',
          },
          null,
          2,
        ),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return outputAdapter.convertToMCPFormat({
        type: 'error',
        content: `query_timeline failed: ${msg}`,
      })
    }
  },
}

export const clearTimelineTool: ToolWithHandler = {
  name: 'clear_timeline',
  description: `⚠️ 清空持久化的时间线事件（V2 — events_v2）。此操作不可恢复。

## 用法

**清空全部（危险）：**
\`\`\`json
{ "scope": "all" }
\`\`\`

**清空某个 session：**
\`\`\`json
{ "scope": "session", "targetId": "abc-123" }
\`\`\`

**清空某个 agent 的所有事件：**
\`\`\`json
{ "scope": "agent", "targetId": "agent_xyz" }
\`\`\`

**清空某个 image 的所有事件：**
\`\`\`json
{ "scope": "image", "targetId": "img_789" }
\`\`\`

**清空某个 producer 的所有事件（如全部 tool:action）：**
\`\`\`json
{ "scope": "producer", "targetId": "tool:action" }
\`\`\``,

  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'session', 'agent', 'image', 'producer'],
        default: 'all',
        description: '清空范围（V2 多了 producer scope）',
      },
      targetId: {
        type: 'string',
        description: '当 scope≠all 时必填',
      },
    },
  },

  handler: async (args: { scope?: ClearFilter['scope']; targetId?: string }) => {
    const store = getEventStore()
    if (!store) {
      return outputAdapter.convertToMCPFormat({
        type: 'error',
        content: 'EventStore unavailable — events 平台未初始化',
      })
    }
    const scope = args.scope ?? 'all'

    try {
      const result = await store.clear({ scope, targetId: args.targetId })
      return outputAdapter.convertToMCPFormat({
        type: 'text',
        content: `✅ 已清空 ${result.deleted} 条事件（scope=${scope}${args.targetId ? `, targetId=${args.targetId}` : ''}）`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return outputAdapter.convertToMCPFormat({
        type: 'error',
        content: `clear_timeline failed: ${msg}`,
      })
    }
  },
}