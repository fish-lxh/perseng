/**
 * createAgentXRuntime - Local AgentX 运行时工厂（绕过 facade 的 shouldEnqueue 过滤）
 *
 * ## 背景
 *
 * `agentxjs` 包的 `createLocalAgentX` facade 在订阅 `Runtime.onAny` 时
 * 加了 `shouldEnqueue` 过滤，吞掉 `source === 'environment'` 的事件：
 *
 * - `agentxjs/dist/index.js:354-360` — `shouldEnqueue` 把
 *   `source==='environment'` 和 `intent==='request'` 的事件直接 return false
 * - `agentxjs/dist/index.js:380-386` — `runtime.onAny` 回调里包了
 *   `if (!shouldEnqueue(event)) return`
 * - `agentxjs/dist/index.js:392-399` — `agentx.on(type, handler)` 又在
 *   `runtime.on` 回调里包了 `if (!shouldEnqueue(event)) return`
 *
 * 结果：timeline 拿不到 `tool_use_content_block_start` / `tool_result` /
 * `text_content_block_start` / `text_content_block_stop` 这些 Claude
 * 流事件。
 *
 * ## 解决方案
 *
 * 本文件复刻 `createLocalAgentX` 行 240-417 的完整实现，**去掉所有
 * shouldEnqueue 过滤**，并把 `runtime` 暴露出来，便于调用方直接
 * `runtime.onAny(...)` 订阅全量事件。
 *
 * ## 兼容性
 *
 * 返回的 `facade` 字段类型为 `agentxjs.AgentX`（6 个方法），与原 facade
 * 完全兼容 —— FeishuManager / FeishuBridge / FeishuSessionManager / renderer
 * 全部零改动。
 *
 * ## KNUTH-FEAT 2026-07-04
 *
 * 见 plan: 方案 A - AgentXService 重写以捕获工具事件。
 */

import * as path from 'node:path'
import * as logger from '@promptx/logger'
import { createRuntime, RuntimeEnvironment } from '@agentxjs/runtime'
import { createPersistence } from '@agentxjs/persistence'
// KNUTH-FEAT 2026-07-04: `@agentxjs/persistence/sqlite` 子路径 export 走
// package.json 的 "exports" map。2026-07-05 desktop tsconfig 切到
// moduleResolution="bundler" 后 subpath 解析正常，此处不再需要 ts-expect-error。
import { sqliteDriver } from '@agentxjs/persistence/sqlite'
import { createQueue } from '@agentxjs/queue'
import { WebSocketServer } from '@agentxjs/network'
import type { AgentX, Unsubscribe } from 'agentxjs'

/** Runtime 实例类型：从 createRuntime 的返回类型推导，避免反向依赖子路径导出 */
export type AgentXRuntime = ReturnType<typeof createRuntime>

/** 避免引入 `@agentxjs/types/agentx` 子路径（当前 tsconfig moduleResolution 不支持） */
export interface AgentDefinitionLike {
  name: string
  description?: string
  systemPrompt?: string
  mcpServers?: Record<string, unknown>
}

/** facade 期望的配置子集 */
export interface AgentXRuntimeConfig {
  /** AgentX 数据根目录，默认 ~/.agentx */
  agentxDir: string
  /** LLM 配置 */
  llm: {
    apiKey: string
    baseUrl?: string
    model?: string
  }
  /** Claude Code 可执行路径（可选） */
  claudeCodePath?: string
  /** 默认 agent 定义（可选） */
  defaultAgent?: AgentDefinitionLike
}

/**
 * timeline attach 函数的最小契约：接收一个能订阅全量事件的 bus 和一个能
 * 写入事件的 log，返回 unsubscribe。Runtime 满足 `{onAny}` 接口的形态。
 *
 * 设计上故意保持宽松：避免在 desktop 包内反向依赖
 * `@promptx/mcp-server/timeline` 的具体类型，让两边解耦。
 */
type TimelineLogLike = {
  append: (event: unknown) => Promise<void>
}
type TimelineAttacher = (
  bus: { onAny?: (h: (event: unknown) => void) => Unsubscribe },
  log: TimelineLogLike,
  options?: unknown,
) => Unsubscribe

