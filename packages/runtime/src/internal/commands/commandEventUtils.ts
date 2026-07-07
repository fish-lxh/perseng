/**
 * Shared command event utilities used by ContainerCommands / AgentCommands /
 * ImageCommands (and any future command group).
 *
 * Extracted from CommandHandler.ts (P0 step 1.2) so the dispatcher class stays
 * thin and each command group can build its own response / error events
 * without re-implementing the source/category/intent boilerplate.
 */

import type { SystemBus } from "@agentxjs/types/runtime/internal";
import type { SystemEvent } from "@agentxjs/types/event";
import type { AgentXResponse } from "@agentxjs/types/agentx";
import { createLogger } from "@agentxjs/common";

type CommandLogger = ReturnType<typeof createLogger>;

/**
 * Build a successful command response event.
 *
 * Type constraint ensures all response data extends AgentXResponse,
 * guaranteeing requestId, error, and __subscriptions fields.
 */
export function createResponse<T extends string, D extends AgentXResponse>(
  type: T,
  data: D,
): SystemEvent {
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
 * Build a system_error event for cross-cutting command failures.
 */
export function createSystemError(
  message: string,
  requestId: string,
  context: Record<string, unknown>,
  stack?: string,
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
 * Helper that logs an error and emits a system_error event on the bus.
 *
 * Each command group constructs its own with its own logger namespace so
 * emitted errors are attributable to the right group (image / agent / ...).
 */
export class CommandEventEmitter {
  private readonly logger: CommandLogger;

  constructor(
    private readonly bus: SystemBus,
    loggerName: string,
  ) {
    this.logger = createLogger(loggerName);
  }

  /**
   * Log error and emit system_error event.
   */
  emitError(
    operation: string,
    err: unknown,
    requestId: string,
    context: Record<string, unknown>,
  ): void {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    this.logger.error(operation, {
      requestId,
      ...context,
      error: errorMessage,
      stack,
    });

    this.bus.emit(createSystemError(errorMessage, requestId, context, stack));
  }
}
