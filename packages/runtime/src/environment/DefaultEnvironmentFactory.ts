/**
 * DefaultEnvironmentFactory - Creates ClaudeEnvironment instances
 *
 * Default factory that creates ClaudeEnvironment using the provided LLM config.
 */

import type {
  EnvironmentFactory,
  EnvironmentCreateConfig,
  Environment,
} from "@agentxjs/types/runtime/internal";
import { ClaudeEnvironment } from "./ClaudeEnvironment";

/**
 * Default factory for creating ClaudeEnvironment
 */
export const defaultEnvironmentFactory: EnvironmentFactory = {
  create(config: EnvironmentCreateConfig): Environment {
    return new ClaudeEnvironment({
      agentId: config.agentId,
      apiKey: config.llmConfig.apiKey,
      baseUrl: config.llmConfig.baseUrl,
      model: config.llmConfig.model,
      systemPrompt: config.systemPrompt,
      cwd: config.cwd,
      resumeSessionId: config.resumeSessionId,
      mcpServers: config.mcpServers,
      onSessionIdCaptured: config.onSessionIdCaptured,
      // KNUTH-FEAT 2026-07-07: 透传 ContextManager 让 ClaudeEffector 实时跟踪 token
      // 字段来自 types-augment.d.ts 的声明合并
      contextManager: config.contextManager,
    });
  },
};
