/**
 * ToolAPI - 工具运行时统一 API 接口
 *
 * 为工具提供所有运行时功能的单一入口点。
 * 遵循依赖倒置原则，工具只依赖这个抽象接口。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ToolEnvironmentModule = require('./ToolEnvironment')
import ToolLoggerModule = require('./ToolLogger')
import ToolModuleImportModule = require('../module/ToolModuleImport')
import ToolStorageModule = require('./ToolStorage')
import ToolBridgeModule = require('./ToolBridge')

// 各子模块都 export = class，这里通过 typeof 拿构造器签名
type ToolEnvironmentClass = typeof ToolEnvironmentModule
type ToolLoggerClass = typeof ToolLoggerModule
type ToolModuleImportClass = typeof ToolModuleImportModule
type ToolStorageClass = typeof ToolStorageModule
type ToolBridgeClass = typeof ToolBridgeModule

interface ResourceManagerLike {
  executeTool: (toolRef: string, params: Record<string, unknown>) => Promise<unknown>
}

interface ExecuteOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  shell?: boolean | string
  [k: string]: unknown
}

interface ExecuteResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
}

interface ToolInfo {
  id: string
  sandboxPath: string
  runtime: {
    node: string
    platform: string
    arch: string
  }
}

interface ToolInstance {
  [k: string]: unknown
}

class ToolAPI {
  public toolId: string
  public sandboxPath: string
  public resourceManager: ResourceManagerLike | null
  public toolInstance: ToolInstance | null

  // 私有懒加载服务实例
  private _environment: InstanceType<ToolEnvironmentClass> | null
  private _logger: InstanceType<ToolLoggerClass> | null
  private _moduleImport: InstanceType<ToolModuleImportClass> | null
  private _storage: InstanceType<ToolStorageClass> | null
  private _bridge: InstanceType<ToolBridgeClass> | null

  constructor(
    toolId: string,
    sandboxPath: string,
    resourceManager: ResourceManagerLike | null = null,
  ) {
    this.toolId = toolId
    this.sandboxPath = sandboxPath
    this.resourceManager = resourceManager

    // 延迟初始化的服务实例
    this._environment = null
    this._logger = null
    this._moduleImport = null
    this._storage = null
    this._bridge = null

    // 工具实例引用（由 ToolSandbox 设置）
    this.toolInstance = null
  }

  /**
   * 环境变量管理
   */
  get environment(): InstanceType<ToolEnvironmentClass> {
    if (!this._environment) {
      this._environment = new ToolEnvironmentModule(this.toolId, this.sandboxPath)
    }
    return this._environment
  }

  /**
   * 日志记录器
   */
  get logger(): InstanceType<ToolLoggerClass> {
    if (!this._logger) {
      this._logger = new ToolLoggerModule(this.toolId, this.sandboxPath)
    }
    return this._logger
  }

  /**
   * 模块导入器 - 提供智能的模块加载功能
   */
  get moduleImport(): InstanceType<ToolModuleImportClass> {
    if (!this._moduleImport) {
      this._moduleImport = new ToolModuleImportModule(this.toolId, this.sandboxPath)
    }
    return this._moduleImport
  }

  /**
   * 持久化存储 - 完全兼容 localStorage API
   */
  get storage(): InstanceType<ToolStorageClass> {
    if (!this._storage) {
      this._storage = new ToolStorageModule(this.toolId, this.sandboxPath)
    }
    return this._storage
  }

  /**
   * 桥接器 - 管理工具的外部依赖
   */
  get bridge(): InstanceType<ToolBridgeClass> {
    if (!this._bridge) {
      if (!this.toolInstance) {
        throw new Error('Tool instance not set. Bridge requires tool instance.')
      }
      // KNUTH-FIX: ToolBridge 构造器签名 (toolInstance, api)，
      // 这里 this 就是 api（包含 logger 等），TS 推断兼容
      const Ctor = ToolBridgeModule as unknown as new (
        inst: ToolInstance,
        api: ToolAPI,
      ) => InstanceType<ToolBridgeClass>
      this._bridge = new Ctor(this.toolInstance, this)
    }
    return this._bridge
  }

  /**
   * 设置工具实例（由 ToolSandbox 在加载工具后调用）
   */
  setToolInstance(instance: ToolInstance): void {
    this.toolInstance = instance
  }

  /**
   * 智能导入模块 - 工具使用的统一接口
   * 自动处理 CommonJS/ESM 差异，提供一致的导入体验
   */
  async importx(moduleName: string): Promise<unknown> {
    return await this.moduleImport.import(moduleName)
  }

  /**
   * 获取工具元信息
   */
  getInfo(): ToolInfo {
    return {
      id: this.toolId,
      sandboxPath: this.sandboxPath,
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    }
  }

  /**
   * 调用其他工具（工具间通信）
   */
  async callTool(toolId: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.resourceManager) {
      throw new Error('Tool communication requires ResourceManager')
    }

    return await this.resourceManager.executeTool(`@tool://${toolId}`, params)
  }

  /**
   * Execute system command.
   * Powered by execa for better cross-platform support and error handling.
   */
  async execute(
    command: string,
    args: string[] = [],
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    // 延迟加载 execa
    const execaModule = await import('execa')
    const execa = (execaModule as unknown as { execa: (...args: unknown[]) => Promise<unknown> }).execa

    try {
      // KNUTH-NOTE: execa 返回类型结构固定，运行时不影响。避开复杂 generic 类型。
      const result = (await execa(command, args, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout || 30000,
        shell: options.shell || false,
        reject: false, // Don't throw on non-zero exit code
        ...options,
      })) as { exitCode: number | null; stdout: string; stderr: string }

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    } catch (error) {
      // Handle execution errors (e.g., command not found)
      throw new Error(`Failed to execute command: ${(error as Error).message}`)
    }
  }

  /**
   * 获取 API 版本
   */
  getVersion(): string {
    return '2.0.0'
  }
}

export = ToolAPI
