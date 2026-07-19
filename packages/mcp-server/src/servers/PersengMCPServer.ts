/**
 * PersengMCPServer - Perseng 专用的 MCP 服务器
 *
 * 集成了所有 Perseng 工具，提供统一的启动接口
 * 支持 stdio 和 http 两种传输模式
 */

import { StdioMCPServer } from './StdioMCPServer.js';
import { StreamableHttpMCPServer } from './StreamableHttpMCPServer.js';
import { createAllTools, buildToolRegistry } from '../tools/index.js';
import type { MCPServer } from '../interfaces/MCPServer.js';
import type { ToolEventBus } from '../interfaces/MCPServer.js';
import logger, { error as logError } from '@promptx/logger';
import { toToolWithHandler, type MapToolRegistry } from '../registry/ToolRegistry.js';
// KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): scheduler 引擎 + 工具注入
import { ScheduleEngine } from '../scheduler/ScheduleEngine.js';
import { getScheduleStore } from '../scheduler/instance.js';
import { createScheduleTool } from '../tools/schedule.js';

export interface PersengServerOptions {
  // 基础选项
  transport: 'stdio' | 'http';
  name?: string;
  version?: string;

  // HTTP 特定选项
  port?: number;
  host?: string;
  corsEnabled?: boolean;
  cors?: boolean; // 别名兼容

  // Perseng 特定选项
  workingDirectory?: string;  // 工作目录
  ideType?: string;           // IDE 类型(cursor, vscode, claude 等)
  debug?: boolean;            // 调试模式
  enableV2?: boolean;         // 是否启用 V2 (RoleX) 功能,默认 true
}

export class PersengMCPServer {
  private server: MCPServer;
  private options: PersengServerOptions;
  /**
   * KNUTH-FEAT 2026-07-11 (批次 1 / 3.1): 工具 registry — 暴露给后续批次
   * （3.2 ToolContext 注入、3.3 Resource 中心、3.7 manifest 声明）。
   * 当前 registerTools() 仍走传统 createAllTools() 路径以保持行为完全一致；
   * 3.2 落地后切换到 registry.list().map(toToolWithHandler) 单路径注入。
   */
  private toolRegistry?: MapToolRegistry;
  /**
   * KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): 调度引擎 + EventBus 持有。
   * start() 时 engine.start()；stop() 时 engine.stop()。
   */
  private _scheduleEngine?: ScheduleEngine;
  private _eventBus: ToolEventBus | null = null;

  constructor(options: PersengServerOptions) {
    this.options = options;
    
    // 处理别名
    if (options.cors !== undefined && options.corsEnabled === undefined) {
      options.corsEnabled = options.cors;
    }
    
    // 根据 transport 创建对应的服务器
    if (options.transport === 'stdio') {
      this.server = new StdioMCPServer({
        name: options.name || 'perseng-mcp-server',
        version: options.version || process.env.npm_package_version || '1.0.0'
      });
    } else {
      this.server = new StreamableHttpMCPServer({
        name: options.name || 'perseng-mcp-server',
        version: options.version || process.env.npm_package_version || '1.0.0',
        url: `http://${options.host || 'localhost'}:${options.port || 5203}/mcp`,
      });
    }
    
    // 自动注册 Perseng 工具
    this.registerTools();
  }

  /**
   * 注册所有 Perseng 工具
   */
  private registerTools(): void {
    const enableV2 = this.options.enableV2 !== false; // 默认 true
    // 设置环境变量,供 @promptx/core 的 RolexBridge 读取(注意 env 变量已更名为 PERSENG_*,因 npm 包名不动也算对外暴露的环境变量名)
    process.env.PERSENG_ENABLE_V2 = enableV2 ? '1' : '0';

    // KNUTH-FEAT 2026-07-11 (批次 1 / 3.1): 走 registry 装配路径。
    // 后续批次 (3.2 ToolContext) 将直接消费 this.toolRegistry.list()。
    const registry = buildToolRegistry(enableV2);
    this.toolRegistry = registry;
    const tools = registry.list().map(toToolWithHandler);

    // KNUTH-FEAT 2026-07-11 (M4): 一次性构建 EventBus 并注入到所有工具。
    // 失败被 swallow — bus 缺失不应阻断工具注册。
    void this._injectEventBus(tools)

    tools.forEach(tool => {
      this.server.registerTool(tool);
      logger.debug(`Registered tool: ${tool.name}`);
    });

    // KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): 构造 ScheduleEngine 并注入到 schedule tool。
    // 注意 engine.start() 在 server.start() 里调（必须晚于工具注册完）。
    this._initScheduleEngine(registry);

    logger.info(`Registered ${tools.length} Perseng tools (V2: ${enableV2})`);
  }

