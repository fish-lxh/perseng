/**
 * CommandHandler - Handles CommandEvent request/response
 *
 * Listens to command request events on the bus and emits response events.
 * This separates event handling logic from RuntimeImpl resource management.
 *
 * Pattern:
 * ```
 * Bus.emit(container_create_request)
 *   → CommandHandler.handleContainerCreate()
 *   → Bus.emit(container_create_response)
 * ```
 */

import type { SystemBus, McpServerConfig } from "@agentxjs/types/runtime/internal";
import type { SystemEvent } from "@agentxjs/types/event";
import type { AgentXResponse } from "@agentxjs/types/agentx";
import type { Message, UserContentPart } from "@agentxjs/types/agent";
import { BaseEventHandler } from "./BaseEventHandler";
import { ContextManager } from "../environment/ContextManager";
import { createLogger } from "@agentxjs/common";

const logger = createLogger("runtime/CommandHandler");

/**
 * Image list item with online status
 */
export interface ImageListItemResult {
  imageId: string;
  containerId: string;
  sessionId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  createdAt: number;
  updatedAt: number;
  online: boolean;
  agentId?: string;
}

/**
 * Runtime operations interface - what CommandHandler needs to execute commands
 */
export interface RuntimeOperations {
  // Container operations
  createContainer(containerId: string): Promise<{ containerId: string }>;
  getContainer(containerId: string): { containerId: string } | undefined;
  listContainers(): { containerId: string }[];

  // Agent operations (by agentId)
  getAgent(agentId: string): { agentId: string; containerId: string; imageId: string } | undefined;
  listAgents(containerId: string): { agentId: string; containerId: string; imageId: string }[];
  destroyAgent(agentId: string): Promise<boolean>;
  destroyAllAgents(containerId: string): Promise<void>;

  // Agent operations (by imageId - with auto-activation)
  receiveMessage(
    imageId: string | undefined,
    agentId: string | undefined,
    content: string | UserContentPart[],
    requestId: string
  ): Promise<{ agentId: string; imageId?: string }>;
  interruptAgent(
    imageId: string | undefined,
    agentId: string | undefined,
    requestId?: string
  ): { agentId?: string; imageId?: string };

  // Image operations (new model)
  createImage(
    containerId: string,
    config: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      mcpServers?: Record<string, McpServerConfig>;
    }
  ): Promise<ImageListItemResult>;
  runImage(imageId: string): Promise<{ imageId: string; agentId: string; reused: boolean }>;
  stopImage(imageId: string): Promise<void>;
  updateImage(
    imageId: string,
    updates: { name?: string; description?: string }
  ): Promise<ImageListItemResult>;
  listImages(containerId?: string): Promise<ImageListItemResult[]>;
  getImage(imageId: string): Promise<ImageListItemResult | null>;
  deleteImage(imageId: string): Promise<void>;
  getImageMessages(imageId: string): Promise<Message[]>;

  /**
   * KNUTH-FEAT 2026-07-07: 获取 container 内最近一个 image (用于 image 边界 summarization).
   * 返回的 image 为该 container 内已存在的最新 image, 排除正在创建的新 image.
   * 如果 container 没有任何 image, 返回 null.
   */
  getMostRecentImageInContainer(containerId: string): Promise<ImageListItemResult | null>;
}

/**
 * Helper to create a command response event
 *
 * Type constraint ensures all response data extends AgentXResponse,
 * guaranteeing requestId, error, and __subscriptions fields.
 */
function createResponse<T extends string, D extends AgentXResponse>(type: T, data: D): SystemEvent {
  return {
    type,
    timestamp: Date.now(),
    data,
    source: "command",
    category: "response",
    intent: "result",
  } as SystemEvent;
}

/**
 * Helper to create a system_error event
 */
function createSystemError(
  message: string,
  requestId: string,
  context: Record<string, unknown>,
  stack?: string
): SystemEvent {
  return {
    type: "system_error",
    timestamp: Date.now(),
    source: "command",
    category: "error",
    intent: "notification",
    data: {
      message,
      requestId,
      severity: "error",
      details: stack,
    },
    context,
  } as SystemEvent;
}

/**
 * CommandHandler - Event handler for command events
 */
export class CommandHandler extends BaseEventHandler {
  private readonly ops: RuntimeOperations;
  /** KNUTH-FEAT 2026-07-07: 上下文压缩管理器 (image 边界 summarize + threshold emit). 可选注入. */
  private readonly contextManager: ContextManager | null;

