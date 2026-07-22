/**
 * ModuleNormalizer - 模块规范化责任链管理器
 *
 * 管理和执行模块规范化处理器链。
 * 支持动态添加/删除处理器，调整处理顺序。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import logger from '@promptx/logger'

interface ModuleHandlerLike {
  name: string
  priority: number
  setNext: (next: ModuleHandlerLike) => ModuleHandlerLike
  handle: (module: unknown, moduleName: string, context?: Record<string, unknown>) => Promise<{ handled: boolean; result?: unknown }>
}

interface HandlerInfo {
  name: string
  priority: number
}

class ModuleNormalizer {
  public handlers: ModuleHandlerLike[]
  public chain: ModuleHandlerLike | null

  constructor() {
    this.handlers = []
    this.chain = null
  }

  /**
   * 添加处理器
   */
  addHandler(handler: ModuleHandlerLike): ModuleNormalizer {
    this.handlers.push(handler)
    // 按优先级排序
    this.handlers.sort((a, b) => a.priority - b.priority)
    this.rebuildChain()
    return this
  }

  /**
   * 批量添加处理器
   */
  addHandlers(handlers: ModuleHandlerLike[]): ModuleNormalizer {
    for (const handler of handlers) {
      this.handlers.push(handler)
    }
    this.handlers.sort((a, b) => a.priority - b.priority)
    this.rebuildChain()
    return this
  }

  /**
   * 移除处理器
   */
  removeHandler(handlerName: string): ModuleNormalizer {
    this.handlers = this.handlers.filter((h) => h.name !== handlerName)
    this.rebuildChain()
    return this
  }

  /**
   * 重建处理链
   */
  rebuildChain(): void {
    if (this.handlers.length === 0) {
      this.chain = null
      return
    }

    // 构建链
    const first = this.handlers[0]
    if (!first) {
      this.chain = null
      return
    }
    this.chain = first
    let current: ModuleHandlerLike = first
    for (let i = 1; i < this.handlers.length; i++) {
      const next = this.handlers[i]
      if (!next) continue
      current = current.setNext(next)
      current = next
    }

    logger.debug(
      `[ModuleNormalizer] Chain rebuilt - ${this.handlers.map((h) => `${h.name}(${h.priority})`).join(', ')}`,
    )
  }

  /**
   * 规范化模块
   */
  async normalize(
    module: unknown,
    moduleName: string,
    context: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!this.chain) {
      logger.warn('[ModuleNormalizer] No handlers configured, returning original module')
      return module
    }

    try {
      const startTime = Date.now()
      const result = await this.chain.handle(module, moduleName, context)

      const duration = Date.now() - startTime
      const resultObj = result as { result?: unknown }
      const r = resultObj.result
      const mod = module as { default?: unknown; __esModule?: boolean } | null
      logger.debug(
        `[ModuleNormalizer] Normalization completed - moduleName=${moduleName} duration=${duration}ms inputType=${typeof module} outputType=${typeof r} hasDefault=${!!(mod && mod.default !== undefined)} isESModule=${!!(mod && mod.__esModule)}`,
      )

      return resultObj.result
    } catch (error) {
      const err = error as Error
      logger.error(
        `[ModuleNormalizer] Failed to normalize ${moduleName} - error=${err.message} stack=${err.stack || ''}`,
      )
      // 失败时返回原模块
      return module
    }
  }

  /**
   * 获取处理器信息
   */
  getHandlerInfo(): HandlerInfo[] {
    return this.handlers.map((h) => ({
      name: h.name,
      priority: h.priority,
    }))
  }

  /**
   * 清空所有处理器
   */
  clear(): void {
    this.handlers = []
    this.chain = null
  }

  /**
   * 设置默认处理器链
   * 这个方法将在 index.js 中调用，以避免循环依赖
   */
  setupDefaultHandlers(handlers: ModuleHandlerLike[]): void {
    this.clear()
    this.addHandlers(handlers)
  }
}

export = ModuleNormalizer
