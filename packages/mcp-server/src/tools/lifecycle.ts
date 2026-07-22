import type { ToolWithHandler, ToolEventBus } from '~/interfaces/MCPServer.js';
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js';
import { safeEmit } from './_emit.js';

const outputAdapter = new MCPOutputAdapter();

// KNUTH-FEAT 2026-07-11 (M4): 每工具独立 closure bus state
let _lifecycleEventBus: ToolEventBus | null = null
const PRODUCER = 'tool:lifecycle'
const PRODUCER_VERSION = '2.4.1'

function emitLifecycle(operation: string, role: string | undefined, args: Record<string, unknown>): void {
  safeEmit(_lifecycleEventBus, {
    type: `lifecycle.${operation}`,
    ts: Date.now(),
    role: 'system',
    producer: PRODUCER,
    producerVersion: PRODUCER_VERSION,
    schemaVersion: 1,
    sessionId: null,
    agentId: null,
    payload: {
      operation,
      role: role ?? null,
      name: (args['name'] as string | undefined) ?? null,
      id: (args['id'] as string | undefined) ?? null,
    },
  })
}

export function createLifecycleTool(enableV2: boolean): ToolWithHandler {
  const description = `V2 role goal & task lifecycle management

## Operations

| Operation | Required Params | Description |
|-----------|----------------|-------------|
| want | name, source | Create a goal for the active role |
| plan | source, **id** | Create a plan under the current goal. **id is REQUIRED** or todo will fail |
| todo | name, source | Create a task under the current plan |
| finish | name | Complete a task (creates an encounter node with ID: {name}-finished) |
| achieve | experience | Achieve the current goal with a reflection |
| abandon | experience | Abandon the current goal with a reason |
| focus | name | Switch focus to a specific goal/plan/task |

## Workflow

\`\`\`
want (create goal) → plan (create plan, MUST pass id) → todo (create tasks) → finish (complete tasks) → achieve (complete goal)
\`\`\`

## Examples

\`\`\`json
{ "operation": "want", "name": "build-api", "source": "Feature: Build REST API\\n  As a developer..." }
{ "operation": "plan", "source": "Feature: API Design\\n  Scenario: endpoints...", "id": "api-plan" }
{ "operation": "todo", "name": "implement-auth", "source": "Feature: Auth endpoint..." }
{ "operation": "finish", "name": "implement-auth", "encounter": "Encountered CORS issues..." }
{ "operation": "achieve", "experience": "learned REST best practices..." }
{ "operation": "focus", "name": "api-plan" }
\`\`\`

## Prerequisites

A V2 role must be activated first via the \`action\` tool before using lifecycle operations.`;

  const tool: ToolWithHandler = {
    name: 'lifecycle',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['want', 'plan', 'todo', 'finish', 'achieve', 'abandon', 'focus'],
          description: 'Lifecycle operation to perform'
        },
        role: {
          type: 'string',
          description: 'Active role ID. If omitted, uses the currently active role.'
        },
        name: {
          type: 'string',
          description: 'Name of the goal (want), task (todo/finish), or focus target (focus)'
        },
        source: {
          type: 'string',
          description: 'Gherkin Feature source text for want/plan/todo'
        },
        id: {
          type: 'string',
          description: 'Plan ID. REQUIRED for plan operation to set focused_plan_id'
        },
        testable: {
          type: 'boolean',
          description: 'Whether the goal/task is testable (for want/todo)'
        },
        experience: {
          type: 'string',
          description: 'Reflection text for achieve/abandon operations'
        },
        encounter: {
          type: 'string',
          description: 'Encounter description for finish operation'
        }
      },
      // KNUTH-FIX 2026-07-13 (Bug 6): role 非必填。
      // want/todo 等用 name；role 未传或 "_" 时 handler 自动用当前激活角色。
      required: ['operation']
    },
    handler: async (args: Record<string, any>) => {
      const operation = args.operation;
      // KNUTH-FIX 2026-07-22: operation 必填校验 — V2 路径缺少 operation 字段时
      // 会透传到 RolexActionDispatcher.dispatch 落到 default 分支抛
      // "Unknown RoleX operation: undefined"，错误信息对客户端无参考价值。
      // 这里一次性校验，给出可用 operation 列表 + V1/V2 区分。
      if (!operation || typeof operation !== 'string') {
        const allowedOps = ['want', 'plan', 'todo', 'finish', 'achieve', 'abandon', 'focus']
        throw new Error(
          `lifecycle 工具必须传 \`operation\` 字段。当前值: ${JSON.stringify(operation)}\n\n` +
          `可用 operations: ${allowedOps.join(', ')}\n\n` +
          `示例: {"operation": "want", "name": "my-goal", "source": "Feature: ..."}`,
        )
      }

      const core = await import('@promptx/core');
      const coreExports = core.default || core;

      // KNUTH-FEAT 2026-07-10: 内容契约 M3 — 先 actAs 校验角色是否在册。
      // I-1：未知 role 必须抛错（让 MCPOutputAdapter handleError 设置 isError: true），
      // 不能返回 success — 否则 AI 客户端把错误文本当 tool result 触发即兴扮演。
      if (args.role && args.role !== '_') {
        try {
          const actAs = (coreExports as any).actAs;
          if (typeof actAs === 'function') {
            await actAs(args.role, { fallback: 'throw' });
          }
        } catch (e: any) {
          throw new Error(`角色 '${args.role}' 不存在。\n\n${e?.message || ''}\n\n请使用 discover 工具查看可用角色。`);
        }
      }

      const { RolexActionDispatcher } = (coreExports as any).rolex;
      const dispatcher = new RolexActionDispatcher();

      // 检查角色是否为 V1（不支持 lifecycle 操作）
      if (args.role && args.role !== '_') {
        try {
          const isV2 = await dispatcher.isV2Role(args.role);
          if (!isV2) {
            return outputAdapter.convertToMCPFormat({
              type: 'error',
              content: `❌ 角色 "${args.role}" 是 V1（DPML）角色，不支持 lifecycle 工具

lifecycle 仅支持 V2（RoleX）角色的目标与任务管理。

**两个选择**：

A. 继续用 V1 角色 - 可用 recall/remember 管理知识，但不支持目标/任务管理

B. 创建 V2 角色以使用 lifecycle：
1. 创建 V2 角色：
\`\`\`json
{ "operation": "born", "name": "my-role", "source": "Feature: ..." }
\`\`\`
2. 激活: action({ "operation": "activate", "role": "my-role" })
3. 再调用 lifecycle 操作目标与任务`
            });
          }
        } catch (e) {
          // 检查失败时继续执行，让 dispatcher 自行处理
          console.warn('[lifecycle] V2 role check failed, continuing:', e);
        }
      }

      const result = await dispatcher.dispatch(operation, args);
      // KNUTH-FEAT 2026-07-11 (M4): 成功路径 emit lifecycle.<operation>
      emitLifecycle(operation, args.role, args)
      return outputAdapter.convertToMCPFormat(result);
    }
  };

  // KNUTH-FEAT 2026-07-11 (M4): setEventBus 注入器
  ;(tool as ToolWithHandler & { setEventBus: (bus: ToolEventBus | null) => void }).setEventBus = (
    bus: ToolEventBus | null,
  ) => {
    _lifecycleEventBus = bus
  }
  return tool
}

/** 测试钩子 */
export function _resetLifecycleEventBus(): void {
  _lifecycleEventBus = null
}

export const lifecycleTool: ToolWithHandler = createLifecycleTool(true);
