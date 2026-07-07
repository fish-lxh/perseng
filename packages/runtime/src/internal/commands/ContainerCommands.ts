/**
 * ContainerCommands - handlers for the 3 container_*_request bus events.
 *
 * Extracted from CommandHandler.ts (P0 step 1.4) so container lifecycle /
 * lookup commands live in one place. CommandHandler retains ownership of
 * the SystemBus subscription list and just calls `register()` to attach
 * this group.
 *
 * Behavior is preserved verbatim — payload shapes are unchanged.
 */

import type { SystemBus, Unsubscribe } from "@agentxjs/types/runtime/internal";
import type { RuntimeOperations } from "../CommandHandler";
import {
  CommandEventEmitter,
  createResponse,
} from "./commandEventUtils";

export class ContainerCommands {
  private readonly emitter: CommandEventEmitter;

  constructor(
    private readonly bus: SystemBus,
    private readonly ops: RuntimeOperations,
  ) {
    this.emitter = new CommandEventEmitter(bus, "runtime/ContainerCommands");
  }

  /**
   * Subscribe to all 3 container_*_request events. Caller is responsible for
   * tracking the returned unsubscribers (CommandHandler does this via its
   * BaseEventHandler.subscribe()).
   */
  register(): Unsubscribe[] {
    return [
      this.bus.onCommand("container_create_request", (event) => this.handleContainerCreate(event)),
      this.bus.onCommand("container_get_request", (event) => this.handleContainerGet(event)),
      this.bus.onCommand("container_list_request", (event) => this.handleContainerList(event)),
    ];
  }

  // ==================== Container Handlers ====================

  private async handleContainerCreate(event: {
    data: { requestId: string; containerId: string };
  }): Promise<void> {
    const { requestId, containerId } = event.data;

    try {
      await this.ops.createContainer(containerId);
      this.bus.emit(
        createResponse("container_create_response", {
          requestId,
          containerId,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to create container", err, requestId, { containerId });
      this.bus.emit(
        createResponse("container_create_response", {
          requestId,
          containerId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private handleContainerGet(event: { data: { requestId: string; containerId: string } }): void {
    const { requestId, containerId } = event.data;

    const container = this.ops.getContainer(containerId);
    this.bus.emit(
      createResponse("container_get_response", {
        requestId,
        containerId: container?.containerId,
        exists: !!container,
      }),
    );
  }

  private handleContainerList(event: { data: { requestId: string } }): void {
    const { requestId } = event.data;

    const containers = this.ops.listContainers();
    this.bus.emit(
      createResponse("container_list_response", {
        requestId,
        containerIds: containers.map((c) => c.containerId),
      }),
    );
  }
}
