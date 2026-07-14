import type { ToolWithHandler, ToolEventBus } from '~/interfaces/MCPServer.js';
import { MCPOutputAdapter } from '~/utils/MCPOutputAdapter.js';
import { safeEmit } from './_emit.js';

const outputAdapter = new MCPOutputAdapter();

// KNUTH-FEAT 2026-07-11 (M4): 每工具独立 closure bus state
let _learningEventBus: ToolEventBus | null = null
const PRODUCER = 'tool:learning'
const PRODUCER_VERSION = '2.4.1'

function emitLearning(operation: string, role: string | undefined, args: Record<string, unknown>): void {
  safeEmit(_learningEventBus, {
    type: `learning.${operation}`,
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

export function createLearningTool(enableV2: boolean): ToolWithHandler {
  const description = `V2 role cognitive learning cycle - reflect, distill principles, and teach knowledge

## Operations

| Operation | Required Params | Description |
|-----------|----------------|-------------|
| reflect | encounters, experience | Create experience from encounters. Pass encounters:[] to create directly without consuming encounters. |
| realize | experiences, principle | Distill principles from existing experiences. experiences must be an array of experience IDs. |
| master | procedure | Create standard procedures (SOP) from principles. |
| forget | nodeId | Remove outdated knowledge node. |
| synthesize | name, source, role | Teach knowledge to **another** role. name = knowledge node ID under the target role; role = target role ID; source = Gherkin Feature knowledge text. |
| skill | locator | Load a skill resource (e.g., npm:@scope/package). |

## Learning Cycle

\`\`\`
reflect (create experience) → realize (distill principle) → master (create procedure) → synthesize (teach to others)
\`\`\`

## Key Rules

- All \`experience\`, \`principle\`, \`procedure\`, and \`source\` MUST use Gherkin Feature format
- \`reflect\`: pass \`encounters: []\` to create experience directly without consuming encounters
- \`realize\`: \`experiences\` must be an array of existing experience IDs
- \`synthesize\`: \`role\` is the **target** role (who receives knowledge), not the current role

## Examples

\`\`\`json
{ "operation": "reflect", "encounters": [], "experience": "Feature: API Design Experience\\n  Scenario: Problem\\n    Then learned to use pagination", "id": "exp-1" }
{ "operation": "realize", "experiences": ["exp-1"], "principle": "Feature: API Principle\\n  Scenario: Always paginate\\n    Then use cursor-based pagination", "id": "p-1" }
{ "operation": "master", "procedure": "Feature: API SOP\\n  Scenario: New endpoint\\n    When creating endpoint\\n    Then add pagination\\n    And add rate limiting", "id": "sop-1" }
{ "operation": "synthesize", "role": "backend-dev", "name": "api-knowledge", "source": "Feature: API Best Practices...", "type": "knowledge" }
{ "operation": "forget", "nodeId": "outdated-id" }
\`\`\`

## Prerequisites

A V2 role must be activated first via the \`action\` tool before using learning operations (except synthesize).`;

  const tool: ToolWithHandler = {
    name: 'learning',
    description,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['reflect', 'realize', 'master', 'forget', 'synthesize', 'skill'],
          description: 'Learning operation to perform'
        },
        role: {
          type: 'string',
          description: 'Active role ID. If omitted, uses the currently active role. For synthesize, this is the target role ID.'
        },
        name: {
          type: 'string',
          description: 'Knowledge name for synthesize operation'
        },
        source: {
          type: 'string',
          description: 'Gherkin source text for synthesize operation'
        },
        type: {
          type: 'string',
          description: 'Synthesize type: "knowledge", "experience", or "voice"'
        },
        id: {
          type: 'string',
          description: 'Custom ID for the created node (reflect/realize/master)'
        },
        encounters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Encounter IDs for reflect. Pass [] to create experience directly'
        },
        experiences: {
          type: 'array',
          items: { type: 'string' },
          description: 'Experience IDs for realize. Must be existing experience IDs'
        },
        experience: {
          type: 'string',
          description: 'Gherkin Feature text for reflect operation'
        },
        principle: {
          type: 'string',
          description: 'Gherkin Feature text for realize operation'
        },
        procedure: {
          type: 'string',
          description: 'Gherkin Feature text for master operation'
        },
        nodeId: {
          type: 'string',
          description: 'Node ID to remove for forget operation'
        },
        locator: {
          type: 'string',
          description: 'Resource locator for skill (e.g., npm:@scope/package)'
        }
      },
      // KNUTH-FIX 2026-07-13 (Bug 6): role 非必填。
      // reflect 用 encounters；synthesize 的 role 是目标角色。未传时用当前激活角色。
      required: ['operation']
    },
    handler: async (args: Record<string, any>) => {
      const operation = args.operation;
      const core = await import('@promptx/core');
      const coreExports = core.default || core;

      // KNUTH-FEAT 2026-07-10: 内容契约 M3 — actAs 前置校验（synthesize 除外，因为
      // synthesize.role 是目标 role，不要求当前 active）。抛错让 handleError 设 isError。
      if (args.role && args.role !== '_' && operation !== 'synthesize') {
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

      // 检查角色是否为 V1（不支持 learning 操作）
      // synthesize 的 role 是目标角色，不做检查
      if (args.role && args.role !== '_' && operation !== 'synthesize') {
        try {
          const isV2 = await dispatcher.isV2Role(args.role);
          if (!isV2) {
            return outputAdapter.convertToMCPFormat({
              type: 'error',
              content: `❌ V1 角色 "${args.role}" 不支持 learning 工具

learning 工具仅支持 V2 角色（RoleX）。V1 角色（DPML）请使用 recall/remember 工具管理知识。

**V1 角色知识管理**：
• \`recall\` - 检索角色记忆
• \`remember\` - 保存新知识

**如需使用 learning 工具**，请先创建 V2 角色：
\`\`\`json
{ "operation": "born", "name": "my-role", "source": "Feature: ..." }
\`\`\``
            });
          }
        } catch (e) {
          console.warn('[learning] V2 role check failed, continuing:', e);
        }
      }

      // BUG-FIX 2026-07-13 (Bug 3): 必填参数批量校验。
      // dispatcher 逐字段抛错（如 "encounters is required for reflect"），
      // 此处一次性报告缺失字段，避免 AI 多次尝试。
      const requiredByOp: Record<string, string[]> = {
        reflect: ['encounters'],
        realize: ['experiences'],
        master: ['procedure'],
        synthesize: ['name'],
        forget: ['nodeId'],
        skill: ['locator'],
      }
      const required = requiredByOp[operation]
      if (required) {
        const missing = required.filter((f) => args[f] === undefined || args[f] === null || args[f] === '')
        if (missing.length) {
          return outputAdapter.convertToMCPFormat({
            type: 'error',
            content: `❌ ${operation} 操作缺少必填参数: ${missing.join(', ')}\n\n各操作必填参数:\n  reflect: encounters, experience\n  realize: experiences, principle\n  master: procedure\n  synthesize: name, source, role\n  forget: nodeId\n  skill: locator`,
          });
        }
      }

      const result = await dispatcher.dispatch(operation, args);
      // KNUTH-FEAT 2026-07-11 (M4): 成功路径 emit learning.<operation>
      emitLearning(operation, args.role, args)
      return outputAdapter.convertToMCPFormat(result);
    }
  };

  // KNUTH-FEAT 2026-07-11 (M4): setEventBus 注入器
  ;(tool as ToolWithHandler & { setEventBus: (bus: ToolEventBus | null) => void }).setEventBus = (
    bus: ToolEventBus | null,
  ) => {
    _learningEventBus = bus
  }
  return tool
}

/** 测试钩子 */
export function _resetLearningEventBus(): void {
  _learningEventBus = null
}

export const learningTool: ToolWithHandler = createLearningTool(true);
