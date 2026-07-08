/**
 * Helper functions for Claude Environment
 */

import type {
  UserMessage,
  ContentPart,
  TextPart,
  ImagePart,
  FilePart,
} from "@agentxjs/types/agent";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Claude API content block types
 */
type ClaudeTextBlock = {
  type: "text";
  text: string;
};

type ClaudeImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
};

type ClaudeDocumentBlock = {
  type: "document";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
};

type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock | ClaudeDocumentBlock;

/**
 * Type guards for ContentPart discrimination
 */
function isTextPart(part: ContentPart): part is TextPart {
  return part.type === "text";
}

function isImagePart(part: ContentPart): part is ImagePart {
  return part.type === "image";
}

function isFilePart(part: ContentPart): part is FilePart {
  return part.type === "file";
}

/**
 * Build SDK content from UserMessage
 *
 * Converts AgentX ContentPart[] to Claude API format:
 * - Pure text messages return as string (for efficiency)
 * - Mixed content returns as ClaudeContentBlock[]
 *
 * If `clockNote` is provided, it is prepended as a system-injected header so the
 * model knows the real wall-clock time of the user's turn (LLMs otherwise have no
 * sense of "now").
 */
export function buildSDKContent(
  message: UserMessage,
  clockNote?: string,
): string | ClaudeContentBlock[] {
  // String content - return as-is (with optional clock prefix)
  if (typeof message.content === "string") {
    return clockNote ? `${clockNote}\n\n${message.content}` : message.content;
  }

  // Not an array - return empty string (clock note still applies if provided)
  if (!Array.isArray(message.content)) {
    return clockNote ?? "";
  }

  const parts = message.content as ContentPart[];

  // Check if we have only text parts
  const hasNonTextParts = parts.some((p) => !isTextPart(p));

  if (!hasNonTextParts) {
    // Pure text - return as string for efficiency
    const joined = parts
      .filter(isTextPart)
      .map((p) => p.text)
      .join("\n");
    return clockNote ? `${clockNote}\n\n${joined}` : joined;
  }

  // Mixed content - prepend clock as a text block (preserves image/document order)
  const blocks: ClaudeContentBlock[] = [];
  if (clockNote) {
    blocks.push({ type: "text", text: clockNote });
  }
  for (const part of parts) {
    if (isTextPart(part)) {
      blocks.push({ type: "text", text: part.text });
    } else if (isImagePart(part)) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: part.mediaType,
          data: part.data,
        },
      });
    } else if (isFilePart(part)) {
      // PDF and other files use "document" type in Claude API
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: part.mediaType,
          data: part.data,
        },
      });
    } else {
      // Unknown type - emit empty text block to keep slot alignment
      blocks.push({ type: "text", text: "" });
    }
  }
  return blocks;
}

/**
 * Build SDK UserMessage from AgentX UserMessage
 *
 * Optional `clockNote` (see `formatClockNote`) is prepended to the user-visible
 * content so the model knows the real wall-clock time of this turn.
 */
export function buildSDKUserMessage(
  message: UserMessage,
  sessionId: string,
  clockNote?: string,
): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: buildSDKContent(message, clockNote) },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

/**
 * Format a Date as a system-injected clock note prepended to user messages.
 *
 * Why: LLMs have no sense of "now". Without an injected timestamp they fall back
 * to their training-data cutoff (often months stale) and produce wrong "today is
 * ..." answers.
 *
 * Format: `[System Clock: 2026-07-08 18:35:42 (UTC+8)]`
 *  - Stable, locale-neutral
 *  - `[System Clock: ...]` prefix so the model can recognize it as injected
 *    metadata rather than user content
 *  - UTC offset is appended for clarity
 *
 * Cost: ~30-40 tokens per turn. Cheap relative to most tool definitions.
 */
export function formatClockNote(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  // UTC offset like "+08:00" / "-05:00" / "Z"
  const offsetMin = date.getTimezoneOffset();
  let offset = "Z";
  if (offsetMin !== 0) {
    const sign = offsetMin > 0 ? "-" : "+";
    const abs = Math.abs(offsetMin);
    const oh = pad(Math.floor(abs / 60));
    const om = pad(abs % 60);
    offset = `${sign}${oh}:${om}`;
  }

  return `[System Clock: ${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} (UTC${offset})]`;
}
