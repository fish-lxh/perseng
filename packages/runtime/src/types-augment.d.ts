/**
 * Module augmentation for @agentxjs/types/runtime/internal
 *
 * KNUTH-FEAT 2026-07-07: EnvironmentCreateConfig 需要带 contextManager 才能
 * 把 ContextManager 从 RuntimeAgent 透传给 ClaudeEnvironment → ClaudeEffector.
 *
 * 因为 @agentxjs/types 是已发布的依赖, 不能直接改 .d.ts, 所以用 TypeScript
 * declaration merging 在本包内扩展这个 interface.
 *
 * 如果将来 @agentxjs/types 也升级加这个字段, 这个 .d.ts 仍然兼容 (declaration
 * merging 允许重复声明同名字段).
 */

declare module "@agentxjs/types/runtime/internal" {
  interface EnvironmentCreateConfig {
    /**
     * KNUTH-FEAT 2026-07-07: 可选注入的 ContextManager, 传给 ClaudeEnvironment
     * → ClaudeEffector 用于实时 token 跟踪与阈值警告 emit.
     */
    contextManager?: import("./environment/ContextManager").ContextManager | null;
  }
}

export {};