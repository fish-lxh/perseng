/**
 * ToolContext — 工具执行协议 (3.2 P0)
 *
 * KNUTH-FEAT 2026-07-11 (批次 1 / RFC 目标 3.2)
 *
 * 解决"9/11 工具 handler 内联 `await import('@promptx/core')`"的业务耦合死结。
 * 工具只依赖 ToolContext 接口，不依赖具体实现：
 * - trace:  请求级 trace context（sessionId / agentId / correlationId）
 * - envelope: 自动注入 trace + producer + producerVersion + schemaVersion 的 EnvelopeBuilder
 * - eventBus:  M4 已落地的 ToolEventBus（emit-only，向后兼容）
 * - logger:  平台 logger（@promptx/logger）
 *
 * 向后兼容：旧的 `(args) => Promise<ToolResponse>` 签名仍工作，由
 * BaseMCPServer.executeTool 通过 hasContextArg 探测，包装成 `(args, ctx) => handler(args)`。
 */

import type { Logger } from '@promptx/logger'
import type { ToolEventBus } from '~/interfaces/MCPServer.js'

// ============================================================================
// Trace Context — 请求级 trace 信息
// ============================================================================

export interface TraceContext {
  /** MCP 会话 ID（来自 MCP-Session-Id header / session） */
  readonly sessionId: string | null
  /** 目标 agent ID（来自请求参数或上一层 context） */
  readonly agentId: string | null
  /** 跨工具调用链路关联 ID（同一 AI 客户端 turn 内共享） */
  readonly correlationId: string | null
  /** 上一个事件的 EventStoreRow.id（用于 envelope.causation） */
  readonly causationId: number | null
}

export const NULL_TRACE: TraceContext = {
  sessionId: null,
  agentId: null,
  correlationId: null,
  causationId: null,
}

// ============================================================================
// EnvelopeBuilder — 自动填充 producer/version/schemaVersion
// ============================================================================

/**
 * V2 EventEnvelope 的最小形状（避免 mcp-server 对 @promptx/events 类型硬依赖）。
 * 真实事件通过 EventStore.append 写入；
 * 这里只关心"我要造的 envelope"应满足的形状。
 */
export interface BuilderEnvelope {
  type: string
  ts: number
  ingestedAt: number
  sessionId: string | null
  agentId: string | null
  imageId: string | null
  role: import('@promptx/events').EventRole
  producer: string
  producerVersion: string
  schemaVersion: 1
  causation: number | null
  tenantId: string | null
  ownerId: string | null
  payload: unknown
}

export interface EnvelopeBuilder {
  /** 按 type/payload 构造 envelope，自动从 ctx 补 sessionId/agentId/ts 等 */
  create<T = unknown>(args: { type: string; payload: T; role?: import('@promptx/events').EventRole }): BuilderEnvelope
}

// ============================================================================
// ToolContext — 工具 handler 可见的全部协议资源
// ============================================================================

export interface ToolContext {
  readonly trace: TraceContext
  readonly envelope: EnvelopeBuilder
  readonly eventBus: ToolEventBus | null
  readonly logger: Logger
}

const NOOP_LOGGER: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => NOOP_LOGGER,
} as unknown as Logger

/** 兜底 context — 给"ctx 还没注入"的代码路径用（例如测试裸调 handler） */
export const NULL_CONTEXT: ToolContext = {
  trace: NULL_TRACE,
  envelope: createEnvelopeBuilder(NULL_TRACE, 'unknown', '0.0.0'),
  eventBus: null,
  logger: NOOP_LOGGER,
}

// ============================================================================
// EnvelopeBuilder 工厂
// ============================================================================

/**
 * 工厂：按 ctx 构造 EnvelopeBuilder。
 * 同一个 ctx 闭包，builder 自动从 ctx.trace 派生 sessionId/agentId/causation。
 */
export function createEnvelopeBuilder(trace: TraceContext, producer: string, producerVersion: string): EnvelopeBuilder {
  return {
    create<T>({ type, payload, role = 'system' }: { type: string; payload: T; role?: import('@promptx/events').EventRole }): BuilderEnvelope {
      const ts = Date.now()
      return {
        type,
        ts,
        ingestedAt: ts,
        sessionId: trace.sessionId,
        agentId: trace.agentId,
        imageId: null,
        role,
        producer,
        producerVersion,
        schemaVersion: 1 as const,
        causation: trace.causationId,
        tenantId: null,
        ownerId: null,
        payload,
      }
    },
  }
}

// ============================================================================
// 工具 handler 新签名 + 向后兼容 adapter
// ============================================================================

/** 工具 handler 响应（与 MCPServer.ts ToolHandler 内部一致） */
export interface ToolResponse {
  content: Array<{
    type: string
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

/**
 * 工具 handler 新签名（V2） — 接受 ctx 作为第二个参数。
 * 旧签名 `(args) => Promise<ToolResponse>` 通过 invokeHandler 适配。
 */
export type ToolHandlerV2 = (args: any, ctx: ToolContext) => Promise<ToolResponse>

/**
 * 探测 handler 是否接受 ctx 参数（arity 启发式判断，避免运行时反射）。
 *
 * 规则：
 * - handler.length >= 2 → 视为 V2 签名
 * - handler.length <= 1 → 视为 V1 签名，调用时传单参
 *
 * 现状覆盖：M4 之前所有 handler 都是 `(args) => ...` 单参（handler.length === 1）。
 */
export function handlerAcceptsCtx(handler: (...args: any[]) => unknown): boolean {
  return handler.length >= 2
}

/**
 * 把 ctx 包装到 handler 调用上：
 * - 如果 handler 接受 ctx（V2），原样调用 `(args, ctx)`
 * - 否则（V1），单参调用 `(args)` 并吞掉 ctx
 */
export async function invokeHandler(
  handler: (...args: any[]) => Promise<unknown>,
  args: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  if (handlerAcceptsCtx(handler)) {
    return await handler(args, ctx)
  }
  return await (handler as (a: unknown) => Promise<unknown>)(args)
}