  /**
   * KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): 构造 ScheduleEngine 并把它注入 schedule tool 的
   * setEngine setter。store 走 ScheduleStore 单例（getScheduleStore）— 与 events 包同模式。
   * 注册期同步完成（不需要 EventBus 已经就绪；engine 内部用 safeEmit 容错）。
   */
  private _initScheduleEngine(registry: MapToolRegistry): void {
    try {
      const store = getScheduleStore()
      this._scheduleEngine = new ScheduleEngine({
        store,
        registry,
        bus: this._eventBus,
      })
      // 把 engine 注入到 schedule tool
      const scheduleTool = createScheduleTool(true)
      ;(scheduleTool as unknown as { setEngine?: (e: ScheduleEngine) => void }).setEngine?.(
        this._scheduleEngine,
      )
      logger.debug('[ScheduleEngine] initialized and injected into schedule tool')
    } catch (err) {
      logger.warn(
        `[ScheduleEngine] init failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * KNUTH-FEAT 2026-07-11 (M4): 动态加载 @promptx/events，构建一个 InProcessEventBus，
   * 并把它注入到所有支持 setEventBus 的工具上。
   *
   * KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): 同时把 bus 提升到 this._eventBus，
   * 给 ScheduleEngine 用（事件平台单源）。
   *
   * 设计要点：
   * - 动态 import — 避免 @promptx/mcp-server 对 @promptx/events 的硬依赖（在测试/CI 里可独立编译）
   * - 失败被 swallow — bus 缺失不应阻断工具注册；工具降级为"不埋事件"
   * - 全部 fire-and-forget — 不阻塞 registerTools() 主流程
   */
  private async _injectEventBus(tools: Array<{ setEventBus?: (bus: ToolEventBus | null) => void }>): Promise<void> {
    try {
      const events = await import('@promptx/events')
      const store = events.getEventStore()
      if (!store) {
        logger.warn('[M4] EventStore unavailable, tools will not emit envelopes')
        return
      }
      const bus = new events.InProcessEventBus(store) as unknown as ToolEventBus
      this._eventBus = bus  // KNUTH-FEAT 2026-07-18 (Commit 4): hoist for ScheduleEngine
      let injected = 0
      for (const tool of tools) {
        if (typeof tool.setEventBus === 'function') {
          tool.setEventBus(bus)
          injected++
        }
      }
      logger.debug(`[M4] Injected EventBus into ${injected}/${tools.length} tools`)
    } catch (err) {
      logger.warn(
        `[M4] Failed to inject EventBus (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  
  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    await this.server.start();
    // KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): ScheduleEngine 启动 — 加载 active schedules
    this._scheduleEngine?.start()
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    // KNUTH-FEAT 2026-07-18 (Phase 1 / Commit 4): ScheduleEngine 关闭 — 停所有 croner jobs
    this._scheduleEngine?.stop()
    await this.server.stop();
  }
  
  /**
   * 优雅关闭
   */
  async gracefulShutdown(timeoutMs?: number): Promise<void> {
    await this.server.gracefulShutdown(timeoutMs || 5000);
  }
  
  /**
   * 获取内部服务器实例（用于高级操作）
   */
  getServer(): MCPServer {
    return this.server;
  }

  /**
   * KNUTH-FEAT 2026-07-11 (批次 1 / 3.1): 暴露 tool registry。
   * 后续批次（3.2 ToolContext、3.5 ToolEventBus subscribe、3.7 manifest）
   * 通过此 getter 拿 registry 喂入上下文；测试也能 dump 当前工具装配。
   */
  getToolRegistry(): MapToolRegistry | undefined {
    return this.toolRegistry;
  }

  /**
   * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 9): 暴露 EventBus。
   * 给 desktop 主进程订阅 schedule.* 事件用（IPC 推送给 settings-window）。
   */
  getEventBus(): ToolEventBus | null {
    return this._eventBus
  }

  // ========== 静态方法 ==========
  
  /**
   * 统一启动方法（向后兼容 PersengServerManager.launch）
   * 
   * 这个方法会：
   * 1. 创建并启动服务器
   * 2. 设置信号处理
   * 3. 保持进程存活（stdio 模式）
   */
  static async launch(options: PersengServerOptions): Promise<PersengMCPServer> {
    // 设置环境变量，通知 logger 当前的传输模式
    process.env.MCP_TRANSPORT = options.transport;

    // MCP STDIO模式最佳实践：劫持console防止stdout污染
    if (options.transport === 'stdio') {
      // 将所有console输出重定向到stderr，遵循MCP官方最佳实践
      // 参考：https://modelcontextprotocol.io/quickstart/server
      const originalLog = console.log;
      console.log = console.error;  // 重定向到stderr
      console.info = console.error;
      console.debug = console.error;
      console.warn = console.error;
      // 保留原始方法以备需要
      (console as any)._originalLog = originalLog;
    }

    const server = new PersengMCPServer(options);

    // 设置信号处理
    const shutdown = async (signal: string) => {
      logger.info(`\nReceived ${signal}, shutting down gracefully...`);
      try {
        await server.gracefulShutdown(5000);
        logger.info('Server stopped cleanly');
        process.exit(0);
      } catch (error) {
        // KNUTH-FIX 2026-07-06: pino overload (string, obj) 不匹配，用 named error() 包装
        logError('Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // 启动服务器
    await server.start();
    
    // 显示启动信息
    if (options.transport === 'http') {
      const port = options.port || 5203;
      const host = options.host || '127.0.0.1';
      logger.info(`HTTP Server Ready at http://${host}:${port}`);
      logger.info('Use MCP-Session-Id header for session management');
    } else {
      logger.info('STDIO Server Ready');
      logger.info('Listening for JSON-RPC messages on stdin');
    }
    
    // 保持进程存活（对于 stdio 模式，防止进程退出）
    if (options.transport === 'stdio') {
      await new Promise(() => {}); // 永远等待
    }
    
    return server;
  }
}

// 导出向后兼容的别名
export { PersengMCPServer as PersengServerManager };
export default PersengMCPServer;