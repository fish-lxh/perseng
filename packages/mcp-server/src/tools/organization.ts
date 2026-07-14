import type { ToolWithHandler, ToolEventBus } from '~/interfaces/MCPServer.js';
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js';
import { safeEmit } from './_emit.js';

const outputAdapter = new MCPOutputAdapter();

// KNUTH-FEAT 2026-07-11 (M4): 每工具独立 closure bus state
let _organizationEventBus: ToolEventBus | null = null
const PRODUCER = 'tool:organization'
const PRODUCER_VERSION = '2.4.1'

function emitOrganization(operation: string, role: string | undefined, args: Record<string, unknown>): void {
  safeEmit(_organizationEventBus, {
    type: `organization.${operation}`,
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
      org: (args['org'] as string | undefined) ?? null,
      position: (args['position'] as string | undefined) ?? null,
      individual: (args['individual'] as string | undefined) ?? null,
    },
  })
}

export function createOrganizationTool(enableV2: boolean): ToolWithHandler {
  const description = `V2 organization, position, and individual management

## Organization Operations

| Operation | Required Params | Description |
|-----------|----------------|-------------|
| found | name, source | Create a new organization |
| charter | org, content | Set organization charter |
| dissolve | org | Dissolve an organization |
| directory | (none) | View organization directory |

## Position Operations

| Operation | Required Params | Description |
|-----------|----------------|-------------|
| establish | name, source, org | Create a position in an organization |
| charge | position, content | Assign responsibilities to a position |
| require | position, skill | Add skill requirement to a position |
| abolish | position | Remove a position |

## Personnel Operations

| Operation | Required Params | Description |
|-----------|----------------|-------------|
| hire | name, org | Hire a role into an organization |
| fire | name, org | Remove a role from an organization |
| appoint | name, position, org | Appoint a role to a position |
| dismiss | name, org | Dismiss a role from a position |
| retire | individual | Retire an individual |
| rehire | individual | Rehire a retired individual |
| die | individual | Permanently remove an individual |
| train | individual, skillId, content | Train an individual with a skill |

## Examples

\`\`\`json
{ "operation": "found", "name": "dev-team", "source": "Feature: Dev Team\\n  Build products..." }
{ "operation": "hire", "name": "my-dev", "org": "dev-team" }
{ "operation": "establish", "name": "tech-lead", "source": "Feature: Tech Lead...", "org": "dev-team" }
{ "operation": "appoint", "name": "my-dev", "position": "tech-lead", "org": "dev-team" }
{ "operation": "directory" }
\`\`\``;

  const tool: ToolWithHandler = {
    name: 'organization',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'found', 'charter', 'dissolve', 'directory',
            'establish', 'charge', 'require', 'abolish',
            'hire', 'fire', 'appoint', 'dismiss',
            'retire', 'rehire', 'die', 'train'
          ],
          description: 'Organization/position/personnel operation to perform'
        },
        role: {
          type: 'string',
          description: 'Active role ID. If omitted, uses the currently active role.'
        },
        name: {
          type: 'string',
          description: 'Name of the organization (found), position (establish), or individual (hire/fire/appoint/dismiss)'
        },
        source: {
          type: 'string',
          description: 'Gherkin source text for found/establish operations'
        },
        org: {
          type: 'string',
          description: 'Target organization name'
        },
        parent: {
          type: 'string',
          description: 'Parent organization name for nested orgs (found)'
        },
        position: {
          type: 'string',
          description: 'Position name for appoint/charge/require/abolish'
        },
        individual: {
          type: 'string',
          description: 'Individual ID for retire/die/rehire/train'
        },
        skillId: {
          type: 'string',
          description: 'Skill ID for train operation'
        },
        skill: {
          type: 'string',
          description: 'Skill name for require operation'
        },
        content: {
          type: 'string',
          description: 'Content for charter/charge/train operations'
        }
      },
      // KNUTH-FIX 2026-07-13 (Bug 6): role 非必填。
      // found 用 name，directory 无必填。未传时用当前激活角色。
      required: ['operation']
    },
    handler: async (args: Record<string, any>) => {
      const operation = args.operation;
      const core = await import('@promptx/core');
      const coreExports = core.default || core;

      // KNUTH-FEAT 2026-07-10: 内容契约 M3 — actAs 前置校验。抛错让 handleError 设 isError。
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

      // organization 操作大部分不需要 _requireActiveRole，
      // 但仍然检查非 "_" 的角色是否为 V1，给出友好提示
      if (args.role && args.role !== '_') {
        try {
          const isV2 = await dispatcher.isV2Role(args.role);
          if (!isV2) {
            return outputAdapter.convertToMCPFormat({
              type: 'error',
              content: `❌ V1 角色 "${args.role}" 不支持 organization 工具

organization 工具仅支持 V2 角色（RoleX）。

**如需使用 organization 工具**，请先创建 V2 角色：
\`\`\`json
{ "operation": "born", "name": "my-role", "source": "Feature: ..." }
\`\`\``
            });
          }
        } catch (e) {
          console.warn('[organization] V2 role check failed, continuing:', e);
        }
      }

      let result;
      try {
        // 批量校验必填参数（dispatcher 一次只抛一个错，这里一次性报全缺失字段）
        const requiredByOp: Record<string, string[]> = {
          found: ['name'],
          establish: ['name', 'source', 'org'],
          hire: ['name', 'org'],
          fire: ['name', 'org'],
          appoint: ['name', 'position', 'org'],
          dismiss: ['name', 'org'],
          retire: ['individual'],
          die: ['individual'],
          rehire: ['individual'],
          train: ['individual', 'skillId'],
          charter: ['org', 'content'],
          dissolve: ['org'],
          charge: ['position', 'content'],
          require: ['position', 'skill'],
          abolish: ['position'],
        }
        const required = requiredByOp[operation]
        if (required) {
          const missing = required.filter((f) => args[f] === undefined || args[f] === null || args[f] === '')
          if (missing.length) {
            return outputAdapter.convertToMCPFormat({
              type: 'error',
              content: `❌ ${operation} 操作缺少必填参数: ${missing.join(', ')}\n\n各操作必填参数:\n  found: name\n  establish: name, source, org\n  hire/fire/dismiss: name, org\n  appoint: name, position, org\n  retire/die/rehire: individual\n  train: individual, skillId\n  charter: org, content\n  dissolve: org\n  charge: position, content\n  require: position, skill\n  abolish: position\n  directory: 无（列出全部组织）`,
            });
          }
        }
        result = await dispatcher.dispatch(operation, args);
      } catch (e: any) {
        // KNUTH-FEAT 2026-07-11 (M4): 失败路径不 emit
        return outputAdapter.convertToMCPFormat({
          type: 'error',
          content: `❌ RoleX V2 操作失败: ${e?.message || String(e)}`
        });
      }
      // KNUTH-FEAT 2026-07-11 (M4): 成功路径 emit organization.<operation>
      emitOrganization(operation, args.role, args)
      return outputAdapter.convertToMCPFormat(result);
    }
  };

  // KNUTH-FEAT 2026-07-11 (M4): setEventBus 注入器
  ;(tool as ToolWithHandler & { setEventBus: (bus: ToolEventBus | null) => void }).setEventBus = (
    bus: ToolEventBus | null,
  ) => {
    _organizationEventBus = bus
  }
  return tool
}

/** 测试钩子 */
export function _resetOrganizationEventBus(): void {
  _organizationEventBus = null
}

export const organizationTool: ToolWithHandler = createOrganizationTool(true);