  constructor(
    bus: SystemBus,
    operations: RuntimeOperations,
    contextManager?: ContextManager | null,
  ) {
    super(bus);
    this.ops = operations;
    this.contextManager = contextManager ?? null;

    this.bindHandlers();
    logger.debug("CommandHandler created");
  }

  /**
   * Log error and emit system_error event
   */
  private emitError(
    operation: string,
    err: unknown,
    requestId: string,
    context: Record<string, unknown>
  ): void {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    logger.error(operation, {
      requestId,
      ...context,
      error: errorMessage,
      stack,
    });

    this.bus.emit(createSystemError(errorMessage, requestId, context, stack));
  }

  /**
   * Bind all command handlers to the bus
   */
  protected bindHandlers(): void {
    // Container commands
    this.subscribe(
      this.bus.onCommand("container_create_request", (event) => this.handleContainerCreate(event))
    );
    this.subscribe(
      this.bus.onCommand("container_get_request", (event) => this.handleContainerGet(event))
    );
    this.subscribe(
      this.bus.onCommand("container_list_request", (event) => this.handleContainerList(event))
    );

    // Agent commands
    this.subscribe(this.bus.onCommand("agent_get_request", (event) => this.handleAgentGet(event)));
    this.subscribe(
      this.bus.onCommand("agent_list_request", (event) => this.handleAgentList(event))
    );
    this.subscribe(
      this.bus.onCommand("agent_destroy_request", (event) => this.handleAgentDestroy(event))
    );
    this.subscribe(
      this.bus.onCommand("agent_destroy_all_request", (event) => this.handleAgentDestroyAll(event))
    );
    this.subscribe(
      this.bus.onCommand("message_send_request", (event) => this.handleMessageSend(event))
    );
    this.subscribe(
      this.bus.onCommand("agent_interrupt_request", (event) => this.handleAgentInterrupt(event))
    );

    // Image commands
    this.subscribe(
      this.bus.onCommand("image_create_request", (event) => this.handleImageCreate(event))
    );
    this.subscribe(this.bus.onCommand("image_run_request", (event) => this.handleImageRun(event)));
    this.subscribe(
      this.bus.onCommand("image_stop_request", (event) => this.handleImageStop(event))
    );
    this.subscribe(
      this.bus.onCommand("image_update_request", (event) => this.handleImageUpdate(event))
    );
    this.subscribe(
      this.bus.onCommand("image_list_request", (event) => this.handleImageList(event))
    );
    this.subscribe(this.bus.onCommand("image_get_request", (event) => this.handleImageGet(event)));
    this.subscribe(
      this.bus.onCommand("image_delete_request", (event) => this.handleImageDelete(event))
    );
    this.subscribe(
      this.bus.onCommand("image_messages_request", (event) => this.handleImageMessages(event))
    );

    logger.debug("Command handlers bound");
  }

  // ==================== Container Handlers ====================