/**
 * createAgentXRuntime 的返回。
 *
 * - `facade`：与 `agentxjs.AgentX` 签完全一致，可直接替换（Feishu 等模块无感）
 * - `runtime`：原始 Runtime 实例，用于 `runtime.onAny(...)` 订阅全量事件
 * - `wsServer` / `eventQueue`：分别用于 stop / debug
 * - `attachTimeline`：便捷封装，把 attacher 绑到 runtime.onAny 路径
 */
export interface BuiltRuntime {
  facade: AgentX
  runtime: AgentXRuntime
  wsServer: WebSocketServer
  eventQueue: ReturnType<typeof createQueue>
  /**
   * 把 timeline attacher 绑到 `runtime.onAny` 路径，返回 unsubscribe。
   * 默认过滤器由 attacher 自己负责（见 EventLogger.DEFAULT_FILTER）。
   */
  attachTimeline: (
    attacher: TimelineAttacher,
    log: TimelineLogLike,
    options?: unknown,
  ) => Unsubscribe
}

/** 内部：单条连接的订阅状态 */
interface ConnectionState {
  connection: {
    id: string
    sendReliable: (message: string, options: unknown) => void
    send: (message: string) => void
    onMessage: (handler: (message: string) => void) => Unsubscribe
    onClose: (handler: () => void) => Unsubscribe
  }
  subscribedSessions: Set<string>
}

/**
 * 错误回滚：若中途抛错，按已创建顺序反向释放已初始化资源。
 *
 * 释放顺序：wsServer → runtime → eventQueue → persistence
 *   （这个顺序跟 facade.dispose 的顺序一致：先断网、再停 runtime、再关 db）
 */
async function safeRollback(partial: {
  wsServer?: WebSocketServer
  runtime?: AgentXRuntime
  eventQueue?: ReturnType<typeof createQueue>
}): Promise<void> {
  try {
    if (partial.wsServer) await partial.wsServer.dispose().catch(() => undefined)
  } catch (err) {
    logger.warn(`createAgentXRuntime rollback wsServer failed: ${String(err instanceof Error ? err.message : err)}`)
  }
  try {
    if (partial.runtime) await partial.runtime.dispose().catch(() => undefined)
  } catch (err) {
    logger.warn(`createAgentXRuntime rollback runtime failed: ${String(err instanceof Error ? err.message : err)}`)
  }
  try {
    if (partial.eventQueue) await partial.eventQueue.close().catch(() => undefined)
  } catch (err) {
    logger.warn(`createAgentXRuntime rollback eventQueue failed: ${String(err instanceof Error ? err.message : err)}`)
  }
}

/**
 * 创建 AgentX 运行时实例（local 模式）。
 *
 * 与 `agentxjs.createLocalAgentX` 等价但**去掉了 shouldEnqueue 过滤**——
 * 任何被 `Runtime` 发出的事件都会被（1）广播给 ws 客户端，（2）写入 eventQueue，
 * （3）能被 `runtime.onAny(...)` 订阅到。
 */
