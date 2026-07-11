/**
 * Built-in Prompt Providers — 3 个内置 (3.4 P2)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.4 / 批次 3)
 *
 * - RoleActivationPrompt  role-activation      → 角色激活提示词
 * - ReflectCyclePrompt    reflect-cycle        → learning 反思循环
 * - LifecycleGoalPrompt   lifecycle-goal       → lifecycle want→plan→todo
 *
 * 静态文案 — 不依赖 @promptx/core，运行时直接拿到结构化 Prompt。
 */

import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js'
import type { PromptProvider } from '~/registry/PromptRegistry.js'

function makeText(name: string, msgs: Array<{ role: 'user' | 'assistant'; text: string }>): GetPromptResult {
  return {
    description: undefined,
    messages: msgs.map((m) => ({
      role: m.role,
      content: { type: 'text', text: m.text },
    })),
  }
}

// ============================================================================
// RoleActivationPrompt
// ============================================================================

export const RoleActivationPrompt: PromptProvider = {
  name: 'role-activation',
  description: 'Role activation prompt — guides AI client through activating a role via action tool',
  arguments: [
    { name: 'role', description: 'Role ID to activate', required: true },
  ],
  async get(args): Promise<GetPromptResult> {
    const role = args['role'] ?? '<role-id>'
    return {
      description: `Activate role "${role}"`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `请激活角色 \`${role}\`：调用 action 工具完成激活。\n\n` +
              `**激活流程**：\n` +
              `1. 调用 \`action\` 工具（operation=activate, role="${role}"）\n` +
              `2. 等待 tool result 返回加载的角色 knowledge + principles\n` +
              `3. 严格按激活角色的 persona / principle 回答用户后续问题\n` +
              `4. 每次回答前调用 \`recall(${role}, null)\`（DMN 全扫），再 drilldown 关键词\n` +
              `5. 把每次新产生的 knowledge 通过 \`remember(${role}, <engrams>)\` 沉淀\n\n` +
              `当前可用角色列表请通过 MCP resource \`perseng://roles\` 拉取。`,
          },
        },
      ],
    }
  },
}

// ============================================================================
// ReflectCyclePrompt
// ============================================================================

export const ReflectCyclePrompt: PromptProvider = {
  name: 'reflect-cycle',
  description: 'Reflect cycle prompt — learning tool reflect→realize→master chain',
  arguments: [
    { name: 'role', description: 'Role performing reflection', required: true },
    { name: 'experience', description: 'Raw experience text (Feature/Scenario/Then)', required: true },
  ],
  async get(args): Promise<GetPromptResult> {
    const role = args['role'] ?? '<role-id>'
    const experience = args['experience'] ?? '<experience text>'
    return {
      description: `Reflect cycle for role "${role}"`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `请按 learning 工具的反思循环对以下经验进行沉淀（角色：\`${role}\`）：\n\n` +
              `## 输入经验\n${experience}\n\n` +
              `## 三步循环（每步调用对应 learning operation）\n` +
              `1. **reflect** — 把经验创建为 ATOMIC engram\n` +
              `   \`{ operation: 'reflect', role: '${role}', id: '<id>', encounters: [...], experience: '...' }\`\n` +
              `2. **realize** — 总结成原则 (LINK)\n` +
              `   \`{ operation: 'realize', role: '${role}', id: '<id>', from: '<reflect-id>', principle: '...' }\`\n` +
              `3. **master** — 沉淀为 SOP (PATTERN)\n` +
              `   \`{ operation: 'master', role: '${role}', id: '<id>', from: '<realize-id>', sop: '...' }\`\n\n` +
              `**完成后**：调用 \`audit(${role})\` 或 \`recall(${role}, 'reflect')\` 验证沉淀成功。`,
          },
        },
      ],
    }
  },
}

// ============================================================================
// LifecycleGoalPrompt
// ============================================================================

export const LifecycleGoalPrompt: PromptProvider = {
  name: 'lifecycle-goal',
  description: 'Lifecycle goal prompt — want→plan→todo chain',
  arguments: [
    { name: 'role', description: 'Role managing the goal', required: true },
    { name: 'goal', description: 'Goal text', required: true },
  ],
  async get(args): Promise<GetPromptResult> {
    const role = args['role'] ?? '<role-id>'
    const goal = args['goal'] ?? '<goal>'
    return {
      description: `Lifecycle goal for role "${role}"`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `请按 lifecycle 工具链为角色 \`${role}\` 创建目标（want→plan→todo）：\n\n` +
              `## 目标\n${goal}\n\n` +
              `## 三阶段\n` +
              `1. **want** — 在心智里 seed 这个目标\n` +
              `   \`{ operation: 'want', role: '${role}', name: '<goal-name>', reason: '...' }\`\n` +
              `2. **plan** — 拆成 plan + todo 列表\n` +
              `   \`{ operation: 'plan', role: '${role}', name: '<goal-name>', id: '<plan-id>', todos: [{id: '<t1>', title: '...', depends?: [...]}] }\`\n` +
              `3. **focus** — 查看/拣选当前 in-progress 的 todo\n` +
              `   \`{ operation: 'focus', role: '${role}', name: '<goal-name>' }\`\n\n` +
              `完成后逐个 todo 用 \`finish\` / \`achieve\` / \`abandon\` 状态机流转。`,
          },
        },
      ],
    }
  },
}

export const BUILTIN_PROMPT_PROVIDERS: PromptProvider[] = [
  RoleActivationPrompt,
  ReflectCyclePrompt,
  LifecycleGoalPrompt,
] as const