/**
 * ContextManager - Token usage tracking and conversation summarization
 *
 * KNUTH-FEAT 2026-07-07: 防止 conversation history 无限累积撞 context window
 *
 * 职责:
 * - 累加每个 image 的 token usage (从 SDK message_delta / result event)
 * - 达到阈值 (80% / 95%) 时 emit context_warning 事件
 * - 在 image 边界提供 summarize() 方法 — 调独立 SDK query 生成 summary
 * - SDK 失败时降级到启发式摘要 (零 token 成本)
 *
 * 已知约束:
 * - @anthropic-ai/claude-agent-sdk 是黑盒: SDK 内部 state 完全不暴露,
 *   "session 内 sliding window" 在 SDK 视角不可行. 压缩只能在 image 边界做.
 * - SessionRepository 是 append-only, 没有切片 API.
 */

import type { Message } from "@agentxjs/types/agent";
import type { ClaudeLLMConfig } from "@agentxjs/types/runtime";
import { SDKQueryLifecycle } from "./SDKQueryLifecycle";
import { createLogger } from "@agentxjs/common";

const logger = createLogger("environment/ContextManager");

/**
 * 累积的 token usage
 *
 * - inputTokens: SDK 报告的当前 turn 的 input (cache miss + read)
 * - outputTokens: 累加所有 turn 的 output
 * - totalInputTokens: 累加所有 turn 的 input (估算总消耗)
 * - contextWindow: 模型 context window 大小
 */
export interface AccumulatedUsage {
  imageId: string;
  inputTokens: number;
  outputTokens: number;
  totalInputTokens: number;
  contextWindow: number;
}

/**
 * Context warning event payload
 *
 * 发送到 SystemBus 让 UI 层订阅 + 弹 toast
 */
export interface ContextWarningEvent {
  type: "context_warning";
  imageId: string;
  ratio: number;
  severity: "warn" | "force";
  usage: AccumulatedUsage;
  timestamp: number;
}

/**
 * Context event union — ContextManager emit 的所有事件
 */
export type ContextEvent = ContextWarningEvent;

/**
 * ContextManager 配置选项
 */
export interface ContextManagerOptions {
  contextWindow?: number;
  warnRatio?: number;
  forceRatio?: number;
  summarizationModel?: string;
  summarizationMaxTokens?: number;
  softThresholdMessages?: number;
  hardThresholdMessages?: number;
  estimateCharsPerToken?: number;
  /** 单条消息文本截断长度 (传给 LLM 摘要时用) */
  perMessageCharLimit?: number;
  /** summary prompt 模板 (可选, 默认内置) */
  summarizationSystemPrompt?: string;
}

const DEFAULTS = {
  contextWindow: 200_000,
  warnRatio: 0.8,
  forceRatio: 0.95,
  summarizationModel: "claude-haiku-4-5",
  summarizationMaxTokens: 1500,
  softThresholdMessages: 30,
  hardThresholdMessages: 50,
  estimateCharsPerToken: 4,
  perMessageCharLimit: 2000,
  summarizationSystemPrompt:
    "You are a conversation summarization assistant. Produce a concise summary (200-400 words) that captures: (1) the main topic, (2) key decisions made, (3) outstanding questions, (4) important tool results. Preserve critical identifiers (file paths, function names, version numbers, error messages). Respond in the same language as the conversation. Output only the summary — no preamble.",
};

export class ContextManager {
  private readonly llmConfig: ClaudeLLMConfig;
  private readonly options: Required<ContextManagerOptions>;
  private readonly emitEvent: (event: ContextEvent) => void;
  private readonly usageMap = new Map<string, AccumulatedUsage>();
  /** 防重复警告: imageId + severity → 是否已警告 */
  private readonly warnedSet = new Set<string>();

  constructor(
    llmConfig: ClaudeLLMConfig,
    emitEvent: (event: ContextEvent) => void,
    options: ContextManagerOptions = {},
  ) {
    if (!llmConfig.apiKey) {
      throw new Error("ContextManager requires llmConfig.apiKey");
    }
    this.llmConfig = llmConfig;
    this.emitEvent = emitEvent;
    this.options = { ...DEFAULTS, ...options };
  }

