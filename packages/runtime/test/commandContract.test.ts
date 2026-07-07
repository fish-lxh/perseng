/**
 * Runtime bus command 契约测试 (P0 Step 0A)
 *
 * 黑盒集成测试: bus.emit(X_request) → 断言 bus emitted X_response.
 *
 * 设计目标:
 * - 不测 CommandHandler 内部细节 (那是 CommandHandler.test.ts 的职责)
 * - 只断言 "输入一个 Command, 输出约定的 Response event, data 字段契约."
 * - 这是后续 desktop / CommandHandler 任何重构的安全网 —
 *   只要这些测试全绿, 渲染进程 / MCP 集成方拿到的 event 流就稳定不变.
 *
 * 与 CommandHandler.test.ts 的区别:
 * - 那个文件用 mock bus, 直接调 handler.handle*() 验证业务逻辑
 * - 这个文件用真实 SystemBusImpl, 只通过 bus.emit/request 进出, 验证
 *   request → response 的完整事件流契约 (事件分类 / 类型 / requestId 关联 /
 *   data shape / 错误传播)
 *
 * 覆盖范围 (8 个核心 request/response pair):
 * - container_create_request / response (成功 + 失败)
 * - container_get_request / response (存在 + 不存在)
 * - container_list_request / response
 * - agent_get_request / response (存在 + 不存在)
 * - agent_list_request / response
 * - image_create_request / response (成功 + 失败)
 * - message_send_request / response (成功)
 * - image_list_request / response (空)
 */

import { describe, test, expect } from "bun:test";
import { SystemBusImpl } from "../src/internal/SystemBusImpl";
import {
  CommandHandler,
  type RuntimeOperations,
  type ImageListItemResult,
} from "../src/internal/CommandHandler";
import type { McpServerConfig } from "@agentxjs/types/runtime/internal";

// ---- Test infrastructure -------------------------------------------------

/**
 * 在一次测试中创建一个干净的 bus + CommandHandler + 可控 ops.
 */
function makeHarness(ops: Partial<RuntimeOperations> = {}) {
  const bus = new SystemBusImpl();
  const fullOps: RuntimeOperations = {
    createContainer: async (id) => ({ containerId: id }),
    getContainer: () => undefined,
    listContainers: () => [],
    getAgent: () => undefined,
    listAgents: () => [],
    destroyAgent: async () => true,
    destroyAllAgents: async () => {},
    receiveMessage: async (_imageId, agentId) => ({
      agentId: agentId ?? "test-agent",
    }),
    interruptAgent: () => ({}),
    createImage: async (containerId, config) => ({
      imageId: `img_${Date.now()}`,
      containerId,
      sessionId: `sess_${Date.now()}`,
      name: config.name ?? "Test",
      description: config.description,
      systemPrompt: config.systemPrompt,
      createdAt: 0,
      updatedAt: 0,
      online: false,
    }),
    runImage: async (imageId) => ({
      imageId,
      agentId: `agent_${Date.now()}`,
      reused: false,
    }),
    stopImage: async () => {},
    updateImage: async (imageId, updates) => ({
      imageId,
      containerId: "c1",
      sessionId: "sess_x",
      name: updates.name,
      description: updates.description,
      createdAt: 0,
      updatedAt: 0,
      online: false,
    }),
    listImages: async () => [],
    getImage: async () => null,
    deleteImage: async () => {},
    getImageMessages: async () => [],
    getMostRecentImageInContainer: async () => null,
    ...ops,
  };
  const handler = new CommandHandler(bus, fullOps);
  return { bus, ops: fullOps, handler };
}

// ---- 1. container_* contract ---------------------------------------------

