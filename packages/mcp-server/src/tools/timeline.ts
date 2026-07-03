/**
 * 时间线 MCP 工具
 *
 * 暴露两个工具：
 *   - query_timeline: 查询活动事件流（AGENT 主动查自己的历史）
 *   - clear_timeline: 清空持久化事件（用户操作）
 *
 * 数据源：~/.perseng/timeline/events.db（与主进程共享，WAL 模式天然并发）
 */

import type { ToolWithHandler } from '~/interfaces/MCPServer.js'
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js'
import { getEventLog } from '~/timeline/index.js'
import type { EventRole, ClearScope } from '~/timeline/index.js'

const outputAdapter = new MCPOutputAdapter()

const ROLES: EventRole[] = [
  'user',
  'assistant',
  'tool_call',
  'tool_result',
  'system',
  'unknown',
]

/** 安全的 JSON.parse，失败回退原字符串 */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export const queryTimelineTool: ToolWithHandler = {
  name: 'query_timeline',
  description: `查询活动事件流时间线（AGENT 自己做过的事 + 用户消息 + 工具调用）

## 用途
当用户问"昨天/上周/上次我们聊了什么" / "我最近读了哪些文件" / "这段会话我们都做了什么"时调用此工具。
时间线数据由主进程自动写入（无需手动 record），包括：
- 用户消息 (role=user)
- 你的文字响应 (role=assistant)
- 工具调用 (role=tool_call)
- 工具结果 (role=tool_result)

## 典型用法

**1. 看最近 10 条活动（默认按时间倒序）：**
\`\`\`json
{ "limit": 10 }
\`\`\`

**2. 看某个时间窗内的活动：**
\`\`\`json
{ "sinceTs": 1719792000000, "untilTs": 1719878400000 }
\`\`\`

**3. 只看用户消息和 assistant 响应（不要工具细节）：**
\`\`\`json
{ "roles": ["user", "assistant"], "limit": 100 }
\`\`\`

**4. 翻页（用上次返回的 nextCursor）：**
\`\`\`json
{ "cursor": 73, "limit": 50 }
\`\`\`

**5. 按 sessionId 过滤：**
\`\`\`json
{ "sessionId": "abc-123" }
\`\`\`

## 返回结构
\`\`\`json
{
  "events": [ { id, ts, type, role, sessionId, agentId, imageId, payload } ],
  "nextCursor": 73,
  "total": 412
}
\`\`\`
- nextCursor 为 null 表示最后一页
- payload 是原始 SystemEvent.data 对象（已 JSON.parse）`,

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
      types: {
        type: 'array',
        items: { type: 'string' },
        description: '按事件类型过滤（SystemEvent.type 列表）',
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
    types?: string[]
    roles?: EventRole[]
    sinceTs?: number
    untilTs?: number
    limit?: number
    cursor?: number
    order?: 'asc' | 'desc'
  }) => {
    const log = getEventLog()
    const limit = args.limit ?? 50

    try {
      const rows = await log.query({
        sessionId: args.sessionId,
        agentId: args.agentId,
        imageId: args.imageId,
        types: args.types,
        roles: args.roles,
        sinceTs: args.sinceTs,
        untilTs: args.untilTs,
        cursor: args.cursor,
        order: args.order ?? 'desc',
        limit,
      })

      const total = await log.count({
        sessionId: args.sessionId,
        agentId: args.agentId,
        imageId: args.imageId,
        types: args.types,
        roles: args.roles,
        sinceTs: args.sinceTs,
        untilTs: args.untilTs,
      })

      const events = rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        type: r.type,
        role: r.role,
        sessionId: r.sessionId,
        agentId: r.agentId,
        imageId: r.imageId,
        payload: safeJsonParse(r.payload),
      }))

      const nextCursor =
        rows.length === limit && rows.length > 0 ? rows[rows.length - 1].id : null

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
  description: `⚠️ 清空持久化的时间线事件。此操作不可恢复。

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
\`\`\``,

  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['all', 'session', 'agent', 'image'] satisfies ClearScope[],
        default: 'all',
        description: '清空范围',
      },
      targetId: {
        type: 'string',
        description: '当 scope≠all 时必填（session/agent/image 的 id）',
      },
    },
  },

  handler: async (args: { scope?: ClearScope; targetId?: string }) => {
    const log = getEventLog()
    const scope = args.scope ?? 'all'

    try {
      const result = await log.clear({ scope, targetId: args.targetId })
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