  // ==================== Token 计数 ====================

  /**
   * 记录一次 SDK usage event
   *
   * SDK 报告的 input_tokens 是"当前 turn 的 input" (不是累计)。
   * 这里把每次的 input 累加到 totalInputTokens，但 inputTokens 保留最新值用于阈值判断。
   */
  recordUsage(
    imageId: string,
    usage: { inputTokens?: number; outputTokens?: number },
  ): AccumulatedUsage | null {
    if (!imageId) return null;

    const existing = this.usageMap.get(imageId) ?? {
      imageId,
      inputTokens: 0,
      outputTokens: 0,
      totalInputTokens: 0,
      contextWindow: this.options.contextWindow,
    };

    if (typeof usage.inputTokens === "number" && usage.inputTokens > 0) {
      existing.inputTokens = usage.inputTokens;
      existing.totalInputTokens += usage.inputTokens;
    }
    if (typeof usage.outputTokens === "number" && usage.outputTokens > 0) {
      existing.outputTokens += usage.outputTokens;
    }

    this.usageMap.set(imageId, existing);
    this.checkWarning(imageId, existing);
    return existing;
  }

  getUsage(imageId: string): AccumulatedUsage | null {
    return this.usageMap.get(imageId) ?? null;
  }

  /** image 删除或重置时清状态 */
  reset(imageId: string): void {
    this.usageMap.delete(imageId);
    this.warnedSet.delete(`${imageId}:warn`);
    this.warnedSet.delete(`${imageId}:force`);
  }

  // ==================== 阈值判断 ====================

  private checkWarning(imageId: string, usage: AccumulatedUsage): void {
    const ratio = usage.inputTokens / usage.contextWindow;

    if (ratio >= this.options.forceRatio) {
      if (!this.warnedSet.has(`${imageId}:force`)) {
        this.warnedSet.add(`${imageId}:force`);
        this.emitEvent({
          type: "context_warning",
          imageId,
          ratio,
          severity: "force",
          usage,
          timestamp: Date.now(),
        });
      }
    } else if (ratio >= this.options.warnRatio) {
      if (!this.warnedSet.has(`${imageId}:warn`)) {
        this.warnedSet.add(`${imageId}:warn`);
        this.emitEvent({
          type: "context_warning",
          imageId,
          ratio,
          severity: "warn",
          usage,
          timestamp: Date.now(),
        });
      }
    } else {
      // 用量降下来时 (例如开新 image 后), 清警告标记让下次超阈值能再次警告
      this.warnedSet.delete(`${imageId}:warn`);
      this.warnedSet.delete(`${imageId}:force`);
    }
  }

  // ==================== Token 估算 ====================