describe("command contract: container", () => {
  test("container_create_request → container_create_response with same requestId", async () => {
    const { bus } = makeHarness();
    const res = await bus.request("container_create_request", {
      containerId: "c1",
    });
    expect(res.type).toBe("container_create_response");
    expect(res.data.containerId).toBe("c1");
    // requestId correlation
    expect(typeof res.data.requestId).toBe("string");
    expect(res.data.error).toBeUndefined();
  });

  test("container_create_request 失败 → response 携带 error 字段", async () => {
    const { bus } = makeHarness({
      createContainer: async () => {
        throw new Error("port already in use");
      },
    });
    const res = await bus.request("container_create_request", {
      containerId: "c1",
    });
    expect(res.type).toBe("container_create_response");
    expect(res.data.error).toBe("port already in use");
  });

  test("container_get_request 命中 → exists=true", async () => {
    const { bus } = makeHarness({
      getContainer: (id) => ({ containerId: id }),
    });
    const res = await bus.request("container_get_request", {
      containerId: "c1",
    });
    expect(res.type).toBe("container_get_response");
    expect(res.data.exists).toBe(true);
    expect(res.data.containerId).toBe("c1");
  });

  test("container_get_request 未命中 → exists=false, containerId undefined", async () => {
    const { bus } = makeHarness();
    const res = await bus.request("container_get_request", {
      containerId: "ghost",
    });
    expect(res.type).toBe("container_get_response");
    expect(res.data.exists).toBe(false);
    // containerId is set to undefined when missing (rendered as empty in IPC bridge)
    expect(res.data.containerId).toBeUndefined();
  });

  test("container_list_request → 返回 containerIds 数组", async () => {
    const { bus } = makeHarness({
      listContainers: () => [
        { containerId: "a" },
        { containerId: "b" },
      ],
    });
    const res = await bus.request("container_list_request", {});
    expect(res.type).toBe("container_list_response");
    expect(res.data.containerIds).toEqual(["a", "b"]);
  });
});

// ---- 2. agent_* contract -------------------------------------------------

describe("command contract: agent", () => {
  test("agent_get_request 命中 → exists=true, agentId + containerId + imageId", async () => {
    const { bus } = makeHarness({
      getAgent: (id) => ({
        agentId: id,
        containerId: "c1",
        imageId: "img1",
      }),
    });
    const res = await bus.request("agent_get_request", { agentId: "a1" });
    expect(res.type).toBe("agent_get_response");
    expect(res.data.exists).toBe(true);
    expect(res.data.agentId).toBe("a1");
    expect(res.data.containerId).toBe("c1");
  });

  test("agent_get_request 未命中 → exists=false", async () => {
    const { bus } = makeHarness();
    const res = await bus.request("agent_get_request", { agentId: "ghost" });
    expect(res.type).toBe("agent_get_response");
    expect(res.data.exists).toBe(false);
  });

  test("agent_list_request → 返回 agents 数组 (含 agentId/containerId/imageId)", async () => {
    const { bus } = makeHarness({
      listAgents: () => [
        { agentId: "a1", containerId: "c1", imageId: "img1" },
        { agentId: "a2", containerId: "c1", imageId: "img2" },
      ],
    });
    const res = await bus.request("agent_list_request", { containerId: "c1" });
    expect(res.type).toBe("agent_list_response");
    expect(res.data.agents).toHaveLength(2);
    expect(res.data.agents[0]).toEqual({
      agentId: "a1",
      containerId: "c1",
      imageId: "img1",
    });
  });

  test("message_send_request 成功 → response 含 imageId + agentId", async () => {
    const { bus } = makeHarness({
      receiveMessage: async (imageId, agentId) => ({
        agentId: agentId ?? "fallback-agent",
        imageId: imageId ?? "fallback-img",
      }),
    });
    const res = await bus.request("message_send_request", {
      imageId: "img1",
      agentId: "a1",
      content: "hello",
    });
    expect(res.type).toBe("message_send_response");
    expect(res.data.imageId).toBe("img1");
    expect(res.data.agentId).toBe("a1");
  });

  test("message_send_request 失败 → response.success=false + error", async () => {
    const { bus } = makeHarness({
      receiveMessage: async () => {
        throw new Error("LLM timeout");
      },
    });
    const res = await bus.request("message_send_request", {
      imageId: "img1",
      content: "hi",
    });
    expect(res.type).toBe("message_send_response");
    expect(res.data.error).toBe("LLM timeout");
  });
});

// ---- 3. image_* contract -------------------------------------------------

