/**
 * SandboxIsolationManager - 统一管理所有沙箱隔离逻辑
 *
 * 职责：
 * - 创建完全隔离的 VM 沙箱环境
 * - 统一管理模块系统、进程环境、全局对象的隔离
 * - 提供安全、一致的沙箱执行上下文
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import path from 'path'
import Module from 'module'
import logger from '@promptx/logger'
import ElectronPolyfillsModule = require('./ElectronPolyfills')

const ElectronPolyfills = ElectronPolyfillsModule as unknown as new () => InstanceType<typeof ElectronPolyfillsModule>

interface SandboxOptions {
  enableDependencyLoading?: boolean
  enableBuiltinModules?: boolean
  enableFileSystemAccess?: boolean
  toolboxPath?: string
  analysisMode?: boolean
  [k: string]: unknown
}

class SandboxIsolationManager {
  public workingPath: string
  public toolboxPath: string
  public sandboxPath: string
  public options: SandboxOptions
  public isolatedContext: Record<string, unknown> | null
  private electronPolyfills: InstanceType<typeof ElectronPolyfillsModule>

  constructor(workingPath: string, options: SandboxOptions = {}) {
    this.workingPath = workingPath
    this.toolboxPath = (options.toolboxPath as string) || workingPath
    this.sandboxPath = workingPath // 向后兼容
    this.options = {
      enableDependencyLoading: true,
      enableBuiltinModules: true,
      enableFileSystemAccess: false,
      ...options,
    }
    this.isolatedContext = null
    this.electronPolyfills = new ElectronPolyfills()
  }

  /**
   * 创建完全隔离的沙箱环境
   */
  createIsolatedContext(): Record<string, unknown> {
    if (this.isolatedContext) {
      return this.isolatedContext
    }

    this.isolatedContext = {
      // 1. 模块系统隔离
      require: this.createIsolatedRequire(),
      module: { exports: {} },
      exports: {},

      // 2. 进程环境隔离
      process: this.createIsolatedProcess(),

      // 3. 全局对象隔离
      ...this.createIsolatedGlobals(),

      // 4. 路径相关隔离
      __dirname: this.workingPath,
      __filename: path.join(this.workingPath, 'sandbox.js'),

      // 5. 受限的 fs（直接可用）
      fs: this.createRestrictedFS(),

      // 6. Electron polyfills
      ...this.electronPolyfills.getPolyfills(),

      // 7. 阻止动态代码执行
      eval: () => {
        throw new Error('[SandboxIsolation] eval is not allowed in sandbox')
      },
      Function: undefined,
    }

    return this.isolatedContext
  }

  /**
   * 创建隔离的 require 函数
   */
  createIsolatedRequire(): (moduleName: string) => unknown {
    const contextFile = path.join(this.toolboxPath, 'package.json')
    let sandboxRequire: (m: string) => unknown

    try {
      sandboxRequire = Module.createRequire(contextFile)
    } catch (error) {
      // fallback: 如果 package.json 不存在，使用虚拟路径
      const virtualContextFile = path.join(this.toolboxPath, 'virtual-context.js')
      sandboxRequire = Module.createRequire(virtualContextFile)
      logger.debug(`[SandboxIsolation] Using virtual context: ${(error as Error).message}`)
    }

    // 返回增强的 require 函数
    return (moduleName: string): unknown => {
      // 拦截 fs 和相关模块
      if (moduleName === 'fs' || moduleName === 'fs/promises') {
        return this.createRestrictedFS()
      }

      // 拦截 child_process，引导使用 api.execute()
      if (moduleName === 'child_process') {
        throw new Error(
          '[SandboxIsolation] Direct use of child_process is not recommended. ' +
            'Please use api.execute() instead for better cross-platform support and error handling.',
        )
      }

      // 拦截 path 模块
      if (moduleName === 'path') {
        return this.createRestrictedPath()
      }

      try {
        // 优先使用沙箱 require
        return sandboxRequire(moduleName)
      } catch (error) {
        // 智能 fallback 处理
        return this.handleRequireFallback(moduleName, error as Error)
      }
    }
  }

  /**
   * 处理 require 失败的智能 fallback
   */
  handleRequireFallback(moduleName: string, error: Error): unknown {
    // 1. 尝试加载 Node.js 内置模块
    if (this.options.enableBuiltinModules && this.isBuiltinModule(moduleName)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(moduleName)
      } catch {
        // 内置模块加载失败，继续下一步
      }
    }

    // 2. 如果是分析阶段且模块不存在，返回 mock 对象
    const errCode = (error as NodeJS.ErrnoException).code
    if (this.options.analysisMode && errCode === 'MODULE_NOT_FOUND') {
      logger.debug(`[SandboxIsolation] Analysis mode: mocking module ${moduleName}`)
      return this.createMockModule()
    }

    // 3. 其他情况直接抛出原始错误
    throw error
  }

  /**
   * 检查是否为 Node.js 内置模块
   */
  isBuiltinModule(moduleName: string): boolean {
    const builtinModules = [
      'path',
      'fs',
      'url',
      'crypto',
      'util',
      'os',
      'events',
      'stream',
      'http',
      'https',
      'querystring',
      'zlib',
      'buffer',
      'child_process',
    ]

    return builtinModules.includes(moduleName) || moduleName.startsWith('node:')
  }

  /**
   * 创建 mock 模块对象
   */
  createMockModule(): unknown {
    return new Proxy(
      {},
      {
        get: () => () => ({}), // 所有属性和方法都返回空函数/对象
        apply: () => ({}), // 如果被当作函数调用
        construct: () => ({}), // 如果被当作构造函数
      },
    )
  }

  /**
   * 创建文件系统访问接口
   */
  createRestrictedFS(): unknown {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const realFs = require('fs')
    logger.debug('[SandboxFS] Providing unrestricted filesystem access')
    return realFs
  }

  /**
   * 创建 path 模块访问接口
   */
  createRestrictedPath(): unknown {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('path')
  }

  /**
   * 创建隔离的 process 对象
   */
  createIsolatedProcess(): Record<string, unknown> {
    return {
      // 环境变量（浅拷贝）
      env: { ...process.env },

      // 工作目录返回 workingPath
      cwd: () => this.workingPath,

      // 安全的只读属性
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,

      // 时间相关
      hrtime: process.hrtime,
      uptime: process.uptime,

      // 禁用危险方法
      exit: () => {
        throw new Error('[SandboxIsolation] process.exit() is not allowed in sandbox')
      },
      abort: () => {
        throw new Error('[SandboxIsolation] process.abort() is not allowed in sandbox')
      },

      // 阻止底层访问
      binding: () => {
        throw new Error('[SandboxIsolation] process.binding() is not allowed in sandbox')
      },
      dlopen: () => {
        throw new Error('[SandboxIsolation] Native modules are not allowed in sandbox')
      },
    }
  }

  /**
   * 创建隔离的全局对象
   */
  createIsolatedGlobals(): Record<string, unknown> {
    return {
      // 基础类型
      Object,
      Array,
      String,
      Number,
      Boolean,
      Date,
      RegExp,
      Error,

      // JSON
      JSON,

      // 数学
      Math,

      // URL
      URL,
      URLSearchParams,

      // 缓冲区
      Buffer,

      // 定时器
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      setImmediate,
      clearImmediate,

      // 输出
      console,

      // Promise
      Promise,
    }
  }

  /**
   * 启用分析模式 - 用于工具分析阶段
   */
  enableAnalysisMode(): void {
    this.options.analysisMode = true
    this.isolatedContext = null
  }

  /**
   * 启用执行模式 - 用于工具执行阶段
   */
  enableExecutionMode(): void {
    this.options.analysisMode = false
    this.isolatedContext = null
  }

  /**
   * 清理隔离管理器
   */
  cleanup(): void {
    this.isolatedContext = null
  }

  /**
   * 获取隔离状态信息
   */
  getIsolationStatus(): Record<string, unknown> {
    return {
      sandboxPath: this.sandboxPath,
      options: this.options,
      contextCreated: !!this.isolatedContext,
      timestamp: new Date().toISOString(),
    }
  }
}

export = SandboxIsolationManager
