/**
 * ClaudeEffector usage extraction tests
 *
 * KNUTH-FEAT 2026-07-07: 验证 extractUsageFromSDKMessage 多路径兼容
 */

import { describe, test, expect } from "bun:test";
import { extractUsageFromSDKMessage } from "../src/environment/ClaudeEffector";

describe("extractUsageFromSDKMessage", () => {
  test("路径 1: stream_event.message_start 含 input_tokens + output_tokens", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 1500,
            output_tokens: 1, // Anthropic streaming 给初值 1
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 200,
          },
        },
      },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    const result = extractUsageFromSDKMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(1500);
    expect(result!.outputTokens).toBe(1);
  });

  test("路径 2: stream_event.message_delta 含 final output_tokens", () => {
    const msg = {
      type: "stream_event",
      event: {
        type: "message_delta",
        usage: {
          output_tokens: 250,
        },
      },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    const result = extractUsageFromSDKMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.outputTokens).toBe(250);
    expect(result!.inputTokens).toBeUndefined();
  });

  test("路径 3: result 含完整 usage", () => {
    const msg = {
      type: "result",
      subtype: "success",
      result: "final text",
      usage: {
        input_tokens: 1800,
        output_tokens: 350,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 200,
      },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    const result = extractUsageFromSDKMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(1800);
    expect(result!.outputTokens).toBe(350);
  });

  test("路径 4: assistant message 含 message.usage", () => {
    const msg = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [],
        usage: {
          input_tokens: 900,
          output_tokens: 100,
        },
      },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    const result = extractUsageFromSDKMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(900);
    expect(result!.outputTokens).toBe(100);
  });

  test("缺 usage 字段返回 null", () => {
    const msg = {
      type: "stream_event",
      event: { type: "content_block_start" },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    expect(extractUsageFromSDKMessage(msg)).toBeNull();
  });

  test("空对象返回 null", () => {
    expect(extractUsageFromSDKMessage({} as never)).toBeNull();
  });

  test("兼容 snake_case 和 camelCase 字段名", () => {
    const msg = {
      type: "result",
      usage: {
        inputTokens: 100, // camelCase
        outputTokens: 50,
      },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    const result = extractUsageFromSDKMessage(msg);
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(50);
  });

  test("usage 存在但 input/output 都缺时返回 null", () => {
    const msg = {
      type: "result",
      usage: {
        cache_read_input_tokens: 200,
      },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    expect(extractUsageFromSDKMessage(msg)).toBeNull();
  });

  test("input_tokens 是字符串时不提取", () => {
    const msg = {
      type: "result",
      usage: { input_tokens: "abc" },
    } as unknown as Parameters<typeof extractUsageFromSDKMessage>[0];

    // 字符串不是 number, normalizeUsage 跳过
    expect(extractUsageFromSDKMessage(msg)).toBeNull();
  });
});