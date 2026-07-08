/**
 * ClaudeEffector - Listens to SystemBus and sends to Claude SDK
 *
 * Subscribes to user_message events on SystemBus and sends to Claude SDK.
 * Manages request timeout using RxJS.
 */

import type { Effector, SystemBusConsumer } from "@agentxjs/types/runtime/internal";
import type { UserMessage } from "@agentxjs/types/agent";
import type { EventContext } from "@agentxjs/types/runtime";
import type { SDKMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { Subject, Subscription, TimeoutError } from "rxjs";
import { timeout } from "rxjs/operators";
import { createLogger } from "@agentxjs/common";
import { buildSDKUserMessage, formatClockNote } from "./helpers";
import type { ClaudeReceptor, ReceptorMeta } from "./ClaudeReceptor";
import { SDKQueryLifecycle } from "./SDKQueryLifecycle";
import { ContextManager } from "./ContextManager";

const logger = createLogger("environment/ClaudeEffector");

/** Default timeout in milliseconds (10 minutes) */
const DEFAULT_TIMEOUT = 600_000;

/**
 * MCP Server Config (SDK Compatible)
 * Re-exported from types for convenience.
 */
export type { McpServerConfig } from "@agentxjs/types/runtime";

/**
 * ClaudeEffector configuration
 */
export interface ClaudeEffectorConfig {
  /** Agent ID for filtering events (required) */
  agentId: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  sessionId?: string;
  resumeSessionId?: string;
  onSessionIdCaptured?: (sessionId: string) => void;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** MCP servers configuration */
  mcpServers?: Record<string, import("@agentxjs/types/runtime").McpServerConfig>;
  /**
   * Extra CLI flags for the Claude Code subprocess.
   * See EnvironmentContext.extraArgs for details and gateway compatibility notes.
   */
  extraArgs?: Record<string, string | null>;
  /** Extra environment variables injected into the Claude Code subprocess. */
  extraEnv?: Record<string, string>;
  /**
   * Inject a per-turn `[System Clock: ...]` prefix into every user message so
   * the model always knows real wall-clock time (LLMs otherwise have no sense
   * of "now"). Default: true. Disable for tests or contexts where deterministic
   * prompts are required.
   */
  enableClockInjection?: boolean;
}

/**
 * ClaudeEffector - Subscribes to SystemBus and sends to Claude SDK
 *
 * Uses SystemBusConsumer (read-only) because Effector only subscribes to events.
 * Delegates SDK lifecycle management to SDKQueryLifecycle.
 */
export class ClaudeEffector implements Effector {
  private readonly config: ClaudeEffectorConfig;
  private readonly receptor: ClaudeReceptor;
  private readonly queryLifecycle: SDKQueryLifecycle;
  /** KNUTH-FEAT 2026-07-07: token 用量跟踪 + 阈值警告. 可选注入. */
  private readonly contextManager: ContextManager | null;

  private currentMeta: ReceptorMeta | null = null;
  private wasInterrupted = false;

  /** Subject for tracking pending request - completes when result received */
  private pendingRequest$: Subject<void> | null = null;
  /** Subscription for timeout handling */
  private pendingSubscription: Subscription | null = null;
  /** Heartbeat timer during tool execution (keeps idle timeout from firing) */
  private toolHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: ClaudeEffectorConfig,
    receptor: ClaudeReceptor,
    contextManager?: ContextManager | null,
  ) {
    this.config = config;
    this.receptor = receptor;
    this.contextManager = contextManager ?? null;

    // Create SDK lifecycle with callbacks
    this.queryLifecycle = new SDKQueryLifecycle(
      {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        systemPrompt: config.systemPrompt,
        cwd: config.cwd,
        resumeSessionId: config.resumeSessionId,
        mcpServers: config.mcpServers,
        extraArgs: config.extraArgs,
        extraEnv: config.extraEnv,
      },
      {
        onStreamEvent: (msg) => this.handleStreamEvent(msg),
        onUserMessage: (msg) => this.handleUserMessage(msg),
        onResult: (msg) => this.handleResult(msg),
        onSessionIdCaptured: config.onSessionIdCaptured,
        onError: (error) => this.handleError(error),
        onListenerExit: (reason) => this.handleListenerExit(reason),
      }
    );
  }

  /**
   * Warmup the SDK (pre-initialize before first message)
   *
   * Call this early to reduce latency for the first user message.
   * Safe to call multiple times.
   */
  async warmup(): Promise<void> {
    await this.queryLifecycle.warmup();
  }

  /**
   * Connect to SystemBus consumer to subscribe to events
   */
  connect(consumer: SystemBusConsumer): void {
    logger.debug("ClaudeEffector connected to SystemBusConsumer", {
      agentId: this.config.agentId,
    });

    // Listen for user_message events
    consumer.on("user_message", async (event) => {
      const typedEvent = event as {
        type: string;
        data: UserMessage;
        requestId?: string;
        context?: EventContext;
      };

      // Filter by agentId
      if (typedEvent.context?.agentId !== this.config.agentId) {
        return;
      }

      const message = typedEvent.data;
      const meta: ReceptorMeta = {
        requestId: typedEvent.requestId || "",
        context: typedEvent.context || {},
      };
      await this.send(message, meta);
    });

    // Listen for interrupt events
    consumer.on("interrupt", (event) => {
      const typedEvent = event as {
        type: string;
        requestId?: string;
        context?: EventContext;
      };

      // Filter by agentId
      if (typedEvent.context?.agentId !== this.config.agentId) {
        return;
      }

      const meta: ReceptorMeta = {
        requestId: typedEvent.requestId || "",
        context: typedEvent.context || {},
      };
      this.interrupt(meta);
    });
  }

  /**
   * Send a message to Claude SDK
   *
   * Uses RxJS to manage request-response timeout correlation.
   */
  private async send(message: UserMessage, meta: ReceptorMeta): Promise<void> {
    this.wasInterrupted = false;
    this.currentMeta = meta;

    // Clean up previous pending request
    this.cleanupPendingRequest();

    const timeoutMs = this.config.timeout ?? DEFAULT_TIMEOUT;

    try {
      // Initialize SDK if needed
      await this.queryLifecycle.initialize();

      const sessionId = this.config.sessionId || "default";

      // KNUTH-FEAT: per-turn clock injection — keep `Date.now()` as close to
      // the network call as possible. Cost: ~30-40 tokens/turn.
      const clockNote =
        this.config.enableClockInjection === false ? undefined : formatClockNote();
      const sdkUserMessage = buildSDKUserMessage(message, sessionId, clockNote);

      logger.debug("Sending message to Claude", {
        content:
          typeof message.content === "string" ? message.content.substring(0, 80) : "[structured]",
        timeout: timeoutMs,
        requestId: meta.requestId,
      });

      // Create pending request with idle timeout (resets on each stream event)
      this.pendingRequest$ = new Subject<void>();
      this.pendingSubscription = this.pendingRequest$.pipe(timeout({ each: timeoutMs })).subscribe({
        complete: () => {
          logger.debug("Request completed within timeout", { requestId: meta.requestId });
        },
        error: (err) => {
          if (err instanceof TimeoutError) {
            logger.warn("Request idle timeout", { timeout: timeoutMs, requestId: meta.requestId });
            this.handleTimeout(meta);
          }
        },
      });

      // Send message via lifecycle
      this.queryLifecycle.send(sdkUserMessage);
    } catch (error) {
      this.cleanupPendingRequest();
      throw error;
    }
  }

  /**
   * Interrupt current operation
   */
  private interrupt(meta?: ReceptorMeta): void {
    logger.debug("Interrupting Claude query", { requestId: meta?.requestId });
    this.wasInterrupted = true;
    if (meta) {
      this.currentMeta = meta;
    }
    this.queryLifecycle.interrupt();
  }

  /**
   * Handle stream_event from SDK
   */
  private handleStreamEvent(msg: SDKMessage): void {
    if (this.currentMeta) {
      this.receptor.feed(msg as SDKPartialAssistantMessage, this.currentMeta);
      // Reset idle timeout on each stream event
      this.pendingRequest$?.next();

      // Detect tool execution starting: after message_delta(stop_reason=tool_use),
      // the SDK goes silent until the tool completes. Start a heartbeat to keep
      // the idle timeout from firing during (potentially long) tool execution.
      const sdkEvent = (msg as SDKPartialAssistantMessage).event;
      if (sdkEvent?.type === "message_delta") {
        const delta = (sdkEvent as { delta?: { stop_reason?: string } }).delta;
        if (delta?.stop_reason === "tool_use") {
          this.startToolHeartbeat();
        }
      }

      // KNUTH-FEAT 2026-07-07: 提取 token usage + 累加 (message_start / message_delta)
      this.extractAndRecordUsage(msg);
    }
  }

  /**
   * Handle user message from SDK (contains tool_result)
   */
  private handleUserMessage(msg: SDKMessage): void {
    // Tool result arrived - stop heartbeat, execution is done
    this.stopToolHeartbeat();
    if (this.currentMeta) {
      this.receptor.feedUserMessage(msg as { message?: { content?: unknown[] } }, this.currentMeta);
      // Reset idle timeout: tool execution completed, activity resumed
      this.pendingRequest$?.next();
    }
  }

  /**
   * Handle result from SDK
   */
  private handleResult(msg: SDKMessage): void {
    // Complete pending request - cancels timeout
    this.completePendingRequest();

    const resultMsg = msg as {
      subtype: string;
      is_error?: boolean;
      errors?: string[];
      error?: { message?: string; type?: string };
      result?: string;
    };

    logger.info("SDK result received", {
      subtype: resultMsg.subtype,
      isError: resultMsg.is_error,
      wasInterrupted: this.wasInterrupted,
    });

    // KNUTH-FEAT 2026-07-07: result event 也含 usage (final turn 的 input + output)
    this.extractAndRecordUsage(msg);

    // Handle user interrupt
    if (resultMsg.subtype === "error_during_execution" && this.wasInterrupted) {
      this.receptor.emitInterrupted("user_interrupt", this.currentMeta || undefined);
      return;
    }

    // Handle SDK errors
    if (resultMsg.is_error && this.currentMeta) {
      const errorMessage =
        resultMsg.error?.message ||
        resultMsg.errors?.join(", ") ||
        (typeof resultMsg.result === "string" ? resultMsg.result : null) ||
        "An error occurred";
      const errorCode = resultMsg.error?.type || resultMsg.subtype || "api_error";
      this.receptor.emitError(errorMessage, errorCode, this.currentMeta);
    }
  }

  /**
   * Handle error from SDK lifecycle
   */
  private handleError(error: Error): void {
    this.cleanupPendingRequest();
    if (this.currentMeta) {
      this.receptor.emitError(error.message, "runtime_error", this.currentMeta);
    }
  }

  /**
   * Handle listener exit from SDK lifecycle
   */
  private handleListenerExit(reason: "normal" | "abort" | "error"): void {
    logger.debug("SDK listener exited", { reason });
    this.cleanupPendingRequest();
  }

  /**
   * KNUTH-FEAT 2026-07-07: 从 SDK 事件提取 usage 并累加
   *
   * Anthropic API usage 字段位置:
   * - message_start.event.message.usage = { input_tokens, output_tokens, cache_* }
   * - message_delta.event.usage = { output_tokens } (final turn 的 output 增量)
   * - result.usage = { input_tokens, output_tokens, cache_* } (final turn 完整 usage)
   *
   * 兼容策略: 多路径提取, 任一路径命中即可
   */
  private extractAndRecordUsage(msg: SDKMessage): void {
    if (!this.contextManager || !this.currentMeta) return;

    const imageId = this.currentMeta.context?.imageId;
    if (!imageId) return;

    const usage = extractUsageFromSDKMessage(msg);
    if (!usage) return;

    this.contextManager.recordUsage(imageId, usage);
  }

  /**
   * Start heartbeat during tool execution to prevent idle timeout from firing.
   *
   * The SDK emits no events between message_delta(stop_reason=tool_use) and the
   * tool_result user message. Without a heartbeat, the idle timeout fires after
   * timeoutMs even though the request is actively progressing.
   */
  private startToolHeartbeat(): void {
    this.stopToolHeartbeat();
    // Fire at half the timeout interval so we always reset before the timer fires
    const heartbeatMs = Math.min(Math.floor((this.config.timeout ?? DEFAULT_TIMEOUT) / 2), 120_000);
    logger.debug("Tool execution started - starting heartbeat", { heartbeatMs });
    this.toolHeartbeatTimer = setInterval(() => {
      this.pendingRequest$?.next();
      logger.debug("Tool execution heartbeat - idle timeout reset");
    }, heartbeatMs);
  }

  /**
   * Stop the tool execution heartbeat
   */
  private stopToolHeartbeat(): void {
    if (this.toolHeartbeatTimer !== null) {
      clearInterval(this.toolHeartbeatTimer);
      this.toolHeartbeatTimer = null;
    }
  }

  /**
   * Handle request timeout
   */
  private handleTimeout(meta: ReceptorMeta): void {
    this.wasInterrupted = true;
    this.queryLifecycle.interrupt();
    this.receptor.emitError(
      `Request timeout after ${this.config.timeout ?? DEFAULT_TIMEOUT}ms`,
      "timeout",
      meta
    );
  }

  /**
   * Clean up pending request subscription
   */
  private cleanupPendingRequest(): void {
    this.stopToolHeartbeat();
    if (this.pendingSubscription) {
      this.pendingSubscription.unsubscribe();
      this.pendingSubscription = null;
    }
    if (this.pendingRequest$) {
      this.pendingRequest$.complete();
      this.pendingRequest$ = null;
    }
  }

  /**
   * Complete pending request (cancels timeout)
   */
  private completePendingRequest(): void {
    this.stopToolHeartbeat();
    if (this.pendingRequest$) {
      this.pendingRequest$.complete();
      this.pendingRequest$ = null;
    }
    if (this.pendingSubscription) {
      this.pendingSubscription.unsubscribe();
      this.pendingSubscription = null;
    }
  }

  /**
   * Dispose and cleanup all resources
   */
  dispose(): void {
    logger.debug("Disposing ClaudeEffector", { agentId: this.config.agentId });
    this.cleanupPendingRequest();
    this.queryLifecycle.dispose();
    logger.debug("ClaudeEffector disposed", { agentId: this.config.agentId });
  }
}