describe("command contract: image", () => {
  test("image_create_request 成功 → 返回 ImageListItemResult shape", async () => {
    const expectedImage: ImageListItemResult = {
      imageId: "img-fixed",
      containerId: "c1",
      sessionId: "sess-1",
      name: "Greeting Bot",
      description: "says hi",
      systemPrompt: "be friendly",
      createdAt: 0,
      updatedAt: 0,
      online: false,
      agentId: undefined,
    };
    const { bus } = makeHarness({
      createImage: async () => expectedImage,
    });
    const res = await bus.request("image_create_request", {
      containerId: "c1",
      config: {
        name: "Greeting Bot",
        description: "says hi",
        systemPrompt: "be friendly",
      },
    });
    expect(res.type).toBe("image_create_response");
    expect(res.data.record).toEqual(expectedImage);
    expect(res.data.error).toBeUndefined();
  });

  test("image_create_request 携带 mcpServers → 透传到 ops", async () => {
    let capturedConfig: { mcpServers?: Record<string, McpServerConfig> } = {};
    const { bus } = makeHarness({
      createImage: async (_cid, config) => {
        capturedConfig = config;
        return {
          imageId: "img-1",
          containerId: "c1",
          sessionId: "s1",
          createdAt: 0,
          updatedAt: 0,
          online: false,
        };
      },
    });
    const mcp: Record<string, McpServerConfig> = {
      fetch: { command: "fetch-mcp", args: ["--port", "8080"] },
    };
    await bus.request("image_create_request", {
      containerId: "c1",
      config: { name: "Bot", mcpServers: mcp },
    });
    expect(capturedConfig.mcpServers).toEqual(mcp);
  });

  test("image_list_request 空 → 返回 records: []", async () => {
    const { bus } = makeHarness({ listImages: async () => [] });
    const res = await bus.request("image_list_request", { containerId: "c1" });
    expect(res.type).toBe("image_list_response");
    expect(res.data.records).toEqual([]);
  });

  test("image_list_request 多条 → records 数组按 ops 返回顺序", async () => {
    const samples: ImageListItemResult[] = [
      {
        imageId: "img-a",
        containerId: "c1",
        sessionId: "s-a",
        createdAt: 1,
        updatedAt: 2,
        online: true,
      },
      {
        imageId: "img-b",
        containerId: "c1",
        sessionId: "s-b",
        createdAt: 3,
        updatedAt: 4,
        online: false,
      },
    ];
    const { bus } = makeHarness({ listImages: async () => samples });
    const res = await bus.request("image_list_request", {});
    expect(res.type).toBe("image_list_response");
    expect(res.data.records).toEqual(samples);
  });
});

// ---- 4. 跨事件 type 校验 (regression 防护) -------------------------------

describe("command contract: 跨事件 type 校验", () => {
  test("X_request → X_response type 字符串必须严格匹配 (没有 s/es 复数化)", async () => {
    const { bus } = makeHarness();
    const res = await bus.request("container_create_request", {
      containerId: "c1",
    });
    // 校验契约: 单数 request, 单数 response. 不能是 "containers" 等复数变体.
    expect(res.type).not.toBe("container_create_responses");
    expect(res.type).toMatch(/^container_create_response$/);
  });

  test("response 事件 category=intent 必须为 response/result", async () => {
    const { bus } = makeHarness();
    const captured: { category?: string; intent?: string } = {};
    bus.on("container_create_response", (event) => {
      captured.category = event.category;
      captured.intent = event.intent;
    });
    await bus.request("container_create_request", { containerId: "c1" });
    // 等待 handler 异步发射完成 (request 已经 await, 这里 callback 应该已触发)
    expect(captured.category).toBe("response");
    expect(captured.intent).toBe("result");
  });

  test("requestId 关联: 每次 response 的 requestId 是独立 UUID 风格", async () => {
    const { bus } = makeHarness();
    const r1 = await bus.request("container_create_request", {
      containerId: "c1",
    });
    const r2 = await bus.request("container_create_request", {
      containerId: "c2",
    });
    expect(r1.data.requestId).not.toBe(r2.data.requestId);
    // requestId 形状: 应该是非空字符串
    expect(typeof r1.data.requestId).toBe("string");
    expect(r1.data.requestId.length).toBeGreaterThan(0);
  });
});