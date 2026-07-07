/**
 * SummarizationHelper - Image boundary summarization for handleImageCreate
 *
 * KNUTH-FEAT 2026-07-07: when a new image is created, check the previous image
 * in the same container. If its history is large enough, summarize and inject
 * the summary into the new image's systemPrompt.
 *
 * Three fallback paths, any failure → return original config:
 *   1. ContextManager not injected (mock tests) → skip
 *   2. Container has no prior image → skip
 *   3. SDK summarize fails → fallback to heuristic; heuristic also fails →
 *      use "summary unavailable" placeholder (failure does NOT block image
 *      creation)
 *
 * Extracted from CommandHandler.ts (Step 1.1 of P0 refactor) so the dispatcher
 * itself stays thin. Behavior is preserved verbatim.
 */

import type { McpServerConfig } from "@agentxjs/types/runtime/internal";
import type { Message } from "@agentxjs/types/agent";
import type { ContextManager } from "../../environment/ContextManager";
import type { RuntimeOperations } from "../CommandHandler";
import { createLogger } from "@agentxjs/common";

const logger = createLogger("runtime/SummarizationHelper");

/**
 * Shape of the createImage config that the helper may enrich.
 * Mirrors the inline type in RuntimeOperations.createImage.
 */
export interface ImageCreateConfig {
  name?: string;
  description?: string;
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * SummarizationHelper
 *
 * Stateless helper that, given a container and a new image config, may enrich
 * the config's systemPrompt with a summary of the previous image's history.
 *
 * Used by CommandHandler.handleImageCreate.
 */
export class SummarizationHelper {
  constructor(
    private readonly ops: RuntimeOperations,
    private readonly contextManager: ContextManager | null,
  ) {}

  /**
   * If the previous image's history exceeds threshold, summarize and inject
   * the summary into the new image's systemPrompt.
   *
   * On any failure path, return the original config unchanged (callers must
   * be able to proceed with image creation regardless of summary outcome).
   */
  async enrich(
    containerId: string,
    config: ImageCreateConfig,
  ): Promise<ImageCreateConfig> {
    if (!this.contextManager) {
      return config;
    }

    let previousImage;
    try {
      previousImage = await this.ops.getMostRecentImageInContainer(containerId);
    } catch (err) {
      logger.warn("Failed to look up previous image, skipping summarization", {
        containerId,
        error: String(err),
      });
      return config;
    }

    if (!previousImage) {
      return config;
    }

    let messages: Message[];
    try {
      messages = await this.ops.getImageMessages(previousImage.imageId);
    } catch (err) {
      logger.warn("Failed to load previous image messages, skipping summarization", {
        imageId: previousImage.imageId,
        error: String(err),
      });
      return config;
    }

    if (!this.contextManager.shouldSummarize(messages)) {
      return config;
    }

    logger.info("Summarizing previous image before creating new one", {
      containerId,
      previousImageId: previousImage.imageId,
      messageCount: messages.length,
    });

    let summary: string;
    try {
      summary = await this.contextManager.summarize(messages);
    } catch (err) {
      logger.error("Summarization failed (both SDK and heuristic), proceeding without", {
        error: String(err),
      });
      // 仍然 inject 一个 summary block 标注失败, 让 AI 知道"之前有过对话但已被压缩"
      summary = "(earlier conversation could not be summarized - previous context is lost)";
    }

    const enrichedConfig: ImageCreateConfig = {
      ...config,
      systemPrompt: this.injectSummary(config.systemPrompt, summary),
    };

    logger.info("Injected summary into new image systemPrompt", {
      containerId,
      previousImageId: previousImage.imageId,
      fromMessages: messages.length,
      summaryLength: summary.length,
      summaryPreview: summary.slice(0, 120),
    });

    return enrichedConfig;
  }

  /**
   * Wrap the summary in a `<earlier_conversation_summary>` block so the LLM
   * understands "this is a compressed past conversation, not a new turn".
   */
  private injectSummary(
    originalSystemPrompt: string | undefined,
    summary: string,
  ): string {
    const summaryBlock = `\n\n<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>\n`;
    return (originalSystemPrompt ?? "") + summaryBlock;
  }
}
