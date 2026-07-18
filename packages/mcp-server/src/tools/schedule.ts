/**
 * tools/schedule.ts — 调度系统管理工具 (Phase 1 / Commit 3)
 *
 * KNUTH-FEAT 2026-07-18 (Phase 1):
 *   设计稿 docs/scheduler-design.md §4 — 7 个 sub-op（不含 run_now）：
 *     create / list / get / pause / resume / delete / history
 *
 * 与 enableV2 正交：V1/V2 模式都能用（设计稿 §2.3）。
 * 走 ScheduleStore 单例（与 events 包同模式）；不发 actAs 校验（无 role 概念）。
 *
 * 事件埋点：type = `schedule.${operation}`，producer = `tool:schedule`。
 *
 * Commit 4 会在此基础上加第 8 个 sub-op `run_now`（注入 engineRef）。
 */

import { randomUUID } from 'node:crypto'
import type { ToolWithHandler, ToolEventBus } from '~/interfaces/MCPServer.js'
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js'
import { safeEmit } from './_emit.js'
import { getScheduleStore } from '~/scheduler/instance.js'
import { validate as validateCron } from '~/scheduler/CronParser.js'
import {
  DEFAULT_TIMEZONE,
  DEFAULT_TIMEOUT_MS,
  type ScheduleState,
} from '~/scheduler/types.js'

const outputAdapter = new MCPOutputAdapter()

// KNUTH-FEAT 2026-07-18 (Phase 1): schedule 工具 closure bus state
let _scheduleEventBus: ToolEventBus | null = null
const PRODUCER = 'tool:schedule'
const PRODUCER_VERSION = '2.4.1'

function emitSchedule(
  operation: string,
  args: Record<string, unknown>,
  payloadExtra: Record<string, unknown> = {},
): void {
  safeEmit(_scheduleEventBus, {
    type: `schedule.${operation}`,
    ts: Date.now(),
    role: 'system',
    producer: PRODUCER,
    producerVersion: PRODUCER_VERSION,
    schemaVersion: 1,
    sessionId: null,
    agentId: null,
    payload: {
      operation,
      id: (args['id'] as string | undefined) ?? null,
      name: (args['name'] as string | undefined) ?? null,
      toolName: (args['toolName'] as string | undefined) ?? null,
      cronExpr: (args['cronExpr'] as string | undefined) ?? null,
      ...payloadExtra,
    },
  })
}

/** per-op 必填参数批量校验（dispatcher 思路，参考 organization.ts:184-210） */
const requiredByOp: Record<string, string[]> = {
  create: ['name', 'cronExpr', 'toolName', 'toolArgs'],
  get: ['id'],
  pause: ['id'],
  resume: ['id'],
  delete: ['id'],
  history: ['id'],
  // list: 无必填
}

