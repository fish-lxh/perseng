/**
 * Perseng Tool Framework
 * 统一的工具框架入口文件 - ToolSandbox版本
 *
 * P0 step 0B.5: 迁 .js → .ts. const+require 模式 (apps/cli TS6059 rootDir 回避),
 * 0B.6 开 dts 后可改回 import.
 */

// ToolSandbox 框架内部使用常规模块导入

// 异步模块加载
let ToolSandbox: any
let ToolValidator: any
let ToolUtils: any
let PackageInstaller: any
let ToolInterface: any
let ToolManualFormatter: any

interface ToolSandboxInstance {
  setResourceManager(rm: unknown): void
  analyze(): Promise<{ toolId: string }>
  prepareDependencies(): Promise<void>
  execute(parameters: Record<string, unknown>): Promise<unknown>
  cleanup(): Promise<void>
}

interface ToolSandboxStatic {
  create(toolResource: string): Promise<ToolSandboxInstance>
}

async function initializeModules(): Promise<void> {
  if (!ToolSandbox) {
    // ToolSandbox 框架内部使用常规 require()
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ToolSandbox = require('./ToolSandbox')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ToolValidator = require('./ToolValidator')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ToolUtils = require('./ToolUtils')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    PackageInstaller = require('./PackageInstaller')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ToolInterface = require('./ToolInterface')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ToolManualFormatter = require('./ToolManualFormatter')
  }
}

// 创建全局工具实例 — 当前版本 ToolSandbox 不使用单例, 仅占位兼容未来单例模式
// KNUTH-FIX 0B.5: 原 .js 有 let globalSandbox + reset() 改写它, 此处两者均 unused,
//                删除以满足 noUnusedLocals

/**
 * 获取全局工具沙箱
 * @param toolResource - 工具资源引用
 * @returns 工具沙箱实例
 */
async function getGlobalToolSandbox(toolResource: string): Promise<ToolSandboxInstance> {
  await initializeModules()
  // ToolSandbox是工具特定的，不使用单例
  return await (ToolSandbox as ToolSandboxStatic).create(toolResource)
}

/**
 * 初始化工具框架 - ToolSandbox版本
 * @param options - 配置选项
 * @returns 初始化结果
 */
function initialize(_options: Record<string, unknown> = {}): {
  success: boolean
  message: string
  framework?: {
    executor: string
    version: string
    features: string[]
  }
  error?: unknown
} {
  try {
    return {
      success: true,
      message: 'ToolSandbox工具框架初始化成功',
      framework: {
        executor: 'ToolSandbox',
        version: '2.0.0',
        features: [
          '自动依赖管理',
          '沙箱隔离执行',
          '三阶段执行流程',
          'pnpm集成',
        ],
      },
    }
  } catch (error) {
    return {
      success: false,
      message: `工具框架初始化失败: ${(error as Error).message}`,
      error,
    }
  }
}

/**
 * 执行工具的便捷方法 - ToolSandbox版本
 * @param toolResource - 工具资源引用 (@tool://tool-name)
 * @param parameters - 工具参数
 * @param resourceManager - ResourceManager实例
 * @returns 执行结果
 */
async function executeTool(
  toolResource: string,
  parameters: Record<string, unknown> = {},
  resourceManager: unknown = null,
): Promise<{ success: boolean; result?: unknown; error?: unknown }> {
  let sandbox: ToolSandboxInstance | null = null

  try {
    if (!resourceManager) {
      throw new Error('ResourceManager is required for ToolSandbox execution')
    }

    sandbox = await getGlobalToolSandbox(toolResource)
    sandbox.setResourceManager(resourceManager)

    await sandbox.analyze()
    await sandbox.prepareDependencies()
    const result = await sandbox.execute(parameters)
    return { success: true, result }

  } catch (error) {
    // 顶层异常处理：确保所有错误都被正确包装，防止崩溃主进程
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const logger = require('@promptx/logger') as {
      error(msg: string, meta: unknown): void
      warn(msg: string, meta?: unknown): void
    }

    // 记录详细错误信息用于调试
    logger.error('[ToolX] Top-level error caught:', {
      toolResource,
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
      errorCode: (error as { code?: string }).code,
      errorStack: (error as Error).stack,
    })

    // 导入 ToolError
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ToolError } = require('./errors') as {
      ToolError: { new (...args: unknown[]): unknown; from(err: unknown, ctx?: unknown): ToolErrorInstance }
    }
    interface ToolErrorInstance {
      toMCPFormat(): unknown
    }

    // 如果已经是 ToolError，直接返回错误格式（不抛出）
    if (error instanceof (ToolError as unknown as new (...args: unknown[]) => Error)) {
      return {
        success: false,
        error: (error as unknown as ToolErrorInstance).toMCPFormat(),
      }
    }

    // 包装未知错误为 ToolError
    const wrappedError = ToolError.from(error, {
      phase: 'executeTool',
      toolResource,
      parameters,
    })

    return {
      success: false,
      error: wrappedError.toMCPFormat(),
    }

  } finally {
    // 确保清理工作始终执行
    if (sandbox) {
      try {
        await sandbox.cleanup()
      } catch (cleanupError) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const logger = require('@promptx/logger') as {
          warn(msg: string, meta?: unknown): void
        }
        logger.warn('[ToolX] Cleanup failed:', (cleanupError as Error).message)
      }
    }
  }
}

/**
 * 重置工具框架 - ToolSandbox版本
 */
function reset(): void {
  // ToolSandbox不使用全局单例，无需重置
}

/**
 * 获取工具框架统计信息 - ToolSandbox版本
 * @returns 统计信息
 */
function getStats(): {
  framework: {
    name: string
    version: string
    executor: string
    features: string[]
  }
} {
  return {
    framework: {
      name: 'Perseng ToolSandbox Framework',
      version: '2.0.0',
      executor: 'ToolSandbox',
      features: [
        '自动依赖管理',
        '沙箱隔离执行',
        '三阶段执行流程',
        'pnpm集成',
        '@tool://协议支持',
      ],
    },
  }
}

export default {
  // 异步模块初始化
  initializeModules,

  // 动态获取核心类（需要先调用initializeModules）
  get ToolSandbox() { return ToolSandbox },
  get ToolValidator() { return ToolValidator },
  get ToolUtils() { return ToolUtils },
  get PackageInstaller() { return PackageInstaller },
  get ToolManualFormatter() { return ToolManualFormatter },

  // 动态获取接口规范
  get TOOL_INTERFACE() { return ToolInterface?.TOOL_INTERFACE },
  get TOOL_ERROR_CODES() { return ToolInterface?.TOOL_ERROR_CODES },
  get TOOL_RESULT_FORMAT() { return ToolInterface?.TOOL_RESULT_FORMAT },
  get EXAMPLE_TOOL() { return ToolInterface?.EXAMPLE_TOOL },

  // 全局实例获取器
  getGlobalToolSandbox,

  // 便捷方法
  initialize,
  executeTool,
  reset,
  getStats,
}
