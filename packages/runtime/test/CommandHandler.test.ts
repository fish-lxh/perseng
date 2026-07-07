/**
 * CommandHandler.handleImageCreate 边界 summarization 测试
 *
 * KNUTH-FEAT 2026-07-07: image 创建时检查上一个 image, 必要时压缩并注入 systemPrompt.
 *
 * 覆盖核心 gating 决策 (CommandHandler 逻辑层):
 * - (A) ContextManager 未注入 → 不查 prior image, systemPrompt 原样
 * - (B) container 无 prior image → 不 summarize, systemPrompt 原样
 * - (C) prior image 消息数低于阈值 → 不 summarize, systemPrompt 原样
 * - (D) prior image 消息数超阈值 → 调 summarize, inject 后置结果进 systemPrompt
 *
 * summarize() 真正的 SDK 调用路径在 ContextManager.test.ts 中已覆盖 (heuristic 降级).
 * 本测试只测 CommandHandler 的 wiring 行为, 不再次端到端跑 SDK.
 * (D) 中使用 stub 替换 summarize 的实现, 因为我们要验证的是 inject 逻辑,
 *      而非 SDK 调用本身 — 该部分已经独立测过.
 */

import { describe, test, expect } from "bun:test";
import {
  CommandHandler,
  type RuntimeOperations,
  type ImageListItemResult,
} from "../src/internal/CommandHandler";
import { ContextManager } from "../src/environment/ContextManager";
import type { SystemBus } from "@agentxjs/types/runtime/internal";
import type { Message } from "@agentxjs/types/agent";

// ---- Mock bus + ops ---------------------------------------------------------

function makeMockBus() {
  return {
    onCommand: () => () => {},
    on: () => () => {},
    onAny: () => () => {},
    once: () => () => {},
    emit: () => {},
    emitBatch: () => {},
    asConsumer: () => ({} as ReturnType<SystemBus["asConsumer"]>),
    asProducer: () => ({} as ReturnType<SystemBus["asProducer"]>),
    request: async () => {
      throw new Error("not used in these tests");
    },
    destroy: () => {},
  } as unknown as SystemBus;
}

const LLM_CONFIG = { apiKey: "test-key", baseUrl: "https://api.test", model: "claude-test" };

function makePriorImage(overrides: Partial<ImageListItemResult> = {}): ImageListItemResult {
  return {
    imageId: "img_old",
    containerId: "c1",
    sessionId: "sess_old",
    name: "Old",
    createdAt: 0,
    updatedAt: 0,
    online: false,
    ...overrides,
  };
}

function makeMsg(role: Message["role"], text: string): Message {
  return {
    id: `${role}_${Math.random()}`,
    role,
    subtype: role,
    content: text,
    timestamp: Date.now(),
  } as Message;
}

function makeOps(overrides: Partial<RuntimeOperations> = {}): RuntimeOperations {
  return {
    createContainer: async (id) => ({ containerId: id }),
    getContainer: () => undefined,
    listContainers: () => [],
    getAgent: () => undefined,
    listAgents: () => [],
    destroyAgent: async () => true,
    destroyAllAgents: async () => {},
    receiveMessage: async (_imageId, agentId) => ({ agentId: agentId ?? "test" }),
    interruptAgent: () => ({}),
    createImage: async (containerId, config) => ({
      imageId: "img_new",
      containerId,
      sessionId: "sess_new",
      name: config.name ?? "New",
      description: config.description,
      systemPrompt: config.systemPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      online: false,
    }),
    runImage: async () => ({ imageId: "img_new", agentId: "agent_x", reused: false }),
    stopImage: async () => {},
    updateImage: async (imageId) => ({
      imageId,
      containerId: "c1",
      sessionId: "sess_x",
      createdAt: 0,
      updatedAt: 0,
      online: false,
    }),
    listImages: async () => [],
    getImage: async () => null,
    deleteImage: async () => {},
    getImageMessages: async () => [],
    getMostRecentImageInContainer: async () => null,
    ...overrides,
  };
}

