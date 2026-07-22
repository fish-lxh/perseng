/**
 * ToolSandbox - Tool sandbox environment manager
 *
 * Unified module loading architecture completely based on importx：
 * - @tool:// protocol for tool location
 * - @user://.perseng/toolbox sandbox isolation
 * - Automatic dependency management
 * - Reusable execution environment
 * - Unified importx module loading
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import path from 'path'
import os from 'os'
import { promises as fs } from 'fs'

// 顶层延迟引用 errors/*.js —— 这些文件已迁移为 .ts，
// eslint-disable-next-line @typescript-eslint/no-var-requires
const errorsModule = require('./errors') as {
  ToolError: new (...args: unknown[]) => ToolErrorInstance
  VALIDATION_ERRORS: { [k: string]: { code: string; description?: string } }
  SYSTEM_ERRORS: { [k: string]: { code: string } }
  DEVELOPMENT_ERRORS: { [k: string]: { code: string } }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ToolDirectoryManagerModule = require('./ToolDirectoryManager') as new (...args: unknown[]) => ToolDirectoryManagerInstance

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SandboxIsolationManagerModule = require('./SandboxIsolationManager') as new (...args: unknown[]) => SandboxIsolationManagerInstance

interface ToolErrorInstance extends Error {
  code: string
  category: string
  message: string
  toJSON: () => Record<string, unknown>
}

interface ToolErrorStaticLike {
  from: (source: unknown, context?: Record<string, unknown>) => ToolErrorInstance
}

interface ToolDirectoryManagerInstance {
  initialize: () => Promise<void>
  ensureDirectories: () => Promise<void>
  getToolboxPath: () => Promise<string>
  deleteToolbox: () => Promise<void>
}

interface SandboxIsolationManagerInstance {
  createIsolatedContext: () => Record<string, unknown>
}

interface ResourceManagerLike {
  loadResource: (ref: string) => Promise<{ success: boolean; content?: string; error?: { message: string } }>
}

interface VmType {
  Script: new (code: string, options?: { filename?: string }) => { runInContext: (ctx: unknown) => void }
  createContext: (sandboxObj: Record<string, unknown>) => unknown
}

interface ToolApiStaticLike {
  new (toolId: string, sandboxPath: string, resourceManager: ResourceManagerLike | null): ToolApiInstance
}

interface ToolApiInstance {
  environment: { get: (k: string) => Promise<string | undefined>; envPath: string }
  bridge: { setMode: (m: 'execute' | 'dryrun') => void; dryRunAll: () => Promise<unknown> } | null
  setToolInstance: (instance: Record<string, unknown>) => void
}

interface ToolModuleImportStaticLike {
  new (toolId: string, sandboxPath: string): { import: (m: string) => Promise<unknown> }
}

interface PackageInstallerStaticLike {
  createPackageJson: (workingDir: string, toolId: string, dependencies: Record<string, string>) => Promise<void>
  install: (opts: { workingDir: string; dependencies: Record<string, string>; timeout?: number }) => Promise<unknown>
}

interface ToolValidatorStaticLike {
  defaultValidate: (tool: Record<string, unknown>, params: Record<string, unknown>) => {
    valid: boolean
    errors: string[]
    missing: string[]
    typeErrors: Array<{ param: string; expected: string; actual: string }>
    enumErrors?: unknown[]
  }
}

interface ToolLoggerLike {
  debug: (msg: string) => void
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

function getToolError(): ToolErrorStaticLike {
  return errorsModule as unknown as ToolErrorStaticLike
}

interface AnalyzeResult {
  toolId: string | null
  dependencies: Record<string, string>
  sandboxPath: string | null
  hasMetadata: boolean
  hasSchema: boolean
}

class ToolSandbox {
  public toolReference: string
  public options: Record<string, unknown>
  public resourceManager: ResourceManagerLike | null
  public toolId: string | null
  public toolContent: string | null
  public toolInstance: Record<string, unknown> | null
  public dependencies: Record<string, string>
  public directoryManager: ToolDirectoryManagerInstance | null
  public sandboxPath: string | null
  public sandboxContext: Record<string, unknown> | null
  public isolationManager: SandboxIsolationManagerInstance | null

  private vm: VmType | null
  private logger: ToolLoggerLike | null

  private isAnalyzed: boolean
  private isPrepared: boolean
  private isInitialized: boolean

  constructor(toolReference: string, options: Record<string, unknown> = {}) {
    this.toolReference = toolReference
    this.resourceManager = null
    this.toolId = null
    this.toolContent = null
    this.toolInstance = null
    this.dependencies = {}
    this.directoryManager = null
    this.sandboxPath = null
    this.sandboxContext = null
    this.isolationManager = null

    this.vm = null
    this.logger = null

    this.isAnalyzed = false
    this.isPrepared = false
    this.isInitialized = false

    this.options = {
      timeout: 30000,
      enableDependencyInstall: true,
      rebuild: false,
      ...options,
    }
  }

  /**
   * 异步初始化 - 加载所有必需的模块
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      const loggerModule = (await import('@promptx/logger')) as { default: ToolLoggerLike }
      this.logger = loggerModule.default

      this.vm = require('vm') as VmType

      const persengPath = path.join(os.homedir(), '.perseng')
      this.isolationManager = new SandboxIsolationManagerModule(persengPath)

      this.isInitialized = true
      this.logger.debug('[ToolSandbox] Initialized with importx')
    } catch (error) {
      const TE = errorsModule.ToolError
      throw new TE(
        `Failed to initialize ToolSandbox: ${(error as Error).message}`,
        (errorsModule.SYSTEM_ERRORS.SANDBOX_INIT_FAILED as { code: string }).code,
        { originalError: (error as Error).message },
      )
    }
  }

  /**
   * 静态工厂方法 - 创建已初始化的 ToolSandbox 实例
   */
  static async create(toolReference: string, options: Record<string, unknown> = {}): Promise<ToolSandbox> {
    const sandbox = new ToolSandbox(toolReference, options)
    await sandbox.init()
    return sandbox
  }

  /**
   * 设置 ResourceManager 实例
   */
  setResourceManager(resourceManager: ResourceManagerLike): void {
    this.resourceManager = resourceManager
  }

  /**
   * 清理沙箱状态和缓存
   */
  async clearSandbox(deleteDirectory = false): Promise<void> {
    await this.ensureInitialized()
    if (!this.logger) return
    this.logger.debug(`[ToolSandbox] Clearing sandbox state${deleteDirectory ? ' and deleting directory' : ''}`)

    this.isAnalyzed = false
    this.isPrepared = false
    this.toolContent = null
    this.toolInstance = null
    this.dependencies = {}
    this.sandboxContext = null

    if (deleteDirectory && this.directoryManager) {
      try {
        await this.directoryManager.deleteToolbox()
      } catch (error) {
        this.logger.debug(`[ToolSandbox] Error deleting toolbox directory (can be ignored): ${(error as Error).message}`)
      }
    }
  }

  /**
   * 确保已初始化
   */
  async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init()
    }
  }

  /**
   * 分析工具：加载工具内容，提取元信息和依赖
   */
  async analyze(): Promise<AnalyzeResult> {
    await this.ensureInitialized()
    if (!this.logger) throw new Error('Logger not initialized')

    if (this.isAnalyzed && !this.options.rebuild) {
      this.logger.debug(`[ToolSandbox] Using cached analysis result, dependencies: ${JSON.stringify(this.dependencies)}`)
      return this.getAnalysisResult()
    }

    if (!this.resourceManager) {
      throw new Error('[BUG] ResourceManager should be set during initialization')
    }

    try {
      // 1. 解析工具引用
      this.toolId = this.extractToolId(this.toolReference)

      // 2. 通过 ResourceManager 加载工具内容
      this.logger.debug(`[ToolSandbox] Loading tool content for: ${this.toolReference}`)
      const resourceResult = await this.resourceManager.loadResource(this.toolReference)

      if (!resourceResult.success) {
        const TE = errorsModule.ToolError
        const sysErr = errorsModule.SYSTEM_ERRORS.TOOL_NOT_FOUND as { code: string }
        throw new TE(
          `Failed to load tool: ${resourceResult.error?.message || 'Unknown error'}`,
          sysErr.code,
          { toolId: this.toolId },
        )
      }

      this.toolContent = resourceResult.content ?? ''
      this.logger.debug(`[ToolSandbox] Tool content loaded successfully`)

      // 3. 解析工具实例以提取依赖
      this.toolInstance = this.parseToolContent(this.toolContent)

      const toolInst = this.toolInstance as { getDependencies?: () => Record<string, string> }
      if (typeof toolInst.getDependencies === 'function') {
        this.dependencies = toolInst.getDependencies() || {}
      } else {
        this.dependencies = {}
      }

      // 4. 初始化目录管理器
      this.directoryManager = new ToolDirectoryManagerModule(this.toolId, this.resourceManager)
      await this.directoryManager.initialize()
      this.sandboxPath = await this.directoryManager.getToolboxPath()

      this.isAnalyzed = true
      this.logger.debug(`[ToolSandbox] Analysis completed. Dependencies: ${JSON.stringify(this.dependencies)}`)

      return this.getAnalysisResult()
    } catch (error) {
      const enhancedError = getToolError().from(error, {
        phase: 'analyze',
        toolReference: this.toolReference,
        toolId: this.toolId,
        dependencies: this.dependencies,
      })
      this.logger.error(`[ToolSandbox] Analysis failed: ${(enhancedError as Error).message}`)
      throw enhancedError
    }
  }

  /**
   * 准备依赖环境
   */
  async prepareDependencies(): Promise<{ success: boolean; message: string }> {
    await this.ensureInitialized()
    if (!this.logger || !this.directoryManager) throw new Error('Not initialized')

    if (this.isPrepared && !this.options.rebuild) {
      this.logger.debug('[ToolSandbox] Dependencies already prepared')
      return { success: true, message: 'Dependencies already prepared' }
    }

    // 框架应该保证调用顺序，这里只是 assert
    // eslint-disable-next-line no-console
    console.assert(this.isAnalyzed, '[BUG] Tool should be analyzed before preparing dependencies')

    try {
      // 1. 确保沙箱目录存在
      await this.directoryManager.ensureDirectories()

      // 2. 如果有依赖，智能处理它们
      if (Object.keys(this.dependencies).length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { analyzeToolDependencies } = require('@promptx/resource') as {
            analyzeToolDependencies: (deps: Record<string, string>) => {
              preinstalled: Record<string, string>
              required: Record<string, string>
              sources: Record<string, string>
            }
          }
          const analysis = analyzeToolDependencies(this.dependencies)

          this.logger.info(
            `[ToolSandbox] Dependency analysis: ` +
              `${Object.keys(analysis.preinstalled).length} preinstalled, ` +
              `${Object.keys(analysis.required).length} need installation`,
          )

          for (const [dep, source] of Object.entries(analysis.sources)) {
            this.logger.debug(`[ToolSandbox] Using preinstalled: ${dep} from ${source}`)
          }

          if (Object.keys(analysis.required).length > 0) {
            this.logger.debug(`[ToolSandbox] Installing required dependencies: ${JSON.stringify(analysis.required)}`)
            const originalDeps = this.dependencies
            this.dependencies = analysis.required
            await this.installDependencies()
            this.dependencies = originalDeps
          } else {
            this.logger.info('[ToolSandbox] All dependencies are preinstalled, skipping installation!')
          }
        } catch (error) {
          this.logger.warn(`[ToolSandbox] Dependency analysis failed, falling back to full install: ${(error as Error).message}`)
          await this.installDependencies()
        }
      } else {
        this.logger.debug('[ToolSandbox] No dependencies to install')
      }

      // 3. 创建执行沙箱环境
      await this.createExecutionSandbox()

      this.isPrepared = true
      this.logger.debug('[ToolSandbox] Dependencies prepared successfully')

      return { success: true, message: 'Dependencies prepared successfully' }
    } catch (error) {
      const enhancedError = getToolError().from(error, {
        phase: 'prepareDependencies',
        toolId: this.toolId,
        dependencies: this.dependencies,
        sandboxPath: this.sandboxPath,
      })
      this.logger.error(`[ToolSandbox] Dependency preparation failed: ${(enhancedError as Error).message}`)
      throw enhancedError
    }
  }

  /**
   * 配置环境变量
   */
  async configureEnvironment(params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureInitialized()
    if (!this.logger) throw new Error('Not initialized')

    // eslint-disable-next-line no-console
    console.assert(this.isAnalyzed, '[BUG] Tool should be analyzed before configuring')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ToolAPI = require('./api/ToolAPI') as ToolApiStaticLike
    const api = new ToolAPI(this.toolId || '', this.sandboxPath || '', this.resourceManager)
    const env = api.environment

    try {
      if (!params || Object.keys(params).length === 0) {
        this.logger.debug(`[ToolSandbox] Getting current environment configuration for ${this.toolId}`)

        let declaredVars: Record<string, { required: boolean; description?: string; default?: unknown }> = {}
        const toolInst = this.toolInstance as { getSchema?: () => { environment?: { properties?: Record<string, { description?: string; default?: unknown }>; required?: string[] } } } | null
        if (toolInst && typeof toolInst.getSchema === 'function') {
          const schema = toolInst.getSchema()
          if (schema.environment && schema.environment.properties) {
            const envSchema = schema.environment
            const requiredVars = envSchema.required || []
            for (const [varName, varSpec] of Object.entries(envSchema.properties || {})) {
              declaredVars[varName] = {
                required: requiredVars.includes(varName),
                description: varSpec.description,
                default: varSpec.default,
              }
            }
          }
        }

        const currentVars = await env.get('').then(() => env).then(async () => {
          // KNUTH-NOTE: ToolEnvironment 没有 getAll() TS 接口，沿用 .js
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (await (env as { getAll?: () => Promise<Record<string, string>> }).getAll?.()) || {}
        })
        // 简化处理：env.getAll 预期返回 Record<string, string>
        void currentVars

        const status: Record<string, unknown> = {}
        for (const [varName, varDef] of Object.entries(declaredVars)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value = await (env as any).get?.(varName)
          status[varName] = {
            required: varDef.required || false,
            configured: value !== undefined,
            value: value ? '***' : undefined,
            description: varDef.description,
            default: varDef.default,
          }
        }

        return {
          action: 'get',
          toolId: this.toolId,
          envPath: env.envPath,
          variables: status,
          summary: {
            total: Object.keys(status).length,
            configured: Object.values(status).filter((v) => (v as { configured?: boolean }).configured).length,
            required: Object.values(status).filter((v) => (v as { required?: boolean }).required).length,
            missing: Object.values(status).filter((v) => {
              const sv = v as { required?: boolean; configured?: boolean }
              return sv.required && !sv.configured
            }).length,
          },
        }
      }

      // 特殊操作
      if (params._action === 'clear') {
        this.logger.info(`[ToolSandbox] Clearing all environment variables for ${this.toolId}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (env as any).clear()
        return { action: 'clear', success: true, message: 'All environment variables cleared' }
      }

      if (params._action === 'delete' && Array.isArray(params._keys)) {
        this.logger.info(`[ToolSandbox] Deleting environment variables for ${this.toolId}`)
        const deleted: string[] = []
        for (const key of params._keys) {
          if (typeof key === 'string') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (await (env as any).delete(key)) {
              deleted.push(key)
            }
          }
        }
        return { action: 'delete', success: true, deleted }
      }

      // 设置环境变量
      this.logger.info(`[ToolSandbox] Setting environment variables for ${this.toolId}`)
      const configured: string[] = []
      for (const [key, value] of Object.entries(params)) {
        if (!key.startsWith('_')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (env as any).set(key, value)
          configured.push(key)
        }
      }

      return {
        action: 'set',
        success: true,
        configured,
        envPath: env.envPath,
        message: `Configured ${configured.length} environment variable(s)`,
      }
    } catch (error) {
      const enhancedError = getToolError().from(error, {
        phase: 'configure',
        toolId: this.toolId,
        params,
      })
      this.logger.error(`[ToolSandbox] Configuration failed: ${(enhancedError as Error).message}`)
      throw enhancedError
    }
  }

  /**
   * 查询工具日志
   */
  async queryLogs(params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureInitialized()
    if (!this.logger) throw new Error('Not initialized')

    // eslint-disable-next-line no-console
    console.assert(this.isAnalyzed, '[BUG] Tool should be analyzed before querying logs')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ToolLoggerQueryModule = require('./ToolLoggerQuery') as new (toolId: string, sandboxPath: string) => {
      tail: (n: number) => Promise<unknown>
      search: (keyword: string, options?: unknown) => Promise<unknown>
      getErrors: (limit: number) => Promise<unknown>
      getStats: () => Promise<unknown>
      getByTimeRange: (start: string, end: string) => Promise<unknown>
      clear: () => Promise<boolean>
    }

    const logQuery = new ToolLoggerQueryModule(this.toolId || '', this.sandboxPath || '')

    try {
      const action = (params.action as string) || 'tail'
      const options: Record<string, unknown> = { ...params }
      delete options.action

      switch (action) {
        case 'tail': {
          const lines = (options.lines as number) || 50
          return { success: true, action: 'tail', logs: await logQuery.tail(lines), count: lines }
        }
        case 'search': {
          if (!options.keyword) {
            const TE = errorsModule.ToolError
            const vErr = errorsModule.VALIDATION_ERRORS.MISSING_REQUIRED_PARAM as { code: string }
            throw new TE('Search action requires keyword parameter', vErr.code, { param: 'keyword' })
          }
          return {
            success: true,
            action: 'search',
            keyword: options.keyword,
            logs: await logQuery.search(options.keyword as string, options),
            options,
          }
        }
        case 'errors': {
          const limit = (options.limit as number) || 50
          return { success: true, action: 'errors', logs: await logQuery.getErrors(limit), limit }
        }
        case 'stats':
          return { success: true, action: 'stats', stats: await logQuery.getStats() }
        case 'timeRange': {
          if (!options.startTime || !options.endTime) {
            const TE = errorsModule.ToolError
            const vErr = errorsModule.VALIDATION_ERRORS.MISSING_REQUIRED_PARAM as { code: string }
            throw new TE('Time range action requires startTime and endTime parameters', vErr.code, {
              params: ['startTime', 'endTime'],
            })
          }
          return {
            success: true,
            action: 'timeRange',
            startTime: options.startTime,
            endTime: options.endTime,
            logs: await logQuery.getByTimeRange(options.startTime as string, options.endTime as string),
          }
        }
        case 'clear': {
          const cleared = await logQuery.clear()
          return { success: cleared, action: 'clear', message: cleared ? 'Logs cleared successfully' : 'Failed to clear logs' }
        }
        default: {
          const TE = errorsModule.ToolError
          const vErr = errorsModule.VALIDATION_ERRORS.INVALID_PARAM_VALUE as { code: string } | undefined
          throw new TE(
            `Unknown log query action: ${action}`,
            (vErr && vErr.code) || 'INVALID_PARAM',
            { param: 'action', value: action },
          )
        }
      }
    } catch (error) {
      const enhancedError = getToolError().from(error, {
        phase: 'queryLogs',
        toolId: this.toolId,
        params,
      })
      this.logger.error(`[ToolSandbox] Log query failed: ${(enhancedError as Error).message}`)
      throw enhancedError
    }
  }

  /**
   * 执行工具 dry-run 测试
   */
  async dryRun(params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureInitialized()
    if (!this.logger || !this.vm) throw new Error('Not initialized')

    if (!this.isPrepared) {
      await this.prepareDependencies()
    }

    try {
      const script = new this.vm.Script(this.toolContent || '', { filename: `${this.toolId}.js` })
      const context = this.vm.createContext(this.sandboxContext || {})
      script.runInContext(context)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctxAny = context as any
      const exported = ctxAny.module.exports as Record<string, unknown>

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ToolAPI = require('./api/ToolAPI') as ToolApiStaticLike
      const toolAPI = new ToolAPI(this.toolId || '', this.sandboxPath || '', this.resourceManager)
      toolAPI.setToolInstance(exported)

      if (toolAPI.bridge) {
        toolAPI.bridge.setMode('dryrun')
      }

      exported.api = toolAPI

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (exported.execute as any)(params)

      let bridgeTestResults: unknown = null
      if (typeof exported.getBridges === 'function' && toolAPI.bridge) {
        bridgeTestResults = await toolAPI.bridge.dryRunAll()
      }

      return { success: true, result, bridgeTests: bridgeTestResults, message: 'Dry-run completed successfully' }
    } catch (error) {
      const enhancedError = getToolError().from(error, {
        phase: 'dryrun',
        toolId: this.toolId,
        params,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return {
        success: false,
        error: (enhancedError as any).toJSON ? (enhancedError as any).toJSON() : { message: (enhancedError as Error).message },
        message: `Dry-run failed: ${(enhancedError as Error).message}`,
      }
    }
  }

  /**
   * 执行工具
   */
  async execute(params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureInitialized()
    if (!this.logger || !this.vm) throw new Error('Not initialized')

    // eslint-disable-next-line no-console
    console.assert(this.isPrepared, '[BUG] Dependencies should be prepared before execution')

    let businessErrors: unknown[] = []
    let exported: Record<string, unknown> | null = null

    try {
      // 环境变量自动检查
      const configActions = ['configure', 'config', 'setup', 'init', 'check', 'info']
      const isConfigAction = params.action && configActions.includes(String(params.action).toLowerCase())

      const toolInst = this.toolInstance as { getSchema?: () => { environment?: { required?: string[]; properties?: Record<string, { description?: string }> } } } | null

      if (!isConfigAction && toolInst && typeof toolInst.getSchema === 'function') {
        const schema = toolInst.getSchema()
        if (schema.environment) {
          this.logger.debug(`[ToolSandbox] Checking environment variables for ${this.toolId}`)
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ToolAPI = require('./api/ToolAPI') as ToolApiStaticLike
          const api = new ToolAPI(this.toolId || '', this.sandboxPath || '', this.resourceManager)
          const env = api.environment

          const envSchema = schema.environment
          const requiredVars = envSchema.required || []

          for (const varName of requiredVars) {
            const value = await env.get(varName)
            if (!value) {
              const varSpec = envSchema.properties?.[varName]
              this.logger.warn(`[ToolSandbox] Missing required environment variable: ${varName}`)
              return {
                success: false,
                error: {
                  code: 'MISSING_ENV_VAR',
                  message: `缺少必需的环境变量: ${varName}`,
                  details: {
                    missing: varName,
                    description: varSpec?.description || `请配置 ${varName}`,
                    instruction: `请使用 action: "configure" 配置环境变量，或直接编辑 ${env.envPath} 文件`,
                    envPath: env.envPath,
                  },
                },
              }
            }
          }
          this.logger.debug(`[ToolSandbox] All required environment variables are configured`)
        }
      }

      // 参数验证
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ToolValidatorModule = require('./ToolValidator') as ToolValidatorStaticLike
      if (!this.toolInstance) throw new Error('Tool instance not initialized')
      const validation = ToolValidatorModule.defaultValidate(this.toolInstance, params)
      if (!validation.valid) {
        this.logger.error(`[ToolSandbox] 参数验证失败: ${validation.errors.join('; ')}`)

        const error = new Error(validation.errors.join('; '))
        const toolInstForSchema = this.toolInstance as { getSchema?: () => unknown }
        const schema = toolInstForSchema.getSchema ? toolInstForSchema.getSchema() : {}
        throw getToolError().from(error, {
          validationResult: {
            valid: false,
            errors: validation.errors,
            missing: validation.missing,
            typeErrors: validation.typeErrors,
            enumErrors: validation.enumErrors,
          },
          schema,
          params,
          toolName: this.toolId,
        })
      }

      // 执行
      const startTime = Date.now()
      this.logger.debug(`[ToolSandbox] Executing tool with params: ${JSON.stringify(params)}`)

      const script = new this.vm.Script(this.toolContent || '', { filename: `${this.toolId}.js` })
      const context = this.vm.createContext(this.sandboxContext || {})
      script.runInContext(context)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exported = (context as any).module.exports as Record<string, unknown>

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ToolAPI = require('./api/ToolAPI') as ToolApiStaticLike
      const toolAPI = new ToolAPI(this.toolId || '', this.sandboxPath || '', this.resourceManager)
      toolAPI.setToolInstance(exported)
      exported.api = toolAPI

      // 业务错误
      try {
        const expGetBiz = exported.getBusinessErrors as (() => unknown[]) | undefined
        if (typeof expGetBiz === 'function') {
          businessErrors = expGetBiz.call(exported) || []
          this.logger.debug(`[ToolSandbox] Got ${businessErrors.length} business errors from tool`)
        }
      } catch (e) {
        this.logger.warn(`[ToolSandbox] Failed to get business errors: ${(e as Error).message}`)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (exported.execute as any)(params)

      const executionTime = Date.now() - startTime
      this.logger.debug(`[ToolSandbox] Tool execution completed in ${executionTime}ms`)

      return result
    } catch (error) {
      const TE = errorsModule.ToolError
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (error instanceof TE && (TE as any) === errorsModule.ToolError) {
        throw error
      }

      this.logger.error(`[ToolSandbox] Execution failed: ${(error as Error).message}`)
      throw getToolError().from(error, {
        phase: 'execute',
        toolId: this.toolId,
        params,
        businessErrors,
      })
    }
  }

  /**
   * 创建执行沙箱环境
   */
  async createExecutionSandbox(): Promise<void> {
    if (!this.vm || !this.logger) throw new Error('Not initialized')
    const hasNodeModules = await this.checkNodeModulesExists()

    let context: Record<string, unknown>
    if (hasNodeModules) {
      this.logger.debug('[ToolSandbox] Creating smart sandbox with dependency support')
      context = this.vm.createContext(this.createSmartSandboxEnvironment()) as Record<string, unknown>
    } else {
      this.logger.debug('[ToolSandbox] Creating basic sandbox without dependencies')
      context = this.vm.createContext(this.createBasicSandboxEnvironment()) as Record<string, unknown>
    }
    this.sandboxContext = context

    // polyfills 注入到全局
    const ctxAny = context as { File?: unknown; Blob?: unknown; FormData?: unknown }
    const g = globalThis as unknown as Record<string, unknown>
    if (typeof g.File === 'undefined' && ctxAny.File) {
      g.File = ctxAny.File
      this.logger.info('[ToolSandbox] Injected File polyfill to global')
    }
    if (typeof g.Blob === 'undefined' && ctxAny.Blob) {
      g.Blob = ctxAny.Blob
      this.logger.info('[ToolSandbox] Injected Blob polyfill to global')
    }
    if (typeof g.FormData === 'undefined' && ctxAny.FormData) {
      g.FormData = ctxAny.FormData
      this.logger.info('[ToolSandbox] Injected FormData polyfill to global')
    }

    // 简化的 importx 后备
    const ctxRef = context
    context.importx = async (moduleName: string): Promise<unknown> => {
      this.logger!.warn(`[ToolSandbox] Direct importx usage detected. Consider using api.importx() instead.`)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ToolModuleImportModule = require('./module/ToolModuleImport') as ToolModuleImportStaticLike
      const moduleImporter = new ToolModuleImportModule(this.toolId || '', this.sandboxPath || '')
      try {
        return await moduleImporter.import(moduleName)
      } catch (error) {
        this.logger!.error(`[ToolSandbox] Failed to load module ${moduleName}: ${(error as Error).message}`)
        const TE = errorsModule.ToolError
        const dErr = errorsModule.DEVELOPMENT_ERRORS.UNDECLARED_DEPENDENCY as { code: string }
        throw new TE(
          `Cannot load module '${moduleName}': ${(error as Error).message}`,
          dErr.code,
          { module: moduleName, originalError: (error as Error).message },
        )
      }
    }

    context.loadModule = ctxRef.importx
    context.importModule = ctxRef.importx
  }

  /**
   * 创建基础沙箱环境
   */
  createBasicSandboxEnvironment(): Record<string, unknown> {
    if (!this.isolationManager) throw new Error('Isolation manager not initialized')
    return this.isolationManager.createIsolatedContext()
  }

  /**
   * 创建智能沙箱环境（支持依赖）
   */
  createSmartSandboxEnvironment(): Record<string, unknown> {
    if (!this.isolationManager) throw new Error('Isolation manager not initialized')
    return this.isolationManager.createIsolatedContext()
  }

  /**
   * 提取工具 ID
   */
  extractToolId(toolReference: string): string {
    if (toolReference.startsWith('@tool://')) {
      return toolReference.substring(8)
    }
    const TE = errorsModule.ToolError
    const vErr = errorsModule.VALIDATION_ERRORS.INVALID_PARAM_FORMAT as { code: string } | undefined
    throw new TE(
      `Invalid tool reference format: ${toolReference}`,
      (vErr && vErr.code) || 'INVALID_PARAM',
      { toolReference },
    )
  }

  /**
   * 解析工具内容
   */
  parseToolContent(content: string): Record<string, unknown> {
    try {
      if (!this.vm) throw new Error('VM not initialized')
      const script = new this.vm.Script(content)
      const context = this.vm.createContext({
        module: { exports: {} },
        exports: {},
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require: require as NodeJS.Require,

        console,
        process,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        setImmediate,
        clearImmediate,

        __filename: 'tool.js',
        __dirname: process.cwd(),

        Object,
        Array,
        String,
        Number,
        Boolean,
        Date,
        RegExp,
        Error,
        JSON,
        Math,
        Promise,
      })

      script.runInContext(context)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (context as any).module.exports as Record<string, unknown>
    } catch (error) {
      const TE = errorsModule.ToolError
      const dErr = errorsModule.DEVELOPMENT_ERRORS.TOOL_SYNTAX_ERROR as { code: string }
      throw new TE(
        `Failed to parse tool content: ${(error as Error).message}`,
        dErr.code,
        { originalError: (error as Error).message },
      )
    }
  }

  /**
   * 获取分析结果
   */
  getAnalysisResult(): AnalyzeResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = this.toolInstance as any
    return {
      toolId: this.toolId,
      dependencies: this.dependencies,
      sandboxPath: this.sandboxPath,
      hasMetadata: typeof inst?.getMetadata === 'function',
      hasSchema: typeof inst?.getSchema === 'function',
    }
  }

  /**
   * 安装依赖
   */
  async installDependencies(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PackageInstallerModule = require('./PackageInstaller') as PackageInstallerStaticLike

    if (!this.sandboxPath || !this.toolId) throw new Error('Tool not initialized')

    await PackageInstallerModule.createPackageJson(this.sandboxPath, this.toolId, this.dependencies)

    await PackageInstallerModule.install({
      workingDir: this.sandboxPath,
      dependencies: this.dependencies,
      timeout: (this.options.timeout as number | undefined) || 30000,
    })
  }

  /**
   * 检查 node_modules 是否存在
   */
  async checkNodeModulesExists(): Promise<boolean> {
    try {
      if (!this.sandboxPath) return false
      const nodeModulesPath = path.join(this.sandboxPath, 'node_modules')
      await fs.access(nodeModulesPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    await this.clearSandbox(false)
  }
}

export = ToolSandbox
