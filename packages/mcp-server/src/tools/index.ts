/**
 * 工具集合导出
 *
 * KNUTH-FEAT 2026-07-11 (批次 1 / RFC 目标 3.1):
 * `createAllTools(enableV2)` 内部走 MapToolRegistry — 把硬编码 ToolWithHandler[]
 * 升级为声明式 registry 装配。
 *
 * 行为保持不变：仍然返回 ToolWithHandler[]，向后兼容。
 * 后续批次（3.7 manifest 声明）会细化每个工具的 manifest；本批次只把装配点
 * 移到 registry，使 PersengMCPServer 后续能直接消费 registry.list()。
 */

// Perseng 核心工具
export { discoverTool, createDiscoverTool } from './welcome.js';
export { actionTool, createActionTool } from './action.js';
// projectTool 已从 MCP 工具列表剔除（§14.1 优化）：工作区绑定由 CLI/Desktop 启动时
// 自动注入（cli.execute('project')），不再暴露给大模型以减少 base token。
// CLI 命令 `promptx project <path>` 仍走 cli.execute('project')，project.ts 实现保留。
// export { projectTool } from './project.js';
// export { learnTool } from './learn.js';  // 暂时禁用 learn 工具
export { recallTool } from './recall.js';
export { rememberTool } from './remember.js';
export { toolxTool } from './toolx.js';
export { queryTimelineTool, clearTimelineTool } from './timeline.js';

// V2 拆分工具
export { lifecycleTool, createLifecycleTool } from './lifecycle.js';
export { learningTool, createLearningTool } from './learning.js';
export { organizationTool, createOrganizationTool } from './organization.js';

import { createDiscoverTool } from './welcome.js';
import { createActionTool } from './action.js';
// import { projectTool } from './project.js';  // §14.1: 不再注册给大模型
// import { learnTool } from './learn.js';  // 暂时禁用 learn 工具
import { recallTool } from './recall.js';
import { rememberTool } from './remember.js';
import { toolxTool } from './toolx.js';
import { queryTimelineTool, clearTimelineTool } from './timeline.js';
import { createLifecycleTool } from './lifecycle.js';
import { createLearningTool } from './learning.js';
import { createOrganizationTool } from './organization.js';
import type { ToolWithHandler } from '~/interfaces/MCPServer.js';
import { MapToolRegistry, toToolWithHandler } from '~/registry/ToolRegistry.js';

/**
 * KNUTH-FEAT 2026-07-11 (批次 1 / 3.1):
 * 把每个工具的 ToolWithHandler 抽成 ToolRegistration，注册进 registry，
 * 然后用 toToolWithHandler 适配器把 registry 还原为 ToolWithHandler[]。
 *
 * 当前 manifest 字段是 placeholder（_manifestFor 内部按工具静态导出派生），
 * 等 3.7 工具 manifest 声明落地后再切换到 manifest.ts 导入。本批次保留
 * 装配点 + 测试覆盖，manifest 字段后续只是数据源切换。
 */
function _manifestFor(tool: { name: string; description?: string; inputSchema: unknown }, capabilities: string[] = []) {
  return {
    name: tool.name,
    version: '2.4.1',
    capabilities,
    dependencies: [],
    schemaVersion: 1 as const,
    inputSchema: tool.inputSchema as Parameters<typeof toToolWithHandler>[0]['manifest']['inputSchema'],
  }
}

/**
 * 根据 enableV2 标志创建工具列表（行为不变；装配路径走 MapToolRegistry）。
 *
 * 未来批次 PersengMCPServer.registerTools() 可直接复用 buildToolRegistry(enableV2)
 * 拿到 registry + tools，免去两轮遍历。
 */
export function buildToolRegistry(enableV2: boolean): MapToolRegistry {
  const registry = new MapToolRegistry()
  const register = (tool: ToolWithHandler, capabilities: string[] = []) => {
    registry.register({
      manifest: _manifestFor(tool, capabilities),
      handler: tool.handler,
      setEventBus: tool.setEventBus as unknown as ((bus: unknown) => void) | undefined,
    })
  }

  // Always-on tools
  register(createDiscoverTool(enableV2), ['role:discover', 'role:welcome'])
  register(createActionTool(enableV2), ['role:activate', 'role:born', 'role:identity', 'role:archive', 'role:delete'])
  // projectTool // §14.1: 不再下发
  // learnTool  // 暂时禁用
  register(recallTool, ['memory:recall'])
  register(rememberTool, ['memory:remember'])
  register(toolxTool, ['tool:execute'])
  register(queryTimelineTool, ['timeline:query'])
  register(clearTimelineTool, ['timeline:clear'])

  if (enableV2) {
    register(createLifecycleTool(enableV2), ['lifecycle:goal', 'lifecycle:plan', 'lifecycle:todo'])
    register(createLearningTool(enableV2), ['learning:reflect', 'learning:distill'])
    register(createOrganizationTool(enableV2), ['organization:memory', 'organization:resource'])
  }

  return registry
}

/**
 * 向后兼容：保持 ToolWithHandler[] 返回类型。
 * PersengMCPServer.registerTools() 现在可以同时拿到 registry（如果改用 buildToolRegistry）。
 */
export function createAllTools(enableV2: boolean): ToolWithHandler[] {
  return buildToolRegistry(enableV2).list().map(toToolWithHandler)
}

/**
 * 所有可用工具列表（向后兼容，默认启用 V2）
 */
export const allTools = createAllTools(true);
