/**
 * 工具集合导出
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

/**
 * 根据 enableV2 标志创建工具列表（工具描述和行为随之变化）
 */
export function createAllTools(enableV2: boolean): ToolWithHandler[] {
  const tools: ToolWithHandler[] = [
    createDiscoverTool(enableV2),
    createActionTool(enableV2),
    // projectTool  // §14.1: 不再下发，CLI/Desktop 启动时自动绑定
    // learnTool,  // 暂时禁用 learn 工具
    recallTool,
    rememberTool,
    toolxTool,
    queryTimelineTool,
    clearTimelineTool
  ];

  // V2 拆分工具：仅在 enableV2 时注册
  if (enableV2) {
    tools.push(
      createLifecycleTool(enableV2),
      createLearningTool(enableV2),
      createOrganizationTool(enableV2)
    );
  }

  return tools;
}

/**
 * 所有可用工具列表（向后兼容，默认启用 V2）
 */
export const allTools = createAllTools(true);
