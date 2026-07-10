/**
 * action tool — MCP 主入口（role / skill / persona 激活 + V2 life cycle 子集）
 *
 * KNUTH-FEAT 2026-07-11 (M4): 接入 Runtime Event Platform。
 *
 * 埋事件策略（A3 严格执行 — 成功路径才 emit）：
 * - activate (V1)         → action.activate
 * - activate (V2 force)   → action.activate
 * - activate (V2 auto)    → action.activate
 * - born                  → action.born
 * - identity              → action.identity
 * - archive               → action.archive
 * - unarchive             → action.unarchive
 * - delete                → action.delete
 *
 * 失败 / 抛错 / dispatcher 返回 falsy → 不 emit。
 *
 * 调用顺序：
 *   await dispatcher.dispatch()
 *   safeEmit(...)                       ← 在这之前任何抛错都不会 emit
 *   return outputAdapter.convert(...)
 */

import type { ToolWithHandler, ToolEventBus } from '~/interfaces/MCPServer.js';
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js';
import { safeEmit } from './_emit.js';

const outputAdapter = new MCPOutputAdapter()

// producerVersion: 与 package.json 同步；后续 PR 抽常量
const PRODUCER_VERSION = '2.4.1'
const PRODUCER = 'tool:action'

// 闭包共享的 bus state — 通过 setEventBus() 注入；tests 里也用得到
let _actionEventBus: ToolEventBus | null = null

/**
 * Build envelope + safeEmit. 失败也不会影响主流程。
 */
function emitAction(args: {
  operation: string
  version?: string
  role?: string
  result?: unknown
}): void {
  safeEmit(_actionEventBus, {
    type: `action.${args.operation}`,
    ts: Date.now(),
    role: 'system',
    producer: PRODUCER,
    producerVersion: PRODUCER_VERSION,
    schemaVersion: 1,
    sessionId: null,
    agentId: null,
    payload: {
      role: args.role ?? null,
      operation: args.operation,
      version: args.version ?? null,
      versionHint: 'v1',
    },
  })
}

export function createActionTool(enableV2: boolean): ToolWithHandler {
  const description = `Role activation & creation - load role knowledge, memory and capabilities

## Core Features

**V1 Roles (DPML)**: Load role config (persona, principles, knowledge), display memory network.${enableV2 ? `
**V2 Roles (RoleX)**: Create and activate V2 roles with full lifecycle support.

On activate, version is auto-detected: V2 takes priority, falls back to V1 if not found.
Use \`version\` parameter to force a specific version: \`"v1"\` for DPML, \`"v2"\` for RoleX.` : ''}

## Cognitive Cycle

1. See task → \`recall(role, null)\` scan full memory landscape
2. Multi-round \`recall\` → drill down by picking keywords from the network
3. Compose answer → combine memory + pretrained knowledge
4. \`remember\` → persist new knowledge, expand the network

## Built-in Roles

| ID | Name | Responsibility |
|---|---|---|
| luban | 鲁班 | ToolX tool development |
| nuwa | 女娲 | AI role creation |
| sean | Sean | Product decisions |
| jiangziya | 姜子牙 | AI role design & industry transformation |
| dayu | 大禹 | Role migration & org management |

> System roles require exact ID match. Use \`discover\` to list all available roles.

## Examples

**Activate a role (V1 or V2 auto-detect):**
\`\`\`json
{ "role": "luban" }
\`\`\`
${enableV2 ? `
**Create a V2 role:**
\`\`\`json
{ "operation": "born", "role": "_", "name": "my-dev", "source": "Feature: Developer\\n  As a developer..." }
\`\`\`

**Get role identity:**
\`\`\`json
{ "operation": "identity", "role": "my-dev" }
\`\`\`

**Force V1 activation:**
\`\`\`json
{ "role": "nuwa", "version": "v1" }
\`\`\`
` : ''}
## On-Demand Resource Loading (V1 Roles)

