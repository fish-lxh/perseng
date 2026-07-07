/**
 * ImageCommands - handlers for the 8 image_*_request bus events.
 *
 * Extracted from CommandHandler.ts (P0 step 1.2) so image lifecycle /
 * metadata / message-history requests live in one place. CommandHandler
 * retains ownership of the SystemBus subscription list and just calls
 * `register()` to attach this group.
 *
 * Behavior is preserved verbatim — payload shapes, __subscriptions, and
 * summarization hookup (via SummarizationHelper) are unchanged.
 */

import type { SystemBus, McpServerConfig } from "@agentxjs/types/runtime/internal";
import type { Unsubscribe } from "@agentxjs/types/runtime/internal";
import type { RuntimeOperations } from "../CommandHandler";
import { SummarizationHelper } from "./SummarizationHelper";
import {
  CommandEventEmitter,
  createResponse,
} from "./commandEventUtils";

export class ImageCommands {
  private readonly emitter: CommandEventEmitter;

  constructor(
    private readonly bus: SystemBus,
    private readonly ops: RuntimeOperations,
    private readonly summarizationHelper: SummarizationHelper,
  ) {
    this.emitter = new CommandEventEmitter(bus, "runtime/ImageCommands");
  }

  /**
   * Subscribe to all 8 image_*_request events. Caller is responsible for
   * tracking the returned unsubscribers (CommandHandler does this via its
   * BaseEventHandler.subscribe()).
   */
  register(): Unsubscribe[] {
    return [
      this.bus.onCommand("image_create_request", (event) => this.handleImageCreate(event)),
      this.bus.onCommand("image_run_request", (event) => this.handleImageRun(event)),
      this.bus.onCommand("image_stop_request", (event) => this.handleImageStop(event)),
      this.bus.onCommand("image_update_request", (event) => this.handleImageUpdate(event)),
      this.bus.onCommand("image_list_request", (event) => this.handleImageList(event)),
      this.bus.onCommand("image_get_request", (event) => this.handleImageGet(event)),
      this.bus.onCommand("image_delete_request", (event) => this.handleImageDelete(event)),
      this.bus.onCommand("image_messages_request", (event) => this.handleImageMessages(event)),
    ];
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

    try {
      // KNUTH-FEAT 2026-07-07: image 边界 summarization — 检查上一个 image, 必要时压缩
      const enrichedConfig = await this.summarizationHelper.enrich(containerId, config);

      const record = await this.ops.createImage(containerId, enrichedConfig);
      this.bus.emit(
        createResponse("image_create_response", {
          requestId,
          record,
          // Auto-subscribe client to this session for real-time events
          __subscriptions: [record.sessionId],
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to create image", err, requestId, { containerId });
      this.bus.emit(
        createResponse("image_create_response", {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageRun(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;

    try {
      const result = await this.ops.runImage(imageId);
      this.bus.emit(
        createResponse("image_run_response", {
          requestId,
          imageId: result.imageId,
          agentId: result.agentId,
          reused: result.reused,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to run image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_run_response", {
          requestId,
          imageId,
          agentId: "",
          reused: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageStop(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;

    try {
      await this.ops.stopImage(imageId);
      this.bus.emit(
        createResponse("image_stop_response", {
          requestId,
          imageId,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to stop image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_stop_response", {
          requestId,
          imageId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageUpdate(event: {
    data: { requestId: string; imageId: string; updates: { name?: string; description?: string } };
  }): Promise<void> {
    const { requestId, imageId, updates } = event.data;

    try {
      const record = await this.ops.updateImage(imageId, updates);
      this.bus.emit(
        createResponse("image_update_response", {
          requestId,
          record,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to update image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_update_response", {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageList(event: {
    data: { requestId: string; containerId?: string };
  }): Promise<void> {
    const { requestId, containerId } = event.data;

    try {
      const images = await this.ops.listImages(containerId);
      this.bus.emit(
        createResponse("image_list_response", {
          requestId,
          records: images,
          // Auto-subscribe client to all sessions for real-time events
          __subscriptions: images.map((img) => img.sessionId),
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to list images", err, requestId, { containerId });
      this.bus.emit(
        createResponse("image_list_response", {
          requestId,
          records: [],
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageGet(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;

    try {
      const image = await this.ops.getImage(imageId);
      this.bus.emit(
        createResponse("image_get_response", {
          requestId,
          record: image,
          // Auto-subscribe client to this session for real-time events
          __subscriptions: image?.sessionId ? [image.sessionId] : undefined,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to get image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_get_response", {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageDelete(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;

    try {
      await this.ops.deleteImage(imageId);
      this.bus.emit(
        createResponse("image_delete_response", {
          requestId,
          imageId,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to delete image", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_delete_response", {
          requestId,
          imageId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleImageMessages(event: {
    data: { requestId: string; imageId: string };
  }): Promise<void> {
    const { requestId, imageId } = event.data;

    try {
      const messages = await this.ops.getImageMessages(imageId);
      this.bus.emit(
        createResponse("image_messages_response", {
          requestId,
          imageId,
          messages,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to get image messages", err, requestId, { imageId });
      this.bus.emit(
        createResponse("image_messages_response", {
          requestId,
          imageId,
          messages: [],
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
