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
import type { Message, UserContentPart } from "@agentxjs/types/agent";
import { BaseEventHandler } from "./BaseEventHandler";
import { ContextManager } from "../environment/ContextManager";
import { SummarizationHelper } from "./commands/SummarizationHelper";
import { ImageCommands } from "./commands/ImageCommands";
import { AgentCommands } from "./commands/AgentCommands";
import { ContainerCommands } from "./commands/ContainerCommands";
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
 * CommandHandler - thin dispatcher that wires per-domain command groups to
 * the SystemBus and retains the SummarizationHelper for image boundary
 * summarization.
 *
 * P0 step 1.1-1.4: handlers moved to commands/{Container,Agent,Image}Commands.
 * Public field access for tests mirrors the wire-up entry points.
 */
export class CommandHandler extends BaseEventHandler {
  /**
   * KNUTH-FEAT 2026-07-07: 上下文压缩管理器封装. 承载 image 边界 summarize +
   * threshold emit 逻辑, 不再由 CommandHandler 直接持有 ContextManager.
   * 构造期接受可空注入 (单测环境可传 null). 仅在构造期转发给 ImageCommands.
   */
  private readonly summarizationHelper: SummarizationHelper;
  /**
   * P0 step 1.4: container_*_request handler 群. 详见 commands/ContainerCommands.ts.
   */
  readonly containerCommands: ContainerCommands;
  /**
   * P0 step 1.3: agent_*_request / message_send_request handler 群.
   * 详见 commands/AgentCommands.ts.
   */
  readonly agentCommands: AgentCommands;
  /**
   * P0 step 1.2: image_*_request handler 群. 详见 commands/ImageCommands.ts.
   * Exposed for direct invocation in tests (the integration entry is the bus
   * event channel via bindHandlers/register).
   */
  readonly imageCommands: ImageCommands;

  constructor(
    bus: SystemBus,
    operations: RuntimeOperations,
    contextManager?: ContextManager | null,
  ) {
    super(bus);
    this.summarizationHelper = new SummarizationHelper(
      operations,
      contextManager ?? null,
    );
    this.containerCommands = new ContainerCommands(bus, operations);
    this.agentCommands = new AgentCommands(bus, operations);
    this.imageCommands = new ImageCommands(bus, operations, this.summarizationHelper);

    this.bindHandlers();
    logger.debug("CommandHandler created");
  }

  /**
   * Bind all command handlers to the bus
   */
  protected bindHandlers(): void {
    // Container commands (P0 step 1.4: extracted to ContainerCommands)
    for (const unsubscribe of this.containerCommands.register()) {
      this.subscribe(unsubscribe);
    }

    // Agent commands (P0 step 1.3: extracted to AgentCommands)
    for (const unsubscribe of this.agentCommands.register()) {
      this.subscribe(unsubscribe);
    }

    // Image commands (P0 step 1.2: extracted to ImageCommands)
    for (const unsubscribe of this.imageCommands.register()) {
      this.subscribe(unsubscribe);
    }

    logger.debug("Command handlers bound");
  }

  // ==================== Container Handlers ====================
  // P0 step 1.4: moved to commands/ContainerCommands.ts

  // ==================== Agent Handlers ====================
  // P0 step 1.3: moved to commands/AgentCommands.ts

  // ==================== Image Handlers ====================
  // P0 step 1.2: moved to commands/ImageCommands.ts

  // Lifecycle is handled by BaseEventHandler.dispose()
}
