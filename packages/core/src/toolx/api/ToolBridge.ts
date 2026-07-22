/**
 * ToolBridge - 工具外部依赖桥接器
 *
 * 设计理念：
 * - 桥接模式：分离工具逻辑与外部依赖实现
 * - 双轨执行：支持 real 和 mock 两种执行路径
 * - 统一错误：所有错误通过 ToolError 处理
 * - 工具自主：让工具完全控制自己的依赖行为
 *
 * 使用场景：
 * - 外部 API 调用（HTTP 请求、数据库连接等）
 * - 文件系统操作
 * - 第三方服务集成
 * - 任何需要 mock 的外部依赖
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ToolErrorModule = require('../errors/ToolError')

// KNUTH-FIX: ToolError 是 class (`export = ToolError`) 且其静态方法 from/analyze 在 namespace 上。
// 用类实例类型表示 instance，用 ToolErrorStatic 表示静态空间。

interface ToolError {
  message: string
  name: string
  code: string
  category: string
  categoryInfo: Record<string, unknown>
  solution: unknown
  retryable: boolean
  businessError: unknown
  context: Record<string, unknown>
  details: Record<string, unknown>
  originalError: Error | null
  toJSON: () => Record<string, unknown>
}

interface ToolErrorStatic {
  from: (source: unknown, context?: Record<string, unknown>) => ToolError
}

// 构造器（newable）
const ToolError = ToolErrorModule as unknown as new (...args: unknown[]) => ToolError

// 静态方法空间
const ToolErrorStatic = (ToolErrorModule as unknown as ToolErrorStatic)

interface ApiLike {
  logger: {
    debug: (msg: string, meta?: unknown) => void
    info: (msg: string, meta?: unknown) => void
  }
  toolId?: string
}

interface BridgeDefinition {
  real?: (args: unknown, api: ApiLike) => Promise<unknown> | unknown
  mock?: (args: unknown, api: ApiLike) => Promise<unknown> | unknown
}

interface BridgeOperationInfo {
  operation: string
  hasReal: boolean
  hasMock: boolean
}

interface BridgeErrorContext {
  operation?: string
  mode?: string
  bridgeName?: string
  [k: string]: unknown
}

interface BridgeErrorDef {
  code: string
  description: string
  category: string
  getSolution: (error: Error | null, context: BridgeErrorContext) => string
}

interface DryRunResult {
  success: boolean
  operation: string
  result?: unknown
  error?: unknown
}

interface DryRunSummary {
  total: number
  success: number
  failed: number
}

interface DryRunAllResult {
  summary: DryRunSummary
  results: Record<string, DryRunResult>
}

type BridgeMode = 'execute' | 'dryrun'

class ToolBridge {
  static BRIDGE_ERRORS: Record<string, BridgeErrorDef> = {
    NO_BRIDGE_DEFINED: {
      code: 'NO_BRIDGE_DEFINED',
      description: '未定义桥接器',
      category: 'DEVELOPMENT',
      getSolution: (_error, context) => {
        return `请在工具的 getBridges() 方法中定义 '${context.operation}' 桥接器`
      },
    },
    NO_IMPLEMENTATION: {
      code: 'NO_BRIDGE_IMPLEMENTATION',
      description: '缺少桥接实现',
      category: 'DEVELOPMENT',
      getSolution: (_error, context) => {
        return `Bridge '${context.operation}' 缺少 ${context.mode} 实现`
      },
    },
    BRIDGE_EXECUTION_FAILED: {
      code: 'BRIDGE_EXECUTION_FAILED',
      description: '桥接执行失败',
      category: 'BUSINESS',
      getSolution: (_error, context) => {
        if (context.mode === 'dryrun') {
          return 'Mock 实现出错，请检查 mock 逻辑'
        }
        return '外部依赖调用失败，请检查连接和参数'
      },
    },
    INVALID_BRIDGE_DEFINITION: {
      code: 'INVALID_BRIDGE_DEFINITION',
      description: '无效的桥接定义',
      category: 'DEVELOPMENT',
      getSolution: (_error, context) => {
        return `Bridge '${context.bridgeName}' 定义格式错误：real 和 mock 必须是函数`
      },
    },
  }

  public toolInstance: Record<string, unknown> & {
    getBridges?: () => Record<string, BridgeDefinition>
    getBridgeErrors?: () => Record<string, unknown[]>
    getMockArgs?: (operation: string) => unknown
  }
  public api: ApiLike
  public mode: BridgeMode
  public bridges: Record<string, BridgeDefinition> | null

  constructor(toolInstance: ToolBridge['toolInstance'], api: ApiLike) {
    this.toolInstance = toolInstance
    this.api = api
    this.mode = 'execute' // 'execute' | 'dryrun'
    this.bridges = null // 缓存的 bridge 定义
  }

  /**
   * 执行桥接操作
   */
  async execute(operation: string, args: unknown): Promise<unknown> {
    try {
      // 延迟加载 bridges
      if (!this.bridges) {
        this.loadBridges()
      }

      const bridges = this.bridges ?? ({} as Record<string, BridgeDefinition>)
      const bridge = bridges[operation]
      if (!bridge) {
        throw new ToolError(
          `Bridge '${operation}' not defined`,
          ToolBridge.BRIDGE_ERRORS.NO_BRIDGE_DEFINED!.code,
          {
            category: 'DEVELOPMENT',
            solution: ToolBridge.BRIDGE_ERRORS.NO_BRIDGE_DEFINED!.getSolution(null, { operation }),
            context: { operation, availableBridges: Object.keys(bridges) },
          },
        )
      }

      // 选择实现路径
      const implementation = this.mode === 'dryrun' ? bridge.mock : bridge.real

      if (!implementation) {
        throw new ToolError(
          `No ${this.mode} implementation for bridge: ${operation}`,
          ToolBridge.BRIDGE_ERRORS.NO_IMPLEMENTATION!.code,
          {
            category: 'DEVELOPMENT',
            solution: ToolBridge.BRIDGE_ERRORS.NO_IMPLEMENTATION!.getSolution(null, {
              operation,
              mode: this.mode,
            }),
            context: { operation, mode: this.mode },
          },
        )
      }

      // 执行并记录
      this.api.logger.debug(`[Bridge] ${this.mode}: ${operation}`)

      const result = await implementation.call(this.toolInstance, args, this.api)
      this.api.logger.debug(`[Bridge] Success: ${operation}`)
      return result
    } catch (error) {
      // 如果已经是 ToolError，保持原样
      if (error instanceof ToolError) {
        throw error
      }

      // 包装为 ToolError，添加 bridge 上下文
      throw ToolErrorStatic.from(error, {
        bridge: operation,
        mode: this.mode,
        args,
        // 传递工具的业务错误定义，用于错误分析
        businessErrors: this.getBridgeBusinessErrors(operation),
      })
    }
  }

  /**
   * 获取特定 bridge 的业务错误定义
   */
  getBridgeBusinessErrors(operation: string): unknown[] {
    // 工具可以为每个 bridge 定义特定的业务错误
    if (typeof this.toolInstance.getBridgeErrors === 'function') {
      const allErrors = this.toolInstance.getBridgeErrors()
      return allErrors[operation] || []
    }
    return []
  }

  /**
   * 加载工具定义的 bridges
   */
  loadBridges(): void {
    try {
      // 检查工具是否支持 bridges
      if (typeof this.toolInstance.getBridges !== 'function') {
        this.bridges = {}
        this.api.logger.debug('[Bridge] Tool does not support bridges')
        return
      }

      const result = this.toolInstance.getBridges()
      this.bridges = result

      // 验证 bridge 定义
      for (const [name, bridge] of Object.entries(result)) {
        this.validateBridge(name, bridge)
      }

      this.api.logger.info(`[Bridge] Loaded ${Object.keys(result).length} bridges`)
    } catch (error) {
      throw ToolErrorStatic.from(error, {
        phase: 'bridge_loading',
        toolId: this.api.toolId,
      })
    }
  }

  /**
   * 验证 bridge 定义
   */
  validateBridge(name: string, bridge: BridgeDefinition): void {
    if (!bridge || typeof bridge !== 'object') {
      throw new ToolError(
        `Bridge '${name}' must be an object`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION!.code,
        {
          category: 'DEVELOPMENT',
          solution: `Bridge 必须是包含 real 和/或 mock 函数的对象`,
          context: { bridgeName: name },
        },
      )
    }

    if (!bridge.real && !bridge.mock) {
      throw new ToolError(
        `Bridge '${name}' must have at least one implementation`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION!.code,
        {
          category: 'DEVELOPMENT',
          solution: `Bridge 必须至少包含 real 或 mock 实现之一`,
          context: { bridgeName: name },
        },
      )
    }

    if (bridge.real && typeof bridge.real !== 'function') {
      throw new ToolError(
        `Bridge '${name}' real implementation must be a function`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION!.code,
        {
          category: 'DEVELOPMENT',
          solution: `real 必须是异步函数: async (args, api) => {...}`,
          context: { bridgeName: name },
        },
      )
    }

    if (bridge.mock && typeof bridge.mock !== 'function') {
      throw new ToolError(
        `Bridge '${name}' mock implementation must be a function`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION!.code,
        {
          category: 'DEVELOPMENT',
          solution: `mock 必须是异步函数: async (args, api) => {...}`,
          context: { bridgeName: name },
        },
      )
    }
  }

  /**
   * 设置执行模式
   */
  setMode(mode: BridgeMode): void {
    if (!['execute', 'dryrun'].includes(mode)) {
      throw new ToolError(
        `Invalid mode: ${mode}`,
        'INVALID_BRIDGE_MODE',
        {
          category: 'VALIDATION',
          solution: `Mode 必须是 'execute' 或 'dryrun'`,
          context: { providedMode: mode },
        },
      )
    }

    const previousMode = this.mode
    this.mode = mode
    this.api.logger.info(`[Bridge] Mode changed from '${previousMode}' to '${mode}'`)
  }

  /**
   * 获取当前执行模式
   */
  getMode(): BridgeMode {
    return this.mode
  }

  /**
   * 检查是否处于 dry-run 模式
   */
  isDryRun(): boolean {
    return this.mode === 'dryrun'
  }

  /**
   * 执行 dry-run 测试
   */
  async dryRun(operation: string, mockArgs: Record<string, unknown> = {}): Promise<DryRunResult> {
    const originalMode = this.mode

    try {
      this.setMode('dryrun')
      const result = await this.execute(operation, mockArgs)
      return {
        success: true,
        operation,
        result,
      }
    } catch (error) {
      const err = error as Error | ToolError
      return {
        success: false,
        operation,
        error: err instanceof ToolError ? err.toJSON() : {
          message: err.message,
          code: 'DRYRUN_FAILED',
        },
      }
    } finally {
      this.setMode(originalMode)
    }
  }

  /**
   * 批量 dry-run 所有 bridges
   */
  async dryRunAll(): Promise<DryRunAllResult> {
    if (!this.bridges) {
      this.loadBridges()
    }

    const bridges = this.bridges ?? ({} as Record<string, BridgeDefinition>)
    const results: Record<string, DryRunResult> = {}

    for (const operation of Object.keys(bridges)) {
      // 为每个 bridge 生成默认的 mock 参数
      const mockArgs = this.generateMockArgs(operation) as Record<string, unknown>
      results[operation] = await this.dryRun(operation, mockArgs)
    }

    const successCount = Object.values(results).filter((r) => r.success).length
    const totalCount = Object.keys(results).length

    this.api.logger.info(`[Bridge] Dry-run completed: ${successCount}/${totalCount} passed`)

    return {
      summary: {
        total: totalCount,
        success: successCount,
        failed: totalCount - successCount,
      },
      results,
    }
  }

  /**
   * 生成 mock 参数（可被工具覆盖）
   */
  generateMockArgs(operation: string): unknown {
    // 优先使用工具定义的 mock 参数
    if (typeof this.toolInstance.getMockArgs === 'function') {
      const toolMockArgs = this.toolInstance.getMockArgs(operation)
      if (toolMockArgs !== undefined) {
        return toolMockArgs
      }
    }

    // 默认 mock 参数（基于常见模式）
    const defaults: Record<string, Record<string, unknown>> = {
      // 数据库相关
      'mysql:connect': { host: 'localhost', user: 'test', password: 'test', database: 'test' },
      'mysql:query': { sql: 'SELECT 1', values: [] },
      'postgres:connect': { host: 'localhost', user: 'test', password: 'test', database: 'test' },
      'mongodb:connect': { uri: 'mongodb://localhost:27017/test' },

      // HTTP 相关
      'http:request': { url: 'https://example.com', method: 'GET' },
      'http:get': { url: 'https://example.com/api/test' },
      'http:post': { url: 'https://example.com/api/test', data: {} },

      // 文件系统相关
      'fs:read': { path: '/tmp/test.txt' },
      'fs:write': { path: '/tmp/test.txt', content: 'test' },

      // 消息队列相关
      'redis:connect': { host: 'localhost', port: 6379 },
      'rabbitmq:connect': { url: 'amqp://localhost' },

      // 云服务相关
      's3:upload': { bucket: 'test-bucket', key: 'test-key', body: 'test' },
      'email:send': { to: 'test@example.com', subject: 'Test', body: 'Test message' },
    }

    // 返回匹配的默认参数，如果没有则返回空对象
    return defaults[operation] || {}
  }

  /**
   * 获取所有已定义的 bridge 操作列表
   */
  getBridgeOperations(): BridgeOperationInfo[] {
    if (!this.bridges) {
      this.loadBridges()
    }

    const bridges = this.bridges ?? ({} as Record<string, BridgeDefinition>)
    return Object.keys(bridges).map((operation) => {
      const bridge = bridges[operation]
      if (!bridge) {
        return { operation, hasReal: false, hasMock: false }
      }
      return {
        operation,
        hasReal: !!bridge.real,
        hasMock: !!bridge.mock,
      }
    })
  }
}

export = ToolBridge