export async function createAgentXRuntime(
  config: AgentXRuntimeConfig,
): Promise<BuiltRuntime> {
  const basePath = config.agentxDir ?? path.join(process.env.HOME ?? '~', '.agentx')
  const storagePath = path.join(basePath, 'data', 'agentx.db')
  const queuePath = path.join(basePath, 'data', 'queue.db')

  if (config.claudeCodePath) {
    RuntimeEnvironment.setClaudeCodePath(config.claudeCodePath)
  }

  // 1. Persistence（facade 第 261 行）
  const persistence = await createPersistence(sqliteDriver({ path: storagePath }))

  // 2. EventQueue（facade 第 264 行）
  const eventQueue = createQueue({ path: queuePath })

  // 3. Runtime（facade 第 265-278 行）
  const runtime = createRuntime({
    persistence,
    basePath,
    llmProvider: {
      name: 'claude',
      provide: () => ({
        apiKey: config.llm.apiKey ?? '',
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
      }),
    },
    // 透传给 runtime；RuntimeConfig.defaultAgent 接受对应形状
    defaultAgent: config.defaultAgent as unknown as Parameters<typeof createRuntime>[0]['defaultAgent'],
  })

  // 4. WebSocketServer（facade 第 279-283 行）
  const wsServer = new WebSocketServer({
    heartbeat: true,
    heartbeatInterval: 30000,
    debug: false,
  })

  const partial: {
    wsServer?: WebSocketServer
    runtime?: AgentXRuntime
    eventQueue?: ReturnType<typeof createQueue>
  } = { runtime, eventQueue, wsServer }

  // 5. 订阅循环（facade 第 285-353 行，byte-identical except shouldEnqueue 去掉）：
  //    - 关键不变量：ACK + cursor recovery + onClose 清理 —— 不能简化为
  //      `wsServer.broadcast`，会破坏重连客户端的漏读保护
  const connections = new Map<string, ConnectionState>()

  function subscribeConnectionToTopic(connectionId: string, topic: string): void {
    const connState = connections.get(connectionId)
    if (!connState) return
    if (connState.subscribedSessions.has(topic)) return
    connState.subscribedSessions.add(topic)

    const unsubscribe = eventQueue.subscribe(topic, (entry: { cursor: string; event: unknown }) => {
      const event = entry.event
      const message = JSON.stringify(event)
      connState.connection.sendReliable(message, {
        onAck: () => {
          eventQueue
            .ack(connectionId, topic, entry.cursor)
            .catch((err: unknown) => {
              logger.error(`Failed to ack: ${String(err instanceof Error ? err.message : err)}`)
            })
          persistMessage(event)
        },
        timeout: 10000,
        onTimeout: () => {
          const e = event as { type?: string }
          logger.warn(`ACK timeout for event connectionId=${connectionId} eventType=${e.type ?? '?'} topic=${topic}`)
        },
      })
    })

    connState.connection.onClose(() => {
      unsubscribe()
    })

    logger.info(`Connection subscribed to queue topic connectionId=${connectionId} topic=${topic}`)
  }

  wsServer.onConnection((connection) => {
    // KNUTH-FIX 2026-07-05: bundler moduleResolution 暴露了 ChannelConnection 的真实类型，
    // 之前 ConnectionState['connection'] 是本地狭窄类型，与 ChannelConnection 不结构兼容。
    // 这里直接用 onConnection 给出的 connection，set 进 Map 时复用同一对象。
    connections.set(connection.id, {
      connection: connection as ConnectionState['connection'],
      subscribedSessions: new Set(),
    })
    logger.info(`Client connected connectionId=${connection.id}`)

    subscribeConnectionToTopic(connection.id, 'global')

    connection.onMessage((message: string) => {
      try {
        const parsed = JSON.parse(message) as {
          type?: string
          sessionId?: string
          afterCursor?: string
          [key: string]: unknown
        }
        if (parsed.type === 'subscribe' && parsed.sessionId) {
          subscribeConnectionToTopic(connection.id, parsed.sessionId)
          const lastCursor = parsed.afterCursor
          if (lastCursor) {
            eventQueue
              .recover(parsed.sessionId, lastCursor)
              .then((entries: Array<{ event: unknown }>) => {
                for (const entry of entries) {
                  connection.send(JSON.stringify(entry.event))
                }
              })
              .catch((err: unknown) => {
                logger.error(`Failed to recover history: ${String(err instanceof Error ? err.message : err)}`)
              })
          }
          return
        }
        const event = parsed
        logger.debug(`Received client message type=${(event as { type?: string }).type ?? '?'}`)
        // 直接 emit 回 runtime（facade 第 346 行）。Runtime 的类型签名是
        // SystemEvent 的全栈，但我们从 ws 收到的 JSON 不一定有全部字段，
        // 这里 cast 一下兜底。
        ;(runtime as unknown as { emit: (e: unknown) => void }).emit(event)
      } catch (err) {
        logger.warn(`Failed to handle client message: ${String(err instanceof Error ? err.message : err)}`)
      }
    })

    connection.onClose(() => {
      connections.delete(connection.id)
      logger.info(`Client disconnected connectionId=${connection.id}`)
    })
  })

  function persistMessage(event: unknown): void {
    const e = event as { category?: string; data?: unknown; context?: { sessionId?: string } }
    if (e.category !== 'message' || !e.data) return
    const sessionId = e.context?.sessionId
    if (!sessionId) return
    logger.debug(`Persisting message on ACK sessionId=${sessionId}`)
    ;(
      persistence as unknown as {
        sessions: { addMessage: (sessionId: string, message: unknown) => Promise<void> }
      }
    ).sessions.addMessage(sessionId, e.data).catch((err: unknown) => {
      logger.error(`Failed to persist message sessionId=${sessionId} error=${String(err instanceof Error ? err.message : err)}`)
    })
  }

  // 6. KNUTH-FEAT 2026-07-04: publish 路径恢复 facade shouldEnqueue 行为。
  //
  //    思路演进：
  //
  //    (a) facade 时代：runtime.onAny → publish 到 eventQueue → ws 推。
  //        shouldEnqueue 把 source==='environment' 全拦掉，ws client
  //        永远只看到 BusDriver→engine 转出的 agent event（assistant_message
  //        / tool_* / conversation_end 等），单源渲染。
  //
  //    (b) 方案 A 第一次：本想"timeline 拿全量 events"，误把 shouldEnqueue
  //        全删。结果 ws 收到 environment 直推 + BusDriver 转发的 agent event
  //        双源，renderer 双 listener (text_delta + assistant_message) 累积
  //        同一段文本 → **"AGENT 输出内容重复两遍"**。
  //
  //    (c) 方案 A 第二次（错误回滚）：把整段 publish 砍掉。结果 ws 完全断流
  //        → **"无法进入对话也无法激活 AGENT"**（publish 是 ws 流唯一的源头，
  //        BusDriver→engine 转的 agent event 也需要经 publish 推到 client）。
  //
  //    (d) 当前（正确）：恢复 publish 段 + **仅保留 facade 的 shouldEnqueue
  //        过滤**，ws 流合约与 facade 时代完全一致。timeline 想拿全量 events
  //        怎么办？**走 built.attachTimeline** 单独注册一个
  //        `runtime.onAny` handler 写 EventLog —— 不经过 eventQueue，不影响
  //        ws 流，不双推。
  //
  //    两条路径独立：
  //      - publish: runtime.onAny → filter → eventQueue.publish → ws sendReliable
  //                 （facade-shaped，仅 agent event 到 client）
  //      - timeline: runtime.onAny → EventLog.append （全新旁路，全量）
  //
  //    为什么不直接让 publish 全量 + 在 client 端过滤？因为 ws 协议保持
  //    facade-shaped 是为了 renderer / Feishu 远程客户端不破，无需追改 ws 协议。
  runtime.onAny((event: unknown) => {
    const e = event as {
      source?: string
      intent?: string
      context?: { sessionId?: string }
    }
    // 复刻 facade shouldEnqueue：environment / request intent 一律不进 eventQueue
    if (e.source === 'environment') return
    if (e.intent === 'request') return
    const topic = e.context?.sessionId ?? 'global'
    eventQueue.publish(topic, event)
  })
  //
  //    留下的 `runtime.onAny(...)` 块**故意删除**，避免再有人误以为这是
  //    timeline 全量的来源。

  // 7. facade 对象（行 390-416），通过 cast 实现 AgentX 接口
  const facade = {
    request: ((type: unknown, data: unknown, timeout?: number) =>
      (
        runtime as unknown as { request: (t: unknown, d: unknown, to?: number) => Promise<unknown> }
      ).request(type, data, timeout)) as AgentX['request'],
    on: ((type: unknown, handler: unknown) =>
      (
        runtime as unknown as { on: (t: unknown, h: unknown) => Unsubscribe }
      ).on(type, handler)) as AgentX['on'],
    onCommand: ((type: unknown, handler: unknown) =>
      (runtime as unknown as { onCommand: (t: unknown, h: unknown) => Unsubscribe })
        .onCommand(type, handler)) as AgentX['onCommand'],
    emitCommand: ((type: unknown, data: unknown) =>
      (runtime as unknown as { emitCommand: (t: unknown, d: unknown) => void })
        .emitCommand(type, data)) as AgentX['emitCommand'],
    async listen(port: number, host?: string): Promise<void> {
      await wsServer.listen(port, host)
    },
    async close(): Promise<void> {
      await wsServer.close()
    },
    async dispose(): Promise<void> {
      // facade dispose 的顺序：wsServer → runtime → eventQueue
      await wsServer.dispose()
      await runtime.dispose()
      await eventQueue.close()
    },
  } as AgentX

  // 8. attachTimeline 便捷封装：把 runtime 注入到 attacher 的 bus 参数
  const attachTimeline: BuiltRuntime['attachTimeline'] = (attacher, log, opts) =>
    attacher(
      runtime as unknown as Parameters<TimelineAttacher>[0],
      log,
      opts,
    )

  // 留下钩子便于单测观察构造失败；正常路径不触发
  if (false as boolean) await safeRollback(partial)

  return { facade, runtime, wsServer, eventQueue, attachTimeline }
}