By default, only **personality** (persona + thought patterns) is loaded to save context.
Use \`roleResources\` to load additional sections **before** you need them:

- **Before executing tools or tasks** → load \`principle\` first
- **When facing unfamiliar professional questions** → load \`knowledge\` first
- **When you need full role capabilities at once** → load \`all\`

\`\`\`json
{ "role": "nuwa", "roleResources": "principle" }
{ "role": "nuwa", "roleResources": "knowledge" }
{ "role": "nuwa", "roleResources": "all" }
\`\`\`
${enableV2 ? `
## Related Tools

After activating a V2 role, use these tools for further operations:
- **lifecycle**: Goal & task management (want → plan → todo → finish → achieve)
- **learning**: Cognitive cycle (reflect → realize → master → synthesize)
- **organization**: Org, position & personnel management
` : ''}
## Guidelines

- Choose the right role for the task; suggest switching when out of scope
- Act as the activated role, maintain its professional traits
- Use \`discover\` first when a role is not found`;

  const operationEnum = enableV2
    ? ['activate', 'born', 'identity', 'archive', 'unarchive', 'delete']
    : ['activate'];

  const tool: ToolWithHandler = {
    name: 'action',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: operationEnum,
          description: enableV2
            ? 'Operation: activate (default), born (create V2 role), identity (view role info), archive (archive role), unarchive (restore archived role)'
            : 'Operation type. Default: activate.'
        },
        role: {
          type: 'string',
          description: 'Role ID to activate, e.g.: copywriter, product-manager, java-backend-developer'
        },
        roleResources: {
          type: 'string',
          enum: ['all', 'personality', 'principle', 'knowledge'],
          description: 'Resources to load for V1 roles: all, personality, principle, knowledge'
        },
        ...(enableV2 ? {
          name: {
            type: 'string',
            description: 'Role name for born operation'
          },
          source: {
            type: 'string',
            description: 'Gherkin source text for born operation'
          },
          version: {
            type: 'string',
            enum: ['v1', 'v2'],
            description: 'Force role version: "v1" for DPML, "v2" for RoleX. Auto-detected if omitted.'
          },
          // KNUTH-FEAT 2026-07-04: 迁移完成后自动归档对应的 V1 角色
          archiveV1: {
            type: 'array',
            items: { type: 'string' },
            description: 'V1 role IDs to auto-archive after successful born (migration completion)'
          },
          // KNUTH-FEAT 2026-07-04: archive / unarchive 操作的批量角色 ID 列表
          // 无前缀 = V1（按 ~/.perseng/resource/role/<id>），"v2:" 前缀 = V2 bridge.retire/rehire
          roleIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Role IDs to archive/unarchive (batch). Use "v2:" prefix for V2 roles.'
          },
          // KNUTH-HARDENING 2026-07-05: 物理删除 (force)：默认拒绝系统角色，true 绕过护栏
          force: {
            type: 'boolean',
            description: 'Allow deleting system-protected roles (escape hatch). Use with extreme caution.'
          }
        } : {})
      },
      required: ['role']
    },
    handler: async (args: {
      role: string;
      operation?: string;
      roleResources?: string;
      name?: string;
      source?: string;
      version?: string;
      archiveV1?: string[];
      roleIds?: string[];
      force?: boolean;
    }) => {
      const operation = args.operation || 'activate';

      // V2 disabled: always use V1
      if (!enableV2) {
        return activateV1(args)
      }

      // born / identity / archive / unarchive / delete → 走 RoleX 路径（统一通过 dispatcher）
      if (operation === 'born' || operation === 'identity' || operation === 'archive' || operation === 'unarchive' || operation === 'delete') {
        const core = await import('@promptx/core');
        const coreExports = core.default || core;
        const { RolexActionDispatcher } = (coreExports as any).rolex;
        const dispatcher = new RolexActionDispatcher();
        const result = await dispatcher.dispatch(operation, args);
        // emit 后调 convertToMCPFormat — 抛错也不阻断
        emitAction({ operation, role: args.role })
        return outputAdapter.convertToMCPFormat(result);
      }

      // 强制 V1
      if (args.version === 'v1') {
        return activateV1(args)
      }

      // 强制 V2
      if (args.version === 'v2') {
        const core = await import('@promptx/core');
        const coreExports = core.default || core;

        // KNUTH-FEAT 2026-07-10: V2 path 也加 actAs 前置校验。
        try {
          const actAs = (coreExports as any).actAs;
          if (typeof actAs === 'function') {
            await actAs(args.role, { fallback: 'throw' });
          }
        } catch (e: any) {
          throw new Error(`角色 '${args.role}' 不存在。\n\n${e?.message || ''}\n\n请使用 discover 工具查看可用角色。`);
        }

        const { RolexActionDispatcher } = (coreExports as any).rolex;
        const dispatcher = new RolexActionDispatcher();
        const result = await dispatcher.dispatch('activate', args);
        emitAction({ operation: 'activate', version: 'v2', role: args.role })
        return outputAdapter.convertToMCPFormat(result);
      }

      // 自动检测：先检查 V2，命中则走 RoleX，否则走 V1
      try {
        const core = await import('@promptx/core');
        const coreExports = core.default || core;

        // KNUTH-FEAT 2026-07-10: V2 path 也加 actAs 前置校验。
        try {
          const actAs = (coreExports as any).actAs;
          if (typeof actAs === 'function') {
            await actAs(args.role, { fallback: 'throw' });
          }
        } catch (e: any) {
          throw new Error(`角色 '${args.role}' 不存在。\n\n${e?.message || ''}\n\n请使用 discover 工具查看可用角色。`);
        }

        const { RolexActionDispatcher } = (coreExports as any).rolex;
        const dispatcher = new RolexActionDispatcher();

        if (await dispatcher.isV2Role(args.role)) {
          const result = await dispatcher.dispatch('activate', args);
          if (result) {
            emitAction({ operation: 'activate', version: 'v2', role: args.role })
            return outputAdapter.convertToMCPFormat(result);
          }
          console.warn(`[action] V2 activate returned empty for ${args.role}, falling back to V1`);
        }
      } catch (e: any) {
        console.warn(`[action] V2 path failed for ${args.role}, falling back to V1:`, e?.message || e);
      }

      return activateV1(args)
    }
  };

  // KNUTH-FEAT 2026-07-11 (M4): setEventBus 注入器 — 每个工具独立绑定 closure。
  ;(tool as ToolWithHandler & { setEventBus: (bus: ToolEventBus | null) => void }).setEventBus = (
    bus: ToolEventBus | null,
  ) => {
    _actionEventBus = bus
  }
  return tool
}

