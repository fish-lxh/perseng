/**
 * AgentCommands - handlers for the agent_*_request + message_send_request
 * bus events.
 *
 * Extracted from CommandHandler.ts (P0 step 1.3) so agent lifecycle /
 * lookup / message routing live in one place. CommandHandler retains
 * ownership of the SystemBus subscription list and just calls `register()`
 * to attach this group.
 *
 * Behavior is preserved verbatim — payload shapes and __subscriptions
 * semantics are unchanged.
 */

import type { SystemBus, Unsubscribe } from "@agentxjs/types/runtime/internal";
import type { UserContentPart } from "@agentxjs/types/agent";
import type { RuntimeOperations } from "../CommandHandler";
import {
  CommandEventEmitter,
  createResponse,
} from "./commandEventUtils";

export class AgentCommands {
  private readonly emitter: CommandEventEmitter;

  constructor(
    private readonly bus: SystemBus,
    private readonly ops: RuntimeOperations,
  ) {
    this.emitter = new CommandEventEmitter(bus, "runtime/AgentCommands");
  }

  /**
   * Subscribe to all 6 agent_*_request / message_send_request events.
   * Caller is responsible for tracking the returned unsubscribers
   * (CommandHandler does this via its BaseEventHandler.subscribe()).
   */
  register(): Unsubscribe[] {
    return [
      this.bus.onCommand("agent_get_request", (event) => this.handleAgentGet(event)),
      this.bus.onCommand("agent_list_request", (event) => this.handleAgentList(event)),
      this.bus.onCommand("agent_destroy_request", (event) => this.handleAgentDestroy(event)),
      this.bus.onCommand("agent_destroy_all_request", (event) => this.handleAgentDestroyAll(event)),
      this.bus.onCommand("message_send_request", (event) => this.handleMessageSend(event)),
      this.bus.onCommand("agent_interrupt_request", (event) => this.handleAgentInterrupt(event)),
    ];
  }

  // ==================== Agent Handlers ====================

  private handleAgentGet(event: { data: { requestId: string; agentId: string } }): void {
    const { requestId, agentId } = event.data;

    const agent = this.ops.getAgent(agentId);
    this.bus.emit(
      createResponse("agent_get_response", {
        requestId,
        agentId: agent?.agentId,
        containerId: agent?.containerId,
        exists: !!agent,
      }),
    );
  }

  private handleAgentList(event: { data: { requestId: string; containerId: string } }): void {
    const { requestId, containerId } = event.data;

    const agents = this.ops.listAgents(containerId);
    this.bus.emit(
      createResponse("agent_list_response", {
        requestId,
        agents: agents.map((a) => ({
          agentId: a.agentId,
          containerId: a.containerId,
          imageId: a.imageId,
        })),
      }),
    );
  }

  private async handleAgentDestroy(event: {
    data: { requestId: string; agentId: string };
  }): Promise<void> {
    const { requestId, agentId } = event.data;

    try {
      const success = await this.ops.destroyAgent(agentId);
      this.bus.emit(
        createResponse("agent_destroy_response", {
          requestId,
          agentId,
          success,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to destroy agent", err, requestId, { agentId });
      this.bus.emit(
        createResponse("agent_destroy_response", {
          requestId,
          agentId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private async handleAgentDestroyAll(event: {
    data: { requestId: string; containerId: string };
  }): Promise<void> {
    const { requestId, containerId } = event.data;

    try {
      await this.ops.destroyAllAgents(containerId);
      this.bus.emit(
        createResponse("agent_destroy_all_response", {
          requestId,
          containerId,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to destroy all agents", err, requestId, { containerId });
      this.bus.emit(
        createResponse("agent_destroy_all_response", {
          requestId,
          containerId,
          error: err instanceof Error ? err.message : String(err),
        }),
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

    try {
      // Pass requestId for event correlation
      const result = await this.ops.receiveMessage(imageId, agentId, content, requestId);
      this.bus.emit(
        createResponse("message_send_response", {
          requestId,
          imageId: result.imageId,
          agentId: result.agentId,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to send message", err, requestId, { imageId, agentId });
      this.bus.emit(
        createResponse("message_send_response", {
          requestId,
          imageId,
          agentId: agentId ?? "",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private handleAgentInterrupt(event: {
    data: { requestId: string; imageId?: string; agentId?: string };
  }): void {
    const { requestId, imageId, agentId } = event.data;

    try {
      // Pass requestId for event correlation
      const result = this.ops.interruptAgent(imageId, agentId, requestId);
      this.bus.emit(
        createResponse("agent_interrupt_response", {
          requestId,
          imageId: result.imageId,
          agentId: result.agentId,
        }),
      );
    } catch (err) {
      this.emitter.emitError("Failed to interrupt agent", err, requestId, { imageId, agentId });
      this.bus.emit(
        createResponse("agent_interrupt_response", {
          requestId,
          imageId,
          agentId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