  /**
   * 估算 message 数组的总 token 数
   *
   * 启发式: 英文 ~4 chars/token, 中文 ~1.5 chars/token
   * 工具消息加权 1.5x (tool_result 通常含大量结构化输出)
   * 图片/文件 content block 粗估 1000 tokens/个
   */
  estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const m of messages) {
      let msgChars = this.estimateMessageChars(m);

      // tool 消息加权 (tool_result 通常含大量 JSON)
      if (m.role === "tool") {
        msgChars = Math.floor(msgChars * 1.5);
      }
      totalChars += msgChars;
    }
    return Math.ceil(totalChars / this.options.estimateCharsPerToken);
  }

  /**
   * 判断 message 数组是否需要 summarization
   *
   * 触发条件 (任一):
   * - 消息数 >= hardThreshold (50)
   * - 消息数 >= softThreshold (30) 且 估算 token > warnRatio * contextWindow
   */
  shouldSummarize(messages: Message[]): boolean {
    if (messages.length >= this.options.hardThresholdMessages) return true;
    if (messages.length >= this.options.softThresholdMessages) {
      const estimated = this.estimateTokens(messages);
      return estimated >= this.options.contextWindow * this.options.warnRatio;
    }
    return false;
  }

  // ==================== Summarization ====================

  /**
   * 生成对话摘要
   *
   * 流程:
   * 1. 调独立 SDKQueryLifecycle 实例 (model 用 haiku, 便宜)
   * 2. SDK 失败时降级到启发式 (零 token 成本, 质量较差)
   */
  async summarize(messages: Message[]): Promise<string> {
    if (messages.length === 0) return "(empty conversation)";

    try {
      return await this.callSDKForSummary(messages);
    } catch (err) {
      logger.warn("SDK summarization failed, falling back to heuristic", {
        error: String(err),
      });
      return this.summarizeHeuristic(messages);
    }
  }

  private async callSDKForSummary(messages: Message[]): Promise<string> {
    const transcript = this.formatMessagesForSummary(messages);

    return new Promise<string>((resolve, reject) => {
      const lifecycle = new SDKQueryLifecycle(
        {
          apiKey: this.llmConfig.apiKey,
          baseUrl: this.llmConfig.baseUrl,
          model: this.options.summarizationModel,
          systemPrompt: this.options.summarizationSystemPrompt,
        },
        {
          onResult: (msg) => {
            const result = (msg as { result?: unknown }).result;
            if (typeof result === "string" && result.trim().length > 0) {
              lifecycle.dispose();
              resolve(result.trim());
            } else {
              lifecycle.dispose();
              reject(new Error("Empty summary result from SDK"));
            }
          },
          onError: (err) => {
            lifecycle.dispose();
            reject(err);
          },
          onListenerExit: (reason) => {
            if (reason === "error") {
              lifecycle.dispose();
              reject(new Error("SDK listener exited with error"));
            }
            // 'normal' / 'abort' 不 reject, 让 onResult 或 onError 决定
          },
        },
      );

      // 防御: 设置超时 (30s)
      const timeoutId = setTimeout(() => {
        lifecycle.dispose();
        reject(new Error("Summarization timed out after 30s"));
      }, 30_000);

      // 重写 lifecycle.dispose 来清 timeout
      const origDispose = lifecycle.dispose.bind(lifecycle);
      lifecycle.dispose = () => {
        clearTimeout(timeoutId);
        origDispose();
      };

      lifecycle
        .initialize()
        .then(() => {
          lifecycle.send({
            type: "user",
            message: { role: "user", content: transcript },
            parent_tool_use_id: null,
            session_id: "summarization",
          });
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });
  }

  /**
   * 把 message 数组格式化成纯文本 transcript (给 LLM 摘要)
   */
  private formatMessagesForSummary(messages: Message[]): string {
    const limit = this.options.perMessageCharLimit;
    const lines: string[] = [];
    for (const m of messages) {
      const text = this.extractMessageText(m);
      if (!text) continue;
      const truncated = text.length > limit ? text.slice(0, limit) + "…" : text;
      const label = this.roleLabel(m.role);
      lines.push(`${label}: ${truncated}`);
    }
    return [
      "请总结以下对话 (保持关键标识符如文件路径、函数名、版本号、错误信息):",
      "",
      ...lines,
    ].join("\n");
  }

  private roleLabel(role: string): string {
    switch (role) {
      case "user":
        return "User";
      case "assistant":
        return "Assistant";
      case "tool":
        return "Tool";
      case "system":
        return "System";
      default:
        return "Message";
    }
  }

  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (p): p is { type: string; text: string } =>
            !!p &&
            typeof p === "object" &&
            (p as { type?: string }).type === "text" &&
            typeof (p as { text?: string }).text === "string",
        )
        .map((p) => p.text)
        .join("\n");
    }
    return "";
  }

  private extractMessageText(message: Message): string {
    if ("content" in message) {
      return this.extractText(message.content);
    }

    if ("toolCall" in message) {
      const input = this.stringifyUnknown(message.toolCall.input);
      return [`Tool call: ${message.toolCall.name}`, input].filter(Boolean).join("\n");
    }

    if ("toolResult" in message) {
      return this.extractToolResultText(message.toolResult.output);
    }

    return "";
  }

  private estimateMessageChars(message: Message): number {
    if ("content" in message) {
      return this.estimateContentChars(message.content);
    }

    if ("toolCall" in message) {
      return this.extractMessageText(message).length;
    }

    if ("toolResult" in message) {
      return this.estimateToolResultChars(message.toolResult.output);
    }

    return 0;
  }

  private estimateContentChars(content: unknown): number {
    if (typeof content === "string") {
      return content.length;
    }

    if (!Array.isArray(content)) {
      return 0;
    }

    let total = 0;
    for (const part of content) {
      const typedPart = part as { type?: string; text?: string; reasoning?: string };
      if (typedPart.type === "text" && typeof typedPart.text === "string") {
        total += typedPart.text.length;
      } else if (typedPart.type === "thinking" && typeof typedPart.reasoning === "string") {
        total += typedPart.reasoning.length;
      } else if (typedPart.type === "image" || typedPart.type === "file") {
        total += 4000; // ~1K tokens rough estimate
      }
    }
    return total;
  }

  private estimateToolResultChars(output: unknown): number {
    if (!output || typeof output !== "object") {
      return this.stringifyUnknown(output).length;
    }

    const typedOutput = output as {
      type?: string;
      value?: unknown;
      reason?: string;
    };

    if (typedOutput.type === "content") {
      return this.estimateContentChars(typedOutput.value);
    }

    if (
      (typedOutput.type === "text" || typedOutput.type === "error-text") &&
      typeof typedOutput.value === "string"
    ) {
      return typedOutput.value.length;
    }

    if (typedOutput.type === "execution-denied") {
      return typedOutput.reason?.length ?? 0;
    }

    return this.stringifyUnknown(typedOutput.value ?? output).length;
  }

  private extractToolResultText(output: unknown): string {
    if (!output || typeof output !== "object") {
      return this.stringifyUnknown(output);
    }

    const typedOutput = output as {
      type?: string;
      value?: unknown;
      reason?: string;
    };

    if (typedOutput.type === "content") {
      return this.extractText(typedOutput.value);
    }

    if (
      (typedOutput.type === "text" || typedOutput.type === "error-text") &&
      typeof typedOutput.value === "string"
    ) {
      return typedOutput.value;
    }

    if (typedOutput.type === "execution-denied") {
      return typedOutput.reason ?? "execution denied";
    }

    return this.stringifyUnknown(typedOutput.value ?? output);
  }

  private stringifyUnknown(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    try {
      const serialized = JSON.stringify(value);
      return serialized ?? String(value);
    } catch {
      return String(value);
    }
  }

  /**
   * 启发式摘要 (无 LLM 调用, 零 token 成本)
   *
   * 用途: SDK 失败时的 fallback. 也可单独调用做"轻量压缩" (无 LLM 成本).
   */
  summarizeHeuristic(messages: Message[]): string {
    if (messages.length === 0) return "(empty conversation)";
    const userTurns: string[] = [];
    const assistantTurns: string[] = [];
    const limit = this.options.perMessageCharLimit;

    for (const m of messages) {
      const text = this.extractMessageText(m);
      if (!text) continue;
      const truncated = text.length > limit ? text.slice(0, limit) + "…" : text;
      if (m.role === "user") userTurns.push(truncated);
      else if (m.role === "assistant") assistantTurns.push(truncated);
    }

    return [
      `[Heuristic Summary] 共 ${messages.length} 条消息 (${userTurns.length} 用户 / ${assistantTurns.length} 助手 / 其它)`,
      ``,
      `用户话题 (前 5 条):`,
      ...userTurns.slice(0, 5).map((t, i) => `  ${i + 1}. ${t.slice(0, 200)}`),
      ``,
      `助手回应 (前 3 条):`,
      ...assistantTurns.slice(0, 3).map((t, i) => `  ${i + 1}. ${t.slice(0, 300)}`),
    ].join("\n");
  }
}