/**
 * 用真实 ContextManager + 仅替换 summarize 返回值的方式构造.
 * 其他逻辑 (shouldSummarize / 阈值判断) 走真实代码路径.
 */
function makeContextManagerStubbed(stubSummary: string): ContextManager {
  const cm = new ContextManager(LLM_CONFIG, () => {});
  (cm as unknown as { summarize: (m: Message[]) => Promise<string> }).summarize = async () =>
    stubSummary;
  return cm;
}

// ---- Tests ------------------------------------------------------------------

describe("CommandHandler.handleImageCreate summarization gating", () => {
  test("(A) ContextManager 未注入 → 不查 prior image, systemPrompt 原样", async () => {
    let createConfig: Parameters<RuntimeOperations["createImage"]>[1] | null = null;
    const ops = makeOps({
      createImage: async (containerId, config) => {
        createConfig = config;
        return {
          imageId: "img_new",
          containerId,
          sessionId: "sess_new",
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
      // 关键: 注入这些后会失败如果被误调
      getMostRecentImageInContainer: async () => {
        throw new Error("should not be called when ContextManager is null");
      },
      getImageMessages: async () => {
        throw new Error("should not be called when ContextManager is null");
      },
    });

    const handler = new CommandHandler(makeMockBus(), ops, null);
    await handler.imageCommands.handleImageCreate({
      data: {
        requestId: "req-1",
        containerId: "c1",
        config: { name: "Test", systemPrompt: "Original" },
      },
    });

    expect(createConfig).not.toBeNull();
    expect(createConfig!.systemPrompt).toBe("Original");
  });

  test("(B) container 无 prior image → 跳过 summarize", async () => {
    let createConfig: Parameters<RuntimeOperations["createImage"]>[1] | null = null;
    const cm = makeContextManagerStubbed("SHOULD NOT APPEAR");
    const ops = makeOps({
      getMostRecentImageInContainer: async () => null,
      getImageMessages: async () => {
        throw new Error("should not be called when no prior image");
      },
      createImage: async (containerId, config) => {
        createConfig = config;
        return {
          imageId: "img_new",
          containerId,
          sessionId: "sess_new",
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
    });

    const handler = new CommandHandler(makeMockBus(), ops, cm);
    await handler.imageCommands.handleImageCreate({
      data: {
        requestId: "req-2",
        containerId: "c1",
        config: { name: "Test", systemPrompt: "Original" },
      },
    });

    expect(createConfig!.systemPrompt).toBe("Original");
  });

  test("(C) prior image 消息数低于阈值 → 不 summarize", async () => {
    let createConfig: Parameters<RuntimeOperations["createImage"]>[1] | null = null;
    const cm = makeContextManagerStubbed("SHOULD NOT APPEAR");
    const fewMessages = Array.from({ length: 5 }, (_, i) => makeMsg("user", `hi ${i}`));
    const ops = makeOps({
      getMostRecentImageInContainer: async () => makePriorImage(),
      getImageMessages: async () => fewMessages,
      createImage: async (containerId, config) => {
        createConfig = config;
        return {
          imageId: "img_new",
          containerId,
          sessionId: "sess_new",
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
    });

    const handler = new CommandHandler(makeMockBus(), ops, cm);
    await handler.imageCommands.handleImageCreate({
      data: {
        requestId: "req-3",
        containerId: "c1",
        config: { name: "Test", systemPrompt: "Original" },
      },
    });

    expect(createConfig!.systemPrompt).toBe("Original");
  });

  test("(D) prior image 消息数超阈值 → inject summary 进 systemPrompt", async () => {
    let createConfig: Parameters<RuntimeOperations["createImage"]>[1] | null = null;
    const STUB = "用户讨论了 iOS 布局, 决定用 SwiftUI 重构";
    const cm = makeContextManagerStubbed(STUB);

    // 60 条消息 > hardThreshold (50)
    const manyMessages = Array.from({ length: 60 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", `m ${i}`),
    );

    const ops = makeOps({
      getMostRecentImageInContainer: async () => makePriorImage(),
      getImageMessages: async () => manyMessages,
      createImage: async (containerId, config) => {
        createConfig = config;
        return {
          imageId: "img_new",
          containerId,
          sessionId: "sess_new",
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
    });

    const handler = new CommandHandler(makeMockBus(), ops, cm);
    await handler.imageCommands.handleImageCreate({
      data: {
        requestId: "req-4",
        containerId: "c1",
        config: { name: "Test", systemPrompt: "Original prompt" },
      },
    });

    const injected = createConfig!.systemPrompt!;
    // 1. 原文保留
    expect(injected).toContain("Original prompt");
    // 2. summary block wrapper 存在
    expect(injected).toContain("<earlier_conversation_summary>");
    expect(injected).toContain("</earlier_conversation_summary>");
    // 3. stub summary 内容在里面
    expect(injected).toContain(STUB);
  });

  test("(D) prior image 超阈值 且 原始 systemPrompt 为空 → inject 仍然 work", async () => {
    let createConfig: Parameters<RuntimeOperations["createImage"]>[1] | null = null;
    const cm = makeContextManagerStubbed("just summary");
    const manyMessages = Array.from({ length: 60 }, (_, i) =>
      makeMsg(i % 2 === 0 ? "user" : "assistant", `m ${i}`),
    );
    const ops = makeOps({
      getMostRecentImageInContainer: async () => makePriorImage(),
      getImageMessages: async () => manyMessages,
      createImage: async (containerId, config) => {
        createConfig = config;
        return {
          imageId: "img_new",
          containerId,
          sessionId: "sess_new",
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
    });

    const handler = new CommandHandler(makeMockBus(), ops, cm);
    await handler.imageCommands.handleImageCreate({
      data: {
        requestId: "req-5",
        containerId: "c1",
        config: { name: "Test" }, // 无 systemPrompt
      },
    });

    const injected = createConfig!.systemPrompt!;
    expect(injected.startsWith("\n\n<earlier_conversation_summary>")).toBe(true);
    expect(injected).toContain("just summary");
  });

  test("(D) summarize 完全抛错 → image 创建不阻塞, 占位 summary 注入", async () => {
    let createConfig: Parameters<RuntimeOperations["createImage"]>[1] | null = null;
    // stub summarize 直接抛错 (绕开 heuristic 降级, 模拟双层 fallback 全失败)
    const cm = new ContextManager(LLM_CONFIG, () => {});
    (cm as unknown as { summarize: (m: Message[]) => Promise<string> }).summarize = async () => {
      throw new Error("simulated SDK + heuristic failure");
    };

    const manyMessages = Array.from({ length: 60 }, (_, i) => makeMsg("user", `m ${i}`));
    const ops = makeOps({
      getMostRecentImageInContainer: async () => makePriorImage(),
      getImageMessages: async () => manyMessages,
      createImage: async (containerId, config) => {
        createConfig = config;
        return {
          imageId: "img_new",
          containerId,
          sessionId: "sess_new",
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
    });

    const handler = new CommandHandler(makeMockBus(), ops, cm);

    // 应该不抛错 (image 创建不会被 summarization 错误阻塞)
    await handler.imageCommands.handleImageCreate({
      data: {
        requestId: "req-6",
        containerId: "c1",
        config: { name: "Test", systemPrompt: "Original" },
      },
    });

    expect(createConfig).not.toBeNull();
    const injected = createConfig!.systemPrompt!;
    // 占位 summary 仍被 inject — 让 LLM 知道之前有过对话但已被压缩
    expect(injected).toContain("Original");
    expect(injected).toContain("<earlier_conversation_summary>");
    expect(injected).toContain("could not be summarized");
  });
});
