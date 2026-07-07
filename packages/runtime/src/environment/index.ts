/**
 * Environment implementations
 *
 * @see packages/types/src/ecosystem/Environment.ts
 */

export { ClaudeEnvironment, type ClaudeEnvironmentConfig } from "./ClaudeEnvironment";
export { ClaudeReceptor, type ReceptorMeta } from "./ClaudeReceptor";
export { ClaudeEffector, type ClaudeEffectorConfig } from "./ClaudeEffector";
export { buildOptions, type EnvironmentContext } from "./buildOptions";
export {
  ContextManager,
  type AccumulatedUsage,
  type ContextWarningEvent,
  type ContextEvent,
  type ContextManagerOptions,
} from "./ContextManager";