/**
 * KNUTH-FEAT 2026-07-07: 从 SDK message 提取 usage 字段
 *
 * 兼容多种 SDK 消息格式 (防御式编程, 缺字段返回 null):
 * - stream_event: event.message.usage / event.usage (Anthropic streaming)
 * - result: msg.usage (SDK final result)
 * - assistant: msg.message.usage (SDK assistant message)
 *
 * 返回标准化 { inputTokens, outputTokens }
 */
export function extractUsageFromSDKMessage(msg: SDKMessage): {
  inputTokens?: number;
  outputTokens?: number;
} | null {
  if (!msg || typeof msg !== "object") return null;

  const m = msg as Record<string, unknown>;

  // 路径 1: stream_event 的 event.message.usage
  const evt = m.event as { message?: { usage?: unknown }; usage?: unknown } | undefined;
  if (evt) {
    if (evt.message && typeof evt.message === "object") {
      const u = (evt.message as { usage?: unknown }).usage;
      const parsed = normalizeUsage(u);
      if (parsed) return parsed;
    }
    // 路径 2: stream_event 的 event.usage (message_delta final output)
    if (evt.usage) {
      const parsed = normalizeUsage(evt.usage);
      if (parsed) return parsed;
    }
  }

  // 路径 3: result / assistant message 的 msg.usage
  if (m.usage) {
    const parsed = normalizeUsage(m.usage);
    if (parsed) return parsed;
  }

  // 路径 4: msg.message.usage
  const innerMsg = m.message as { usage?: unknown } | undefined;
  if (innerMsg && innerMsg.usage) {
    const parsed = normalizeUsage(innerMsg.usage);
    if (parsed) return parsed;
  }

  return null;
}

function normalizeUsage(u: unknown): { inputTokens?: number; outputTokens?: number } | null {
  if (!u || typeof u !== "object") return null;
  const usage = u as Record<string, unknown>;

  const inputTokens =
    typeof usage.input_tokens === "number"
      ? usage.input_tokens
      : typeof usage.inputTokens === "number"
        ? usage.inputTokens
        : undefined;

  const outputTokens =
    typeof usage.output_tokens === "number"
      ? usage.output_tokens
      : typeof usage.outputTokens === "number"
        ? usage.outputTokens
        : undefined;

  if (inputTokens === undefined && outputTokens === undefined) return null;
  return { inputTokens, outputTokens };
}