  private async handleContainerCreate(event: {
    data: { requestId: string; containerId: string };
  }): Promise<void> {
    const { requestId, containerId } = event.data;
    logger.debug("Handling container_create_request", { requestId, containerId });

    try {
      await this.ops.createContainer(containerId);
      this.bus.emit(
        createResponse("container_create_response", {
          requestId,
          containerId,
        })
      );
    } catch (err) {
      this.emitError("Failed to create container", err, requestId, { containerId });
      this.bus.emit(
        createResponse("container_create_response", {
          requestId,
          containerId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private handleContainerGet(event: { data: { requestId: string; containerId: string } }): void {
    const { requestId, containerId } = event.data;
    logger.debug("Handling container_get_request", { requestId, containerId });

    const container = this.ops.getContainer(containerId);
    this.bus.emit(
      createResponse("container_get_response", {
        requestId,
        containerId: container?.containerId,
        exists: !!container,
      })
    );
  }

  private handleContainerList(event: { data: { requestId: string } }): void {
    const { requestId } = event.data;
    logger.debug("Handling container_list_request", { requestId });

    const containers = this.ops.listContainers();
    this.bus.emit(
      createResponse("container_list_response", {
        requestId,
        containerIds: containers.map((c) => c.containerId),
      })
    );
  }

  // ==================== Agent Handlers ====================

  private handleAgentGet(event: { data: { requestId: string; agentId: string } }): void {
    const { requestId, agentId } = event.data;
    logger.debug("Handling agent_get_request", { requestId, agentId });

    const agent = this.ops.getAgent(agentId);
    this.bus.emit(
      createResponse("agent_get_response", {
        requestId,
        agentId: agent?.agentId,
        containerId: agent?.containerId,
        exists: !!agent,
      })
    );
  }

  private handleAgentList(event: { data: { requestId: string; containerId: string } }): void {
    const { requestId, containerId } = event.data;
    logger.debug("Handling agent_list_request", { requestId, containerId });

    const agents = this.ops.listAgents(containerId);
    this.bus.emit(
      createResponse("agent_list_response", {
        requestId,
        agents: agents.map((a) => ({
          agentId: a.agentId,
          containerId: a.containerId,
          imageId: a.imageId,
        })),
      })
    );
  }

  private async handleAgentDestroy(event: {
    data: { requestId: string; agentId: string };
  }): Promise<void> {
    const { requestId, agentId } = event.data;
    logger.debug("Handling agent_destroy_request", { requestId, agentId });

    try {
      const success = await this.ops.destroyAgent(agentId);
      this.bus.emit(
        createResponse("agent_destroy_response", {
          requestId,
          agentId,
          success,
        })
      );
    } catch (err) {
      this.emitError("Failed to destroy agent", err, requestId, { agentId });
      this.bus.emit(
        createResponse("agent_destroy_response", {
          requestId,
          agentId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleAgentDestroyAll(event: {
    data: { requestId: string; containerId: string };
  }): Promise<void> {
    const { requestId, containerId } = event.data;
    logger.debug("Handling agent_destroy_all_request", { requestId, containerId });

    try {
      await this.ops.destroyAllAgents(containerId);
      this.bus.emit(
        createResponse("agent_destroy_all_response", {
          requestId,
          containerId,
        })
      );
    } catch (err) {
      this.emitError("Failed to destroy all agents", err, requestId, { containerId });
      this.bus.emit(
        createResponse("agent_destroy_all_response", {
          requestId,
          containerId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleMessageSend(event: {
    data: {
      requestId: string;
      imageId?: string;
      agentId?: string;
      content: string | UserContentPart[];
    };
  }): Promise<void> {
    const { requestId, imageId, agentId, content } = event.data;
    logger.debug("Handling message_send_request", { requestId, imageId, agentId });

    try {
      // Pass requestId for event correlation
      const result = await this.ops.receiveMessage(imageId, agentId, content, requestId);
      this.bus.emit(
        createResponse("message_send_response", {
          requestId,
          imageId: result.imageId,
          agentId: result.agentId,
        })
      );
    } catch (err) {
      this.emitError("Failed to send message", err, requestId, { imageId, agentId });
      this.bus.emit(
        createResponse("message_send_response", {
          requestId,
          imageId,
          agentId: agentId ?? "",
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private handleAgentInterrupt(event: {
    data: { requestId: string; imageId?: string; agentId?: string };
  }): void {
    const { requestId, imageId, agentId } = event.data;
    logger.debug("Handling agent_interrupt_request", { requestId, imageId, agentId });

    try {
      // Pass requestId for event correlation
      const result = this.ops.interruptAgent(imageId, agentId, requestId);
      this.bus.emit(
        createResponse("agent_interrupt_response", {
          requestId,
          imageId: result.imageId,
          agentId: result.agentId,
        })
      );
    } catch (err) {
      this.emitError("Failed to interrupt agent", err, requestId, { imageId, agentId });
      this.bus.emit(
        createResponse("agent_interrupt_response", {
          requestId,
          imageId,
          agentId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  // ==================== Image Handlers ====================

  private async handleImageCreate(event: {
    data: {
      requestId: string;
      containerId: string;
      config: {
        name?: string;
        description?: string;
        systemPrompt?: string;
        mcpServers?: Record<string, McpServerConfig>;
      };
    };
  }): Promise<void> {
    const { requestId, containerId, config } = event.data;
    logger.debug("Handling image_create_request", { requestId, containerId });

    try {
      // KNUTH-FEAT 2026-07-07: image 边界 summarization — 检查上一个 image, 必要时压缩
      const enrichedConfig = await this.maybeSummarizePreviousImage(containerId, config);

      const record = await this.ops.createImage(containerId, enrichedConfig);
      this.bus.emit(
        createResponse("image_create_response", {
          requestId,
          record,
          // Auto-subscribe client to this session for real-time events
          __subscriptions: [record.sessionId],
        })
      );
    } catch (err) {
      this.emitError("Failed to create image", err, requestId, { containerId });
      this.bus.emit(
        createResponse("image_create_response", {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  /**
   * KNUTH-FEAT 2026-07-07: 如果上一个 image 的历史超阈值, 调 ContextManager.summarize,
   * 并把 summary 以 `<earlier_conversation_summary>` 块注入新 image 的 systemPrompt.
   *
   * 三个降级路径, 任一异常 → 返回原 config:
   * 1. ContextManager 未注入 (单测环境) → 跳过
   * 2. Container 没有 prior image → 跳过
   * 3. SDK summarize 失败 → fallback 到启发式; 启发式也失败 → 用 "summary unavailable" 占位
   *   (失败也不阻塞 image 创建)
   */
  private async maybeSummarizePreviousImage(
    containerId: string,
    config: {
      name?: string;
      description?: string;
      systemPrompt?: string;
      mcpServers?: Record<string, McpServerConfig>;
    },
  ): Promise<{
    name?: string;
    description?: string;
    systemPrompt?: string;
    mcpServers?: Record<string, McpServerConfig>;
  }> {
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

    const enrichedConfig = {
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
   * KNUTH-FEAT 2026-07-07: 把 summary 注入 systemPrompt
   *
   * 包装在 `<earlier_conversation_summary>` 块里, 让 LLM 明确识别边界
   * (Claude 可以据此理解"这是过去的对话压缩结果, 不要把它当作新对话").
   */
  private injectSummary(
    originalSystemPrompt: string | undefined,
    summary: string,
  ): string {
    const summaryBlock = `\n\n<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>\n`;
    return (originalSystemPrompt ?? "") + summaryBlock;
  }

  private async handleImageRun(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;
    logger.debug("Handling image_run_request", { requestId, imageId });

    try {
      const result = await this.ops.runImage(imageId);
      this.bus.emit(
        createResponse("image_run_response", {
          requestId,
          imageId: result.imageId,
          agentId: result.agentId,
          reused: result.reused,
        })
      );
    } catch (err) {
      this.emitError("Failed to run image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_run_response", {
          requestId,
          imageId,
          agentId: "",
          reused: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleImageStop(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;
    logger.debug("Handling image_stop_request", { requestId, imageId });

    try {
      await this.ops.stopImage(imageId);
      this.bus.emit(
        createResponse("image_stop_response", {
          requestId,
          imageId,
        })
      );
    } catch (err) {
      this.emitError("Failed to stop image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_stop_response", {
          requestId,
          imageId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleImageUpdate(event: {
    data: { requestId: string; imageId: string; updates: { name?: string; description?: string } };
  }): Promise<void> {
    const { requestId, imageId, updates } = event.data;
    logger.debug("Handling image_update_request", { requestId, imageId });

    try {
      const record = await this.ops.updateImage(imageId, updates);
      this.bus.emit(
        createResponse("image_update_response", {
          requestId,
          record,
        })
      );
    } catch (err) {
      this.emitError("Failed to update image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_update_response", {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleImageList(event: {
    data: { requestId: string; containerId?: string };
  }): Promise<void> {
    const { requestId, containerId } = event.data;
    logger.debug("Handling image_list_request", { requestId, containerId });

    try {
      const images = await this.ops.listImages(containerId);
      this.bus.emit(
        createResponse("image_list_response", {
          requestId,
          records: images,
          // Auto-subscribe client to all sessions for real-time events
          __subscriptions: images.map((img) => img.sessionId),
        })
      );
    } catch (err) {
      this.emitError("Failed to list images", err, requestId, { containerId });
      this.bus.emit(
        createResponse("image_list_response", {
          requestId,
          records: [],
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleImageGet(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;
    logger.debug("Handling image_get_request", { requestId, imageId });

    try {
      const image = await this.ops.getImage(imageId);
      this.bus.emit(
        createResponse("image_get_response", {
          requestId,
          record: image,
          // Auto-subscribe client to this session for real-time events
          __subscriptions: image?.sessionId ? [image.sessionId] : undefined,
        })
      );
    } catch (err) {
      this.emitError("Failed to get image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_get_response", {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleImageDelete(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;
    logger.debug("Handling image_delete_request", { requestId, imageId });

    try {
      await this.ops.deleteImage(imageId);
      this.bus.emit(
        createResponse("image_delete_response", {
          requestId,
          imageId,
        })
      );
    } catch (err) {
      this.emitError("Failed to delete image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_delete_response", {
          requestId,
          imageId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  private async handleImageMessages(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;
    logger.info("Handling image_messages_request", { requestId, imageId });

    try {
      const messages = await this.ops.getImageMessages(imageId);
      logger.info("Got messages for image", { imageId, count: messages.length });
      this.bus.emit(
        createResponse("image_messages_response", {
          requestId,
          imageId,
          messages,
        })
      );
      logger.info("Emitted image_messages_response", { requestId, imageId });
    } catch (err) {
      this.emitError("Failed to get image messages", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_messages_response", {
          requestId,
          imageId,
          messages: [],
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  // Lifecycle is handled by BaseEventHandler.dispose()
}
