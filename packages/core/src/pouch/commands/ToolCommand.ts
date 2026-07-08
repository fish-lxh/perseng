/**
 * Tool命令处理器
 * 实现toolx MCP工具，执行通过@tool协议声明的工具
 *
 * P0 step 0B.4.3: 迁 .js → .ts. BasePouchCommand 已 .ts;
 * resource/ / ~/toolx/* 仍 .js, 走 const+require.
 */

import { BasePouchCommand } from '../BasePouchCommand.js'
import * as logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalResourceManager } = require('../../resource') as {
  getGlobalResourceManager(): ResourceManagerLike
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ToolSandbox = require('~/toolx/ToolSandbox') as unknown as new (
  toolResource: string,
  opts?: { timeout?: number; rebuild?: boolean },
) => ToolSandboxLike
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ToolManualFormatter = require('~/toolx/ToolManualFormatter') as unknown as new () => ToolManualFormatterLike

/** ResourceManager 鸭子类型 */
interface ResourceManagerLike {
  initialized: boolean
  initializeWithNewArchitecture(): Promise<void>
  loadResource(url: string): Promise<{ success: boolean; content?: string }>
  [key: string]: unknown
}

/** ToolSandbox 鸭子类型 */
interface ToolSandboxLike {
  toolInstance?: { [key: string]: unknown }
  setResourceManager(rm: ResourceManagerLike): void
  analyze(): Promise<{ toolId: string }>
  prepareDependencies(): Promise<void>
  execute(parameters: Record<string, unknown>): Promise<unknown>
  cleanup(): Promise<void>
  clearSandbox(removeDir: boolean): Promise<void>
  configureEnvironment(parameters: Record<string, unknown>): Promise<{
    action: 'get' | 'set' | 'clear'
    variables?: Record<string, { configured: boolean; required: boolean; default?: unknown; value?: unknown; description?: string }>
    summary?: { total: number; configured: number; required: number; missing: number }
    envPath?: string
    message?: string
    configured?: string[]
  }>
  queryLogs(parameters: Record<string, unknown>): Promise<unknown>
  dryRun(parameters: Record<string, unknown>): Promise<{
    success: boolean
    result?: unknown
    bridgeTests?: {
      summary: { total: number; success: number; failed: number }
      results: Record<string, { success: boolean }>
    }
    message?: string
    error?: unknown
  }>
  getAnalysisResult(): { toolId: string }
}

/** ToolManualFormatter 鸭子类型 */
interface ToolManualFormatterLike {
  format(toolInstance: { [key: string]: unknown }, toolResource: string, sourceCode: string | null): string
}

/** Tool 工具结果 */
interface ToolResult {
  success: boolean
  data?: { success?: boolean; error?: { code: string; message: string; details?: unknown }; [k: string]: unknown }
  error?: { code: string; message: string; details?: unknown }
  [key: string]: unknown
}

/** 工具执行参数 */
interface ToolArgs {
  tool_resource: string
  mode?: 'execute' | 'manual' | 'configure' | 'rebuild' | 'log' | 'dryrun'
  parameters?: Record<string, unknown>
  timeout?: number
}

/** 工具成功结果 */
interface ToolSuccessResult {
  success: true
  tool_resource: string
  mode?: string
  result: unknown
  metadata: {
    executor?: string
    execution_time_ms: number
    timestamp: string
    version?: string
    source?: string
  }
}

/** 工具错误结果 */
interface ToolErrorResult {
  success: false
  tool_resource: string
  mode?: string
  error: { code: string; message: string; details?: unknown; [k: string]: unknown }
  metadata: {
    executor?: string
    execution_time_ms: number
    timestamp: string
    version?: string
  }
}

/** ToolError 鸭子类型（来自 ~/toolx/errors） */
interface ToolErrorClassLike {
  CATEGORIES: Record<string, { emoji: string; description: string; responsibility: string }>
  from(error: Error): ToolErrorInstanceLike
}

/** ToolError 实例 */
interface ToolErrorInstanceLike {
  toMCPFormat(): {
    category: string
    code: string
    message: string
    details?: { businessError?: { description?: string } }
    solution?: string | { message?: string; detail?: string }
    retryable?: boolean
  }
}

/** PATEOAS action */
interface PateoasAction {
  action: string
  description: string
  method: string
}

export class ToolCommand extends BasePouchCommand {
  private resourceManager: ResourceManagerLike | null

  constructor() {
    super()
    this.resourceManager = null
  }

  /**
   * 获取或初始化ResourceManager
   */
  async getResourceManager(): Promise<ResourceManagerLike> {
    if (!this.resourceManager) {
      this.resourceManager = getGlobalResourceManager()
      // 确保ResourceManager已初始化
      if (!this.resourceManager.initialized) {
        await this.resourceManager.initializeWithNewArchitecture()
      }
    }
    return this.resourceManager
  }

  // BasePouchCommand的抽象方法实现
  getPurpose(): string {
    return '执行通过@tool协议声明的JavaScript工具'
  }

  async getContent(args: unknown[] = []): Promise<string> {
    try {
      // 处理参数：如果是数组格式，需要转换为对象格式
      let toolArgs: ToolArgs
      logger.info('[ToolCommand] getContent 接收到的 args:', args)
      logger.info('[ToolCommand] args 类型:', Array.isArray(args) ? 'Array' : typeof args)

      if (Array.isArray(args)) {
        // 从CLI调用时，args是数组：[tool_resource, mode?, parameters?, ...options]
        // KNUTH-FIX 0B.4.3: logger.info 第二参只接 object|string, args.length 是 number
        logger.info('[ToolCommand] 数组参数长度:', String(args.length))
        logger.info('[ToolCommand] args[0]:', String(args[0]))

        toolArgs = {
          tool_resource: String(args[0] ?? ''),
        }

        // 解析mode和parameters
        if (args.length >= 2) {
          // 检查第二个参数是否是mode
          const validModes = ['execute', 'manual', 'configure', 'rebuild', 'log', 'dryrun']
          if (validModes.includes(String(args[1]))) {
            toolArgs.mode = args[1] as ToolArgs['mode']
            // 如果有第三个参数，它是parameters
            if (args.length >= 3) {
              let parameters: unknown = args[2]
              if (typeof parameters === 'string') {
                try {
                  parameters = JSON.parse(parameters)
                } catch (e) {
                  // 保持原样
                }
              }
              toolArgs.parameters = parameters as Record<string, unknown>
            }
          } else {
            // 第二个参数是parameters（默认execute模式）
            let parameters: unknown = args[1]
            if (typeof parameters === 'string') {
              try {
                parameters = JSON.parse(parameters)
              } catch (e) {
                // 保持原样
              }
            }
            toolArgs.parameters = parameters as Record<string, unknown>
          }
        }

        // 提取timeout
        toolArgs.timeout = this.extractTimeout(args as string[])
        logger.info('[ToolCommand] 构建的 toolArgs:', toolArgs)
      } else {
        // 从其他方式调用时，args已经是对象格式
        toolArgs = args as ToolArgs
        logger.info('[ToolCommand] 直接使用对象格式参数:', toolArgs)
      }

      // 执行工具调用
      const result = (await this.executeToolInternal(toolArgs)) as ToolSuccessResult | ToolErrorResult

      // 根据mode格式化不同的响应
      if (result.success) {
        const mode = result.mode || 'execute'

        switch (mode) {
          case 'manual': {
            const r = result as ToolSuccessResult & { result: { manual: string; toolId: string } }
            return `📚 工具手册

📋 工具资源: ${result.tool_resource}

${r.result.manual}

⏱️ 加载时间: ${result.metadata.execution_time_ms}ms`
          }

          case 'configure': {
            const r = result as ToolSuccessResult & {
              result: {
                action: string
                variables?: Record<string, { configured: boolean; required: boolean; default?: unknown; value?: unknown; description?: string }>
                summary?: { total: number; configured: number; required: number; missing: number }
                envPath?: string
                message?: string
                configured?: string[]
              }
            }
            if (r.result.action === 'get') {
              const vars = r.result.variables ?? {}
              const summary = r.result.summary ?? { total: 0, configured: 0, required: 0, missing: 0 }
              let output = `🔧 环境变量配置状态

📋 工具资源: ${result.tool_resource}
📁 配置文件: ${r.result.envPath ?? ''}

📊 配置摘要:
- 总计: ${summary.total} 个变量
- 已配置: ${summary.configured} 个
- 必需: ${summary.required} 个
- 缺失: ${summary.missing} 个

📝 变量详情:
`
              for (const [key, info] of Object.entries(vars)) {
                const status = info.configured ? '✅' : info.required ? '❌' : '⭕'
                const value = info.configured ? info.value : info.default ? `默认: ${info.default}` : '未设置'
                output += `${status} ${key}: ${value}\n   ${info.description || ''}\n`
              }
              return output
            } else {
              return `🔧 环境变量配置

📋 工具资源: ${result.tool_resource}
✅ 操作: ${r.result.action}
📝 结果: ${r.result.message ?? ''}
${r.result.configured ? `📋 已配置: ${r.result.configured.join(', ')}` : ''}

⏱️ 执行时间: ${result.metadata.execution_time_ms}ms`
            }
          }

          case 'dryrun': {
            const r = result as ToolSuccessResult & {
              result: {
                success: boolean
                result?: unknown
                bridgeTests?: {
                  summary: { total: number; success: number; failed: number }
                  results: Record<string, { success: boolean }>
                }
                message?: string
                error?: unknown
              }
            }
            const dryRunResult = r.result
            let output = `🧪 Tool Dry-Run 测试${dryRunResult.success ? '成功' : '失败'}

📋 工具资源: ${result.tool_resource}
🔬 模式: 干运行测试
`
            if (dryRunResult.success) {
              output += `✅ 执行结果:
${JSON.stringify(dryRunResult.result, null, 2)}
`
              if (dryRunResult.bridgeTests) {
                const bridgeTests = dryRunResult.bridgeTests
                output += `
🌉 Bridge测试结果:
- 总计: ${bridgeTests.summary.total} 个Bridge
- 成功: ${bridgeTests.summary.success} 个
- 失败: ${bridgeTests.summary.failed} 个
`
                for (const [operation, testResult] of Object.entries(bridgeTests.results)) {
                  const status = testResult.success ? '✅' : '❌'
                  output += `  ${status} ${operation}\n`
                }
              }
            } else {
              output += `❌ 错误信息: ${dryRunResult.message}
📝 错误详情:
${JSON.stringify(dryRunResult.error, null, 2)}
`
            }
            output += `
⏱️ 执行时间: ${result.metadata.execution_time_ms}ms`
            return output
          }

          case 'rebuild':
          case 'execute':
          default: {
            const r = result as ToolSuccessResult & { result: unknown }
            const actualToolResult = r.result as ToolResult
            const isToolInternalSuccess = this.isToolInternalSuccess(actualToolResult)

            if (isToolInternalSuccess) {
              return `🔧 Tool${mode === 'rebuild' ? '重建并' : ''}执行成功

📋 工具资源: ${result.tool_resource}
${mode === 'rebuild' ? '♻️ 模式: 强制重建\n' : ''}📊 执行结果:
${JSON.stringify(actualToolResult, null, 2)}

⏱️ 性能指标:
- 执行时间: ${result.metadata.execution_time_ms}ms
- 时间戳: ${result.metadata.timestamp}`
            } else {
              const internalError = this.extractToolInternalError(actualToolResult)
              return this.formatToolInternalError(result.tool_resource, internalError, result.metadata)
            }
          }
        }
      } else {
        // 渲染错误，根据错误类型显示不同信息
        // KNUTH-FIX 0B.4.3: result.error 是 ToolErrorResult.error 鸭子类型,
        // formatErrorOutput 期望 ToolError.toMCPFormat() 的返回类型, cast 一下
        return this.formatErrorOutput(
          result.error as unknown as ToolErrorInstanceLike['toMCPFormat'] extends () => infer R ? R : never,
          result.tool_resource,
          result.metadata,
          result.mode ?? 'execute',
        )
      }
    } catch (error) {
      return `❌ Tool执行异常

错误详情: ${(error as Error).message}

💡 请检查:
1. 工具资源引用格式是否正确 (@tool://tool-name)
2. 工具参数是否有效
3. 工具文件是否存在并可执行`
    }
    // 满足 noImplicitReturns
    return ''
  }

  getPATEOAS(_args: unknown[] = []): { currentState: string; nextActions: PateoasAction[] } {
    return {
      currentState: 'tool_executed',
      nextActions: [
        {
          action: 'execute_another_tool',
          description: '执行其他工具',
          method: 'promptx tool',
        },
        {
          action: 'view_available_tools',
          description: '查看可用工具',
          method: 'promptx discover',
        },
      ],
    }
  }

  /**
   * 内部工具执行方法 - 支持多种执行模式
   */
  async executeToolInternal(args: ToolArgs): Promise<ToolSuccessResult | ToolErrorResult> {
    const startTime = Date.now()

    try {
      logger.info('[ToolCommand] executeToolInternal 接收到的 args:', JSON.stringify(args, null, 2))

      // 1. 参数验证
      this.validateArguments(args)

      const { tool_resource, mode = 'execute', parameters = {}, timeout = 30000 } = args

      logger.info('[ToolCommand] 执行模式 mode:', mode)
      logger.debug(`[PersengTool] 开始执行工具: ${tool_resource}, 模式: ${mode}`)

      // 2. 根据mode分发到不同的处理方法
      switch (mode) {
        case 'execute':
          return await this.executeNormalMode(tool_resource, parameters, timeout, startTime)

        case 'manual':
          return await this.executeManualMode(tool_resource, startTime)

        case 'configure':
          return await this.executeConfigureMode(tool_resource, parameters, startTime)

        case 'rebuild':
          return await this.executeRebuildMode(tool_resource, parameters, timeout, startTime)

        case 'log':
          return await this.executeLogMode(tool_resource, parameters, startTime)

        case 'dryrun':
          return await this.executeDryRunMode(tool_resource, parameters, startTime)

        default:
          throw new Error(
            `Unsupported mode: ${mode}. Supported modes: execute, manual, configure, rebuild, log, dryrun`,
          )
      }
    } catch (error) {
      // 格式化错误结果
      logger.error(`[PersengTool] 工具执行失败: ${(error as Error).message}`, error as Error)
      return this.formatErrorResult(error as Error, args.tool_resource, startTime)
    }
  }

  /**
   * Execute模式 - 正常执行工具
   */
  async executeNormalMode(
    tool_resource: string,
    parameters: Record<string, unknown>,
    timeout: number,
    startTime: number,
  ): Promise<ToolSuccessResult> {
    let sandbox: ToolSandboxLike | null = null

    try {
      sandbox = new ToolSandbox(tool_resource, { timeout })
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      // 三阶段执行
      logger.debug(`[PersengTool] Execute模式: Phase 1 - 分析工具`)
      await sandbox.analyze()

      logger.debug(`[PersengTool] Execute模式: Phase 2 - 准备依赖`)
      await sandbox.prepareDependencies()

      logger.debug(`[PersengTool] Execute模式: Phase 3 - 执行工具`)
      const result = await sandbox.execute(parameters)

      return this.formatSuccessResult(result, tool_resource, startTime)
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * Manual模式 - 从工具接口自动生成手册
   */
  async executeManualMode(tool_resource: string, startTime: number): Promise<ToolSuccessResult> {
    let sandbox: ToolSandboxLike | null = null

    try {
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      await sandbox.analyze()

      const toolInstance = sandbox.toolInstance
      if (!toolInstance) {
        throw new Error('Tool instance not found')
      }

      // 尝试获取工具源码（用于提取注释）
      let sourceCode: string | null = null
      try {
        const resourceResult = await resourceManager.loadResource(tool_resource)
        if (resourceResult.success && resourceResult.content) {
          sourceCode = resourceResult.content
        }
      } catch (e) {
        logger.debug(`[ToolCommand] Could not load source code for manual generation: ${(e as Error).message}`)
        // 没有源码也能生成基础手册，继续执行
      }

      // 使用新的 ToolManualFormatter 生成手册
      const formatter = new ToolManualFormatter()
      const formattedManual = formatter.format(toolInstance, tool_resource, sourceCode)

      return {
        success: true,
        tool_resource: tool_resource,
        mode: 'manual',
        result: {
          manual: formattedManual,
          toolId: sandbox.getAnalysisResult().toolId,
        },
        metadata: {
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'ToolManualFormatter',
        },
      }
    } catch (error) {
      throw error
    } finally {
      if (sandbox) {
        try {
          await sandbox.cleanup()
        } catch (cleanupError) {
          logger.warn(`[PersengTool] 清理沙箱失败: ${(cleanupError as Error).message}`)
        }
      }
    }
  }

  /**
   * Configure模式 - 配置环境变量
   */
  async executeConfigureMode(
    tool_resource: string,
    parameters: Record<string, unknown>,
    startTime: number,
  ): Promise<ToolSuccessResult> {
    let sandbox: ToolSandboxLike | null = null

    try {
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      logger.debug(`[PersengTool] Configure模式: 分析工具`)
      await sandbox.analyze()

      const result = await sandbox.configureEnvironment(parameters)

      return {
        success: true,
        tool_resource: tool_resource,
        mode: 'configure',
        result: result,
        metadata: {
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
      }
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * Rebuild模式 - 强制重建后执行
   */
  async executeRebuildMode(
    tool_resource: string,
    parameters: Record<string, unknown>,
    timeout: number,
    startTime: number,
  ): Promise<ToolSuccessResult> {
    let sandbox: ToolSandboxLike | null = null

    try {
      sandbox = new ToolSandbox(tool_resource, { timeout, rebuild: true })
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      logger.debug(`[PersengTool] Rebuild模式: 清理旧沙箱`)
      await sandbox.clearSandbox(true) // true表示删除目录

      logger.debug(`[PersengTool] Rebuild模式: Phase 1 - 分析工具`)
      await sandbox.analyze()

      logger.debug(`[PersengTool] Rebuild模式: Phase 2 - 准备依赖（强制重装）`)
      await sandbox.prepareDependencies()

      logger.debug(`[PersengTool] Rebuild模式: Phase 3 - 执行工具`)
      const result = await sandbox.execute(parameters)

      return this.formatSuccessResult(result, tool_resource, startTime)
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * Log模式 - 查询工具执行日志
   */
  async executeLogMode(
    tool_resource: string,
    parameters: Record<string, unknown>,
    startTime: number,
  ): Promise<ToolSuccessResult> {
    let sandbox: ToolSandboxLike | null = null

    try {
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      logger.debug(`[PersengTool] Log模式: 分析工具以获取日志路径`)
      await sandbox.analyze()

      logger.debug(`[PersengTool] Log模式: 查询日志，参数:`, parameters)
      const result = await sandbox.queryLogs(parameters)

      return this.formatSuccessResult(result, tool_resource, startTime)
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * DryRun模式 - 干运行测试工具
   */
  async executeDryRunMode(
    tool_resource: string,
    parameters: Record<string, unknown>,
    startTime: number,
  ): Promise<ToolSuccessResult | ToolErrorResult> {
    let sandbox: ToolSandboxLike | null = null

    try {
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      logger.debug(`[PersengTool] DryRun模式: Phase 1 - 分析工具`)
      await sandbox.analyze()

      logger.debug(`[PersengTool] DryRun模式: Phase 2 - 准备依赖`)
      await sandbox.prepareDependencies()

      logger.debug(`[PersengTool] DryRun模式: Phase 3 - 执行dry-run测试`)
      const result = await sandbox.dryRun(parameters)

      if (result.success) {
        return {
          success: true,
          tool_resource: tool_resource,
          mode: 'dryrun',
          result: result,
          metadata: {
            executor: 'ToolSandbox',
            execution_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            version: '1.0.0',
          },
        }
      } else {
        return {
          success: false,
          tool_resource: tool_resource,
          mode: 'dryrun',
          error: {
            code: 'TOOL_DRYRUN_FAILED',
            message: result.message ?? 'Dry-run failed',
            details: result.error,
          },
          metadata: {
            executor: 'ToolSandbox',
            execution_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          },
        }
      }
    } catch (error) {
      return this.formatErrorResult(error as Error, tool_resource, startTime)
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * 验证命令参数
   */
  validateArguments(args: ToolArgs): void {
    if (!args) {
      throw new Error('Missing arguments')
    }

    if (!args.tool_resource) {
      throw new Error('Missing required parameter: tool_resource')
    }

    if (!args.tool_resource.startsWith('@tool://')) {
      throw new Error('Invalid tool_resource format. Must start with @tool://')
    }

    if (args.mode) {
      const validModes = ['execute', 'manual', 'configure', 'rebuild', 'log', 'dryrun']
      if (!validModes.includes(args.mode)) {
        throw new Error(`Invalid mode: ${args.mode}. Valid modes are: ${validModes.join(', ')}`)
      }
    }

    if (args.mode === 'execute' || args.mode === 'rebuild' || !args.mode) {
      if (args.parameters !== undefined && typeof args.parameters !== 'object') {
        throw new Error('Parameters must be an object for execute/rebuild mode')
      }
    }
  }

  /**
   * 格式化成功结果 - 适配ToolSandbox返回格式
   */
  formatSuccessResult(result: unknown, toolResource: string, startTime: number): ToolSuccessResult {
    const duration = Date.now() - startTime

    return {
      success: true,
      tool_resource: toolResource,
      result: result,
      metadata: {
        executor: 'ToolSandbox',
        execution_time_ms: duration,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      },
    }
  }

  /**
   * 格式化错误结果（简化版 - 奥卡姆剃刀原则）
   */
  formatErrorResult(error: Error, toolResource: string, startTime: number): ToolErrorResult {
    // KNUTH-FIX 0B.4.3: destructure 会让 ToolError 类型变成 ToolErrorClassLike['ToolError']
    // (不存在), 所以先 require 整个 module, 再 cast 到 ToolErrorClassLike
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ToolErrorModule = require('~/toolx/errors') as ToolErrorClassLike
    const duration = Date.now() - startTime

    // 统一转换为 ToolError（集成层统一处理）
    const toolError = error instanceof Error && 'toMCPFormat' in error
      ? (error as unknown as ToolErrorInstanceLike)
      : ToolErrorModule.from(error)

    return {
      success: false,
      tool_resource: toolResource || 'unknown',
      error: toolError.toMCPFormat(),
      metadata: {
        executor: 'ToolSandbox',
        execution_time_ms: duration,
        timestamp: new Date().toISOString(),
      },
    }
  }

  /**
   * 格式化错误输出（负责错误的最终渲染）
   */
  formatErrorOutput(
    errorInfo: ToolErrorInstanceLike['toMCPFormat'] extends () => infer R ? R : never,
    toolResource: string,
    metadata: ToolSuccessResult['metadata'],
    mode: string = 'execute',
  ): string {
    // KNUTH-FIX 0B.4.3: 同 formatErrorResult, 不 destructure
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ToolErrorModule = require('~/toolx/errors') as ToolErrorClassLike

    // 根据错误类别展示不同信息
    const categoryInfo = ToolErrorModule.CATEGORIES[errorInfo.category]

    let output = `❌ Tool执行失败

📋 工具资源: ${toolResource}
🔧 模式: ${mode}
❌ 错误信息: ${errorInfo.message}
🔢 错误代码: ${errorInfo.code}`

    if (categoryInfo) {
      output += `
${categoryInfo.emoji} 错误类型: ${categoryInfo.description}
📝 责任方: ${categoryInfo.responsibility}`
    }

    if (errorInfo.category === 'BUSINESS' && errorInfo.details?.businessError) {
      const be = errorInfo.details.businessError
      if (be.description) {
        output += `
📄 错误描述: ${be.description}`
      }
    }

    if (errorInfo.solution) {
      let solutionText: string = errorInfo.solution as string

      if (typeof errorInfo.solution === 'object' && errorInfo.solution !== null) {
        const sol = errorInfo.solution as { message?: string; detail?: string }
        solutionText = sol.message || sol.detail || JSON.stringify(sol)
      }

      output += `

💡 解决方案: ${solutionText}`
    }

    if (errorInfo.retryable) {
      output += `
🔄 可重试: 是`
    }

    output += `

⏱️ 执行时间: ${metadata.execution_time_ms}ms`

    return output
  }

  /**
   * 生成执行ID
   */
  generateExecutionId(): string {
    return `tool_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 从参数数组中提取timeout值
   */
  extractTimeout(args: string[]): number | undefined {
    const timeoutIndex = args.indexOf('--timeout')
    if (timeoutIndex !== -1 && timeoutIndex < args.length - 1) {
      const timeout = parseInt(args[timeoutIndex + 1] ?? '', 10)
      return isNaN(timeout) ? undefined : timeout
    }
    return undefined
  }

  /**
   * 检查工具内部执行是否成功
   */
  isToolInternalSuccess(toolResult: ToolResult | null | undefined): boolean {
    if (toolResult && typeof toolResult === 'object' && toolResult.data) {
      if (typeof toolResult.data === 'object' && 'success' in toolResult.data) {
        return toolResult.data.success === true
      }
    }

    if (toolResult && typeof toolResult === 'object' && 'success' in toolResult) {
      return (toolResult as { success: boolean }).success === true
    }

    return true
  }

  /**
   * 从工具内部结果中提取错误信息
   */
  extractToolInternalError(toolResult: ToolResult | null | undefined): {
    code: string
    message: string
    details: unknown
  } {
    if (toolResult && typeof toolResult === 'object' && toolResult.data && typeof toolResult.data === 'object' && toolResult.data.error) {
      const err = toolResult.data.error as { code?: string; message?: string; details?: unknown }
      return {
        code: err.code || 'TOOL_INTERNAL_ERROR',
        message: err.message || '工具内部执行失败',
        details: err.details || toolResult.data.error,
      }
    }

    if (toolResult && typeof toolResult === 'object' && toolResult.error) {
      const err = toolResult.error as { code?: string; message?: string; details?: unknown }
      return {
        code: err.code || 'TOOL_INTERNAL_ERROR',
        message: err.message || '工具内部执行失败',
        details: err.details || toolResult.error,
      }
    }

    return {
      code: 'TOOL_INTERNAL_ERROR',
      message: '工具内部执行失败，但未提供错误详情',
      details: JSON.stringify(toolResult),
    }
  }

  /**
   * 格式化工具内部错误
   */
  formatToolInternalError(
    toolResource: string,
    internalError: { code: string; message: string; details: unknown },
    metadata: ToolSuccessResult['metadata'],
  ): string {
    const intelligentError = this.analyzeToolInternalError(internalError, toolResource)

    return `❌ Tool内部执行失败

📋 工具资源: ${toolResource}
❌ 错误信息: ${intelligentError.message}
🏷️ 错误类型: ${intelligentError.type}
🔢 错误代码: ${intelligentError.code}

💡 智能建议:
${intelligentError.suggestion}

⏱️ 执行时间: ${metadata.execution_time_ms}ms`
  }

  /**
   * 分析工具内部错误并提供智能建议
   */
  analyzeToolInternalError(
    internalError: { code: string; message: string; details: unknown },
    toolResource: string,
  ): { code: string; type: string; message: string; suggestion: string } {
    const message = internalError.message.toLowerCase()
    const details = internalError.details || ''

    if (typeof message === 'string' && (message.includes('is not a function') || message.includes('cannot find module'))) {
      return {
        code: 'DEPENDENCY_ERROR',
        type: 'DEPENDENCY_USAGE_ERROR',
        message: internalError.message,
        suggestion: `🔧 依赖使用错误：
• 检查依赖的正确用法
• 确认依赖版本兼容性
• 可能需要使用 "rebuild": true 重建沙箱

💡 建议操作：
toolx ${toolResource} {"rebuild": true, ...其他参数}`,
      }
    }

    if (typeof message === 'string' && (message.includes('validation') || message.includes('parameter'))) {
      return {
        code: 'PARAMETER_ERROR',
        type: 'PARAMETER_VALIDATION_ERROR',
        message: internalError.message,
        suggestion: `📝 参数错误：
• 检查传入的参数格式和类型
• 确认必需参数是否缺失
• 参考工具的schema定义`,
      }
    }

    if (typeof message === 'string' && (message.includes('timeout') || message.includes('network') || message.includes('fetch'))) {
      return {
        code: 'NETWORK_ERROR',
        type: 'EXTERNAL_SERVICE_ERROR',
        message: internalError.message,
        suggestion: `🌐 网络服务错误：
• 检查网络连接状态
• 确认外部API服务可用性
• 稍后重试可能解决问题`,
      }
    }

    return {
      code: internalError.code || 'TOOL_INTERNAL_ERROR',
      type: 'UNKNOWN_TOOL_ERROR',
      message: internalError.message,
      suggestion: `🔧 工具内部错误：
• 这可能是工具代码的逻辑问题
• 检查工具的实现是否正确
• 如果问题持续，请联系工具开发者

🐛 错误详情：
${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}`,
    }
  }

  /**
   * 获取工具命令的元信息 - ToolSandbox版本
   */
  getMetadata(): {
    name: string
    description: string
    version: string
    author: string
    executor: string
    supports: {
      protocols: string[]
      formats: string[]
      features: string[]
    }
  } {
    return {
      name: 'toolx',
      description: '使用ToolSandbox执行通过@tool协议声明的工具',
      version: '2.0.0',
      author: 'Perseng Framework',
      executor: 'ToolSandbox',
      supports: {
        protocols: ['@tool://'],
        formats: ['.tool.js'],
        features: [
          'ToolSandbox沙箱执行',
          '自动依赖管理',
          '三阶段执行流程',
          'pnpm依赖安装',
          '参数验证',
          '错误处理',
          '执行监控',
          '资源清理',
        ],
      },
    }
  }
}

export default ToolCommand
