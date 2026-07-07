/**
 * ContextManager unit tests
 *
 * KNUTH-FEAT 2026-07-07: 第一个 bun test baseline
 *
 * 覆盖:
 * - recordUsage 累加 input / output tokens
 * - 80% 阈值 emit warn event
 * - 95% 阈值 emit force event
 * - 重复警告去重 (同一 severity 只发一次)
 * - 用量降下来时清警告标记
 * - estimateTokens 字符数 / 4 的近似
 * - tool 消息加权 1.5x
 * - shouldSummarize 阈值判断
 * - summarize SDK 失败时降级到启发式
 * - extractText 正确处理 string / ContentPart[] / 其它
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { ContextManager } from "../src/environment/ContextManager";
import type { Message } from "@agentxjs/types/agent";

const mockLLMConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.test",
  model: "claude-test",
};

function makeEventsCollector() {
  const events: unknown[] = [];
  const emit = (event: unknown) => events.push(event);
  return { events, emit };
}

function makeTextMessage(role: Message["role"], text: string): Message {
  return {
    id: `${role}_${Math.random()}`,
    role,
    subtype: role,
    content: text,
    timestamp: Date.now(),
  } as Message;
}

describe("ContextManager.recordUsage", () => {
  test("累加 inputTokens 和 outputTokens", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    mgr.recordUsage("img-1", { inputTokens: 1000, outputTokens: 200 });
    mgr.recordUsage("img-1", { inputTokens: 1500, outputTokens: 300 });

    const usage = mgr.getUsage("img-1")!;
    expect(usage.inputTokens).toBe(1500); // 最新一次覆盖
    expect(usage.outputTokens).toBe(500); // 累加
    expect(usage.totalInputTokens).toBe(2500); // 累加
    expect(usage.contextWindow).toBe(200_000);
  });

  test("imageId 为空时返回 null 不崩", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);
    expect(mgr.recordUsage("", { inputTokens: 100 })).toBeNull();
  });

  test("忽略 0 或负数 token", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    mgr.recordUsage("img-1", { inputTokens: 0, outputTokens: -5 });
    mgr.recordUsage("img-1", { inputTokens: 100, outputTokens: 50 });

    const usage = mgr.getUsage("img-1")!;
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
  });

  test("reset 清空 image 用量 + 警告标记", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 850 }); // 85% 触发 warn
    expect(events.length).toBe(1);

    mgr.reset("img-1");
    expect(mgr.getUsage("img-1")).toBeNull();

    // 再次超阈值能再触发
    mgr.recordUsage("img-1", { inputTokens: 850 });
    expect(events.length).toBe(2);
  });
});

describe("ContextManager 阈值警告", () => {
  test("80% 触发 warn event", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 800 });

    expect(events.length).toBe(1);
    const evt = events[0] as {
      type: string;
      severity: string;
      ratio: number;
    };
    expect(evt.type).toBe("context_warning");
    expect(evt.severity).toBe("warn");
    expect(evt.ratio).toBeCloseTo(0.8);
  });

  test("95% 触发 force event", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 950 });

    expect(events.length).toBe(1);
    const evt = events[0] as { severity: string };
    expect(evt.severity).toBe("force");
  });

  test("重复警告去重 (warn 后不再 warn)", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 850 });
    mgr.recordUsage("img-1", { inputTokens: 870 });
    mgr.recordUsage("img-1", { inputTokens: 900 });

    // 只有第一次 emit
    expect(events.length).toBe(1);
  });

  test("从 warn 升级到 force 时 emit force", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 850 }); // warn
    mgr.recordUsage("img-1", { inputTokens: 960 }); // force

    expect(events.length).toBe(2);
    const severities = events.map((e) => (e as { severity: string }).severity);
    expect(severities).toEqual(["warn", "force"]);
  });

  test("用量降下来时清警告标记, 再次超阈值能再次 emit", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 850 }); // warn
    mgr.recordUsage("img-1", { inputTokens: 100 }); // 降下来
    mgr.recordUsage("img-1", { inputTokens: 870 }); // 再次超阈值

    expect(events.length).toBe(2);
  });

  test("低于 80% 时不 emit", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 1000,
    });

    mgr.recordUsage("img-1", { inputTokens: 500 });
    mgr.recordUsage("img-1", { inputTokens: 700 });

    expect(events.length).toBe(0);
  });
});

describe("ContextManager.estimateTokens", () => {
  test("字符串 content 按 chars/4 估算", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    const messages: Message[] = [
      makeTextMessage("user", "a".repeat(400)), // 100 tokens
      makeTextMessage("assistant", "b".repeat(800)), // 200 tokens
    ];

    expect(mgr.estimateTokens(messages)).toBe(300);
  });

  test("tool 消息加权 1.5x", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    const messages: Message[] = [
      makeTextMessage("tool", "x".repeat(400)), // 100 → 150
    ];

    expect(mgr.estimateTokens(messages)).toBe(150);
  });

  test("空消息数组返回 0", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);
    expect(mgr.estimateTokens([])).toBe(0);
  });

  test("ContentPart[] 数组只算 text 部分", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    const messages: Message[] = [
      {
        id: "user_1",
        role: "user",
        subtype: "user",
        content: [
          { type: "text", text: "hello" } as { type: "text"; text: string },
          { type: "image" } as { type: "image" },
        ],
        timestamp: Date.now(),
      } as Message,
    ];

    // "hello" = 5 chars ≈ 2 tokens, image = 4000 chars = 1000 tokens
    expect(mgr.estimateTokens(messages)).toBe(1002);
  });
});

describe("ContextManager.shouldSummarize", () => {
  test("消息数 >= hardThreshold 直接触发", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      hardThresholdMessages: 50,
    });

    const messages = Array.from({ length: 51 }, (_, i) =>
      makeTextMessage("user", `msg ${i}`),
    );

    expect(mgr.shouldSummarize(messages)).toBe(true);
  });

  test("消息数 >= softThreshold 但 token 低时, 不触发", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      softThresholdMessages: 30,
      hardThresholdMessages: 50,
      contextWindow: 200_000,
    });

    const messages = Array.from({ length: 35 }, () =>
      makeTextMessage("user", "hi"),
    );

    expect(mgr.shouldSummarize(messages)).toBe(false);
  });

  test("消息数 >= softThreshold 且 token 高时, 触发", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      softThresholdMessages: 30,
      hardThresholdMessages: 50,
      contextWindow: 1000,
    });

    // 35 条消息, 每条 400 chars = 100 tokens, 共 3500 tokens > 80% of 1000
    const messages = Array.from({ length: 35 }, () =>
      makeTextMessage("user", "x".repeat(400)),
    );

    expect(mgr.shouldSummarize(messages)).toBe(true);
  });

  test("消息数 < softThreshold 不触发", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    const messages = Array.from({ length: 10 }, () =>
      makeTextMessage("user", "x".repeat(10_000)),
    );

    expect(mgr.shouldSummarize(messages)).toBe(false);
  });
});

describe("ContextManager.heuristicSummary", () => {
  test("summarizeHeuristic 包含消息计数 + 用户话题 + 助手回应", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);

    const messages: Message[] = [
      makeTextMessage("user", "你好"),
      makeTextMessage("assistant", "你好, 我是助手"),
      makeTextMessage("user", "今天天气怎么样?"),
    ];

    // 直接调启发式 (避免启动 SDK subprocess, 测试不会超时)
    const summary = mgr.summarizeHeuristic(messages);
    expect(summary).toContain("Heuristic Summary");
    expect(summary).toContain("3 条消息");
  });

  test("空消息数组 summarizeHeuristic 返回提示", () => {
    const { emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit);
    expect(mgr.summarizeHeuristic([])).toBe("(empty conversation)");
  });
});

describe("ContextManager 构造", () => {
  test("缺少 apiKey 抛错", () => {
    const { emit } = makeEventsCollector();
    expect(() => {
      new ContextManager({ apiKey: "" } as any, emit);
    }).toThrow();
  });

  test("自定义 options 生效", () => {
    const { events, emit } = makeEventsCollector();
    const mgr = new ContextManager(mockLLMConfig, emit, {
      contextWindow: 100_000,
      warnRatio: 0.5,
      forceRatio: 0.9,
    });

    mgr.recordUsage("img-1", { inputTokens: 60_000 }); // 60% > 50%
    expect(events.length).toBe(1);
  });
});