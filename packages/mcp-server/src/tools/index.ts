/**
 * 工具集合导出 — manifest-first 装配 (3.7 P2)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3 / 批次 3):
 * tools/index.ts 现在从 ALL_MANIFESTS 拿到 tool metadata，handler 通过 name
 * 派生；保证装配顺序由 manifest 决定（稳定）。
 *
 * 行为保持不变：createAllTools 仍返回 ToolWithHandler[]；
 * PersengMCPServer 通过 registry 单一入口消费。
 */

// Perseng 核心工具
export { discoverTool, createDiscoverTool } from './welcome.js';
export { actionTool, createActionTool } from './action.js';
// projectTool 已从 MCP 工具列表剔除（§14.1 优化）
// CLI 命令 `promptx project <path>` 仍走 cli.execute('project')
export { recallTool } from './recall.js';
export { rememberTool } from './remember.js';
export { toolxTool } from './toolx.js';
export { queryTimelineTool, clearTimelineTool } from './timeline.js';

// V2 拆分工具
export { lifecycleTool, createLifecycleTool } from './lifecycle.js';
export { learningTool, createLearningTool } from './learning.js';
export { organizationTool, createOrganizationTool } from './organization.js';
// 调度系统工具（Phase 1）
export { scheduleTool, createScheduleTool } from './schedule.js';

// Manifest 聚合 — 给外部做 capability 查询用
export { ALL_MANIFESTS, findManifestsByCapability } from './manifests.js';

import { createDiscoverTool } from './welcome.js';
import { createActionTool } from './action.js';
import { recallTool } from './recall.js';
import { rememberTool } from './remember.js';
import { toolxTool } from './toolx.js';
import { queryTimelineTool, clearTimelineTool } from './timeline.js';
import { createLifecycleTool } from './lifecycle.js';
import { createLearningTool } from './learning.js';
import { createOrganizationTool } from './organization.js';
import { createScheduleTool } from './schedule.js';
import type { ToolWithHandler } from '~/interfaces/MCPServer.js';
import {
  MapToolRegistry,
  toToolWithHandler,
  type ToolRegistration,
} from '~/registry/ToolRegistry.js';
import { ALL_MANIFESTS } from './manifests.js';

/**
 * KNUTH-FEAT 2026-07-11 (3.7 P2): handler 由 manifest name 派生；
 * 装配顺序由 ALL_MANIFESTS 索引顺序决定（按 capability / 依赖稳定排序）。
 */
function handlerByName(name: string, enableV2: boolean): ToolWithHandler | null {
  switch (name) {
    case 'discover':       return createDiscoverTool(enableV2)
    case 'action':         return createActionTool(enableV2)
    case 'recall':         return recallTool
    case 'remember':       return rememberTool
    case 'toolx':          return toolxTool
    case 'timeline':       return queryTimelineTool
    case 'lifecycle':      return enableV2 ? createLifecycleTool(enableV2) : null
    case 'learning':       return enableV2 ? createLearningTool(enableV2) : null
    case 'organization':   return enableV2 ? createOrganizationTool(enableV2) : null
    // KNUTH-FEAT 2026-07-18 (Phase 1): schedule 与 enableV2 正交；V1/V2 都能用
    case 'schedule':       return createScheduleTool(enableV2)
    default:                return null
  }
}

/**
 * 装配 MapToolRegistry：按 ALL_MANIFESTS 顺序遍历，按 name 找到 handler 注册。
 * enableV2 关闭时跳过 lifecycle / learning / organization。
 */
export function buildToolRegistry(enableV2: boolean): MapToolRegistry {
  const registry = new MapToolRegistry()
  for (const manifest of ALL_MANIFESTS) {
    const tool = handlerByName(manifest.name, enableV2)
    if (!tool) continue
    
    // KNUTH-FIX: Override manifest schema/description with actual tool schema/description
    // The actual tools (like rememberTool) have more detailed descriptions (with markdown) 
    // and correctly nested schemas (like array items) that are missing in the bare manifests.
    const enhancedManifest = {
      ...manifest,
      inputSchema: tool.inputSchema || manifest.inputSchema,
    }
    
    const reg: ToolRegistration = {
      manifest: enhancedManifest,
      handler: tool.handler,
      setEventBus: tool.setEventBus as unknown as ((bus: unknown) => void) | undefined,
    }
    // Store original description on handler so toToolWithHandler can extract it
    if (tool.description) {
      ;(reg.handler as any).description = tool.description;
    }
    registry.register(reg)
  }
  return registry
}

/**
 * 向后兼容 — 返回 ToolWithHandler[]。
 */
export function createAllTools(enableV2: boolean): ToolWithHandler[] {
  return buildToolRegistry(enableV2).list().map(toToolWithHandler)
}

/**
 * 所有可用工具列表（向后兼容，默认启用 V2）
 */
export const allTools = createAllTools(true);