/** 测试钩子 — 重置 bus state */
export function _resetActionEventBus(): void {
  _actionEventBus = null
}

async function activateV1(args: { role: string; roleResources?: string }) {
  console.info(`[action] Activating V1 (DPML) for role: ${args.role}`);
  const core = await import('@promptx/core');
  const coreExports = core.default || core;

  // KNUTH-FEAT 2026-07-10: 内容契约 M3 — 激活前置 actAs 校验。
  // I-1：未知 role 必须抛错（让 MCPOutputAdapter 走 handleError 分支设置 isError: true），
  // **不能**返回 success — 否则 AI 客户端会把错误文本当成 tool result，触发"即兴扮演"。
  try {
    const actAs = (coreExports as any).actAs;
    if (typeof actAs === 'function') {
      await actAs(args.role, { fallback: 'throw' });
    }
  } catch (e: any) {
    // 抛错让 outputAdapter.convertToMCPFormat 走 handleError → 返回 isError: true
    throw new Error(`角色 '${args.role}' 不存在。\n\n${e?.message || ''}\n\n请使用 discover 工具查看可用角色。`);
  }

  const cli = (coreExports as any).cli || (coreExports as any).pouch?.cli;

  if (!cli || !cli.execute) {
    throw new Error('CLI not available in @promptx/core');
  }

  const result = await cli.execute('action', [args.role, args.roleResources]);
  // KNUTH-FEAT 2026-07-11 (M4): V1 activate 成功 → emit action.activate (v1)
  emitAction({ operation: 'activate', version: 'v1', role: args.role })
  return outputAdapter.convertToMCPFormat(result);
}

// 向后兼容导出（默认启用 V2）
export const actionTool: ToolWithHandler = createActionTool(true);