export function createScheduleTool(_enableV2: boolean): ToolWithHandler {
  const description = `调度系统管理工具 — 把任何工具按 cron 时间表自动执行

## Operations

| Operation | Required Params | Description |
|-----------|----------------|-------------|
| create | name, cronExpr, toolName, toolArgs | 新建 schedule（state 默认 pending） |
| list | (none) | 列出 schedule；可选 state / toolName 过滤 |
| get | id | 取单条 schedule 详情 |
| pause | id | 暂停（active/pending → paused） |
| resume | id | 恢复（paused → active） |
| delete | id | 软删除（state=deleted） |
| history | id | 列最近 N 条执行记录 |

## Examples

\`\`\`json
{ "operation": "create", "name": "morning-prep", "cronExpr": "0 9 * * 1-5", "timezone": "Asia/Shanghai", "toolName": "action", "toolArgs": { "operation": "recall", "role": "sean" } }
{ "operation": "list", "state": "active" }
{ "operation": "get", "id": "sched-abc" }
{ "operation": "pause", "id": "sched-abc" }
{ "operation": "resume", "id": "sched-abc" }
{ "operation": "delete", "id": "sched-abc" }
{ "operation": "history", "id": "sched-abc", "limit": 20 }
\`\`\`

## Notes

- 8th operation \`run_now\` 在 ScheduleEngine 落地后开放（Commit 4）
- create 时 \`cronExpr\` 必须可解析；非法会在响应里返回 error
- \`toolArgs\` 是传给目标工具的对象（与该工具的 inputSchema 对齐）
- 时区默认 \`Asia/Shanghai\`；可显式传任何 IANA 名`

  const tool: ToolWithHandler = {
    name: 'schedule',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'list', 'get', 'pause', 'resume', 'delete', 'history'],
          description: 'Schedule sub-operation to perform',
        },
        // create / update 入参
        id: {
          type: 'string',
          description: 'Schedule ID. Auto-generated (uuid v4) if omitted on create.',
        },
        name: {
          type: 'string',
          description: 'Human-readable schedule name (for create)',
        },
        description: {
          type: 'string',
          description: 'Optional description (for create)',
        },
        cronExpr: {
          type: 'string',
          description: 'Cron expression — 5- or 6-field (for create)',
        },
        timezone: {
          type: 'string',
          description: `IANA timezone. Default: ${DEFAULT_TIMEZONE} (for create)`,
        },
        toolName: {
          type: 'string',
          description: 'Target MCP tool name (for create) / filter (for list)',
        },
        toolArgs: {
          type: 'object',
          description: 'Arguments passed to target tool (for create)',
        },
        maxRetries: {
          type: 'number',
          description: 'Max retry count on failure (for create, default 0)',
        },
        timeoutMs: {
          type: 'number',
          description: `Per-execution timeout in ms (for create, default ${DEFAULT_TIMEOUT_MS})`,
        },
        notifyOnSuccess: {
          type: 'boolean',
          description: 'Emit success event (for create, default false)',
        },
        notifyOnFailure: {
          type: 'boolean',
          description: 'Emit failure event (for create, default true)',
        },
        // list / history 入参
        state: {
          type: 'string',
          enum: ['pending', 'active', 'paused', 'deleted'],
          description: 'Filter by state (for list)',
        },
        limit: {
          type: 'number',
          description: 'Max results (for list / history, default 100 / 50)',
        },
        since: {
          type: 'number',
          description: 'Lower bound on startedAt (unix ms, for history)',
        },
      },
      required: ['operation'],
    },
    handler: async (args: Record<string, any>) => {
      const operation: string = args.operation
      if (!operation || typeof operation !== 'string') {
        return outputAdapter.convertToMCPFormat({
          type: 'error',
          content: '❌ schedule 工具调用失败: operation 必填',
        })
      }

      // per-op 必填参数批量校验
      const required = requiredByOp[operation]
      if (required) {
        const missing = required.filter(
          (f) => args[f] === undefined || args[f] === null || args[f] === '',
        )
        if (missing.length) {
          return outputAdapter.convertToMCPFormat({
            type: 'error',
            content: `❌ ${operation} 操作缺少必填参数: ${missing.join(', ')}

各操作必填参数:
  create: name, cronExpr, toolName, toolArgs
  get/pause/resume/delete/history: id
  list: 无必填`,
          })
        }
      }

      try {
        const store = getScheduleStore()

        switch (operation) {
          case 'create': {
            const cronCheck = validateCron(String(args.cronExpr))
            if (!cronCheck.valid) {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ cron 表达式非法: ${cronCheck.error ?? 'unknown'}

请参考 https://crontab.guru/ 或使用 5 段 / 6 段标准格式`,
              })
            }
            const id = args.id && String(args.id).length > 0 ? String(args.id) : randomUUID()
            const created = store.create({
              id,
              name: String(args.name),
              description: args.description != null ? String(args.description) : null,
              cronExpr: String(args.cronExpr),
              timezone:
                typeof args.timezone === 'string' && args.timezone.length > 0
                  ? args.timezone
                  : DEFAULT_TIMEZONE,
              toolName: String(args.toolName),
              toolArgs:
                args.toolArgs && typeof args.toolArgs === 'object'
                  ? (args.toolArgs as Record<string, unknown>)
                  : {},
              maxRetries: typeof args.maxRetries === 'number' ? args.maxRetries : 0,
              timeoutMs:
                typeof args.timeoutMs === 'number' ? args.timeoutMs : DEFAULT_TIMEOUT_MS,
              notifyOnSuccess: args.notifyOnSuccess === true,
              notifyOnFailure: args.notifyOnFailure !== false,
              createdBy: 'mcp:schedule',
            })
            emitSchedule(operation, args, { state: created.state })
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: `✅ schedule 已创建（state=pending，待审核后激活）

${JSON.stringify(created, null, 2)}

调用 \`schedule operation=resume id=${created.id}\` 立即激活。`,
            })
          }

          case 'list': {
            const filter: { state?: ScheduleState; toolName?: string; limit?: number } = {}
            if (typeof args.state === 'string') filter.state = args.state as ScheduleState
            if (typeof args.toolName === 'string') filter.toolName = args.toolName
            if (typeof args.limit === 'number') filter.limit = args.limit
            const items = store.list(filter)
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: `📋 schedule 列表（${items.length} 条）\n\n${JSON.stringify(
                { count: items.length, schedules: items },
                null,
                2,
              )}`,
            })
          }

          case 'get': {
            const found = store.get(String(args.id))
            if (!found) {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 不存在`,
              })
            }
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: JSON.stringify(found, null, 2),
            })
          }

          case 'pause': {
            const cur = store.get(String(args.id))
            if (!cur) {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 不存在`,
              })
            }
            if (cur.state === 'paused') {
              return outputAdapter.convertToMCPFormat({
                type: 'success',
                content: `⏸ schedule '${args.id}' 已经是 paused 状态（无操作）`,
              })
            }
            if (cur.state === 'deleted') {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 已删除，无法 pause`,
              })
            }
            store.setState(String(args.id), 'paused')
            emitSchedule(operation, args, { fromState: cur.state, toState: 'paused' })
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: `⏸ schedule '${args.id}' 已暂停（${cur.state} → paused）`,
            })
          }

          case 'resume': {
            const cur = store.get(String(args.id))
            if (!cur) {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 不存在`,
              })
            }
            if (cur.state === 'active') {
              return outputAdapter.convertToMCPFormat({
                type: 'success',
                content: `▶ schedule '${args.id}' 已经是 active 状态（无操作）`,
              })
            }
            if (cur.state === 'deleted') {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 已删除，无法 resume`,
              })
            }
            if (cur.state !== 'paused' && cur.state !== 'pending') {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 当前 state=${cur.state}，无法 resume（只支持 paused/pending）`,
              })
            }
            store.setState(String(args.id), 'active')
            emitSchedule(operation, args, { fromState: cur.state, toState: 'active' })
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: `▶ schedule '${args.id}' 已激活（${cur.state} → active）`,
            })
          }

          case 'delete': {
            const cur = store.get(String(args.id))
            if (!cur) {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 不存在`,
              })
            }
            if (cur.state === 'deleted') {
              return outputAdapter.convertToMCPFormat({
                type: 'success',
                content: `🗑 schedule '${args.id}' 已经是 deleted 状态（无操作）`,
              })
            }
            store.delete(String(args.id))
            emitSchedule(operation, args, { fromState: cur.state, toState: 'deleted' })
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: `🗑 schedule '${args.id}' 已删除（软删，DB 行保留）`,
            })
          }

          case 'history': {
            const cur = store.get(String(args.id))
            if (!cur) {
              return outputAdapter.convertToMCPFormat({
                type: 'error',
                content: `❌ schedule '${args.id}' 不存在`,
              })
            }
            const filter: { scheduleId: string; limit?: number; since?: number } = {
              scheduleId: String(args.id),
            }
            if (typeof args.limit === 'number') filter.limit = args.limit
            if (typeof args.since === 'number') filter.since = args.since
            const runs = store.listRuns(filter)
            return outputAdapter.convertToMCPFormat({
              type: 'success',
              content: `📜 schedule '${args.id}' 执行历史（${runs.length} 条）\n\n${JSON.stringify(
                { count: runs.length, runs },
                null,
                2,
              )}`,
            })
          }

          default:
            return outputAdapter.convertToMCPFormat({
              type: 'error',
              content: `❌ 不支持的 operation: ${operation}`,
            })
        }
      } catch (e: any) {
        return outputAdapter.convertToMCPFormat({
          type: 'error',
          content: `❌ schedule 操作失败: ${e?.message || String(e)}`,
        })
      }
    },
  }

  // KNUTH-FEAT 2026-07-11 (M4): setEventBus 注入器
  ;(tool as ToolWithHandler & { setEventBus: (bus: ToolEventBus | null) => void }).setEventBus = (
    bus: ToolEventBus | null,
  ) => {
    _scheduleEventBus = bus
  }
  return tool
}

/** 测试钩子 */
export function _resetScheduleEventBus(): void {
  _scheduleEventBus = null
}

export const scheduleTool: ToolWithHandler = createScheduleTool(true)