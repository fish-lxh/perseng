/**
 * ClaudeEnvironment - Claude SDK Environment (Receptor + Effector)
 *
 * Combines:
 * - ClaudeReceptor: Perceives Claude SDK responses → emits to SystemBus
 * - ClaudeEffector: Subscribes to SystemBus → sends to Claude SDK
 *
 * @see packages/types/src/ecosystem/Environment.ts
 */

import type { Environment, Receptor, Effector } from "@agentxjs/types/runtime/internal";
import { ClaudeReceptor } from "./ClaudeReceptor";
import { ClaudeEffector, type ClaudeEffectorConfig } from "./ClaudeEffector";
import type { ContextManager } from "./ContextManager";

/**
 * ClaudeEnvironment configuration
 *
 * KNUTH-FEAT 2026-07-07: 继承 ClaudeEffectorConfig + 新增 contextManager
 * (向后兼容, contextManager 不传时 ClaudeEffector 内部 no-op)
 */
export interface ClaudeEnvironmentConfig extends ClaudeEffectorConfig {
  /** KNUTH-FEAT 2026-07-07: 上下文压缩管理器, 传给 ClaudeEffector 用于实时 token 跟踪 */
  contextManager?: ContextManager | null;
}

/**
 * ClaudeEnvironment - Claude SDK Environment
 */
export class ClaudeEnvironment implements Environment {
  readonly name = "claude";
  readonly receptor: Receptor;
  readonly effector: Effector;

  private readonly claudeEffector: ClaudeEffector;

  constructor(config: ClaudeEnvironmentConfig) {
    const claudeReceptor = new ClaudeReceptor();
    // KNUTH-FEAT 2026-07-07: 把 contextManager 作为第 3 参数注入 ClaudeEffector
    const claudeEffector = new ClaudeEffector(config, claudeReceptor, config.contextManager);

    this.receptor = claudeReceptor;
    this.effector = claudeEffector;
    this.claudeEffector = claudeEffector;
  }

  /**
   * Warmup the environment (pre-initialize SDK)
   *
   * Call this early to reduce latency for the first user message.
   */
  async warmup(): Promise<void> {
    await this.claudeEffector.warmup();
  }

  /**
   * Dispose environment resources
   */
  dispose(): void {
    this.claudeEffector.dispose();
  }
}
