/**
 * ModuleHandler - 模块处理器基类
 *
 * 责任链模式的基础类，定义了处理器的接口和链式调用机制。
 * 所有具体的模块规范化处理器都应继承此类。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式 + namespace 模式
 * 让类型 (interface) 与 class 同 module 共存。
 */
import logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ModuleHandlerNs {
  export interface ModuleHandleResult {
    handled: boolean
    result?: unknown
  }

  export interface ModuleHandlerContext {
    [k: string]: unknown
  }

  export class ModuleHandler {
    public name: string
    public priority: number
    public next: ModuleHandler | null

    constructor(name: string, priority: number = 100) {
      this.name = name
      this.priority = priority
      this.next = null
    }

    setNext(handler: ModuleHandler): ModuleHandler {
      this.next = handler
      return handler
    }

    async handle(
      module: unknown,
      moduleName: string,
      context: ModuleHandlerContext = {},
    ): Promise<ModuleHandleResult> {
      try {
        const result = await this.process(module, moduleName, context)

        if (result.handled) {
          logger.info(`[ModuleHandler] ${moduleName} handled by ${this.name} handler=${this.name} moduleName=${moduleName} resultType=${typeof result.result}`)
          return result
        }

        if (this.next) {
          return this.next.handle(module, moduleName, context)
        }

        logger.debug(`[ModuleHandler] ${moduleName} not handled by any handler, returning original`)
        return { handled: true, result: module }
      } catch (error) {
        logger.error(`[ModuleHandler] ${this.name} failed to process ${moduleName}: ${(error as Error).message}`)

        if (this.next) {
          return this.next.handle(module, moduleName, context)
        }

        return { handled: true, result: module }
      }
    }

    async process(
      _module: unknown,
      _moduleName: string,
      _context: ModuleHandlerContext,
    ): Promise<ModuleHandleResult> {
      throw new Error(`Handler ${this.name} must implement process method`)
    }

    isSubstantial(value: unknown): boolean {
      if (value === null || value === undefined) {
        return false
      }

      const type = typeof value

      if (type === 'function') {
        return true
      }

      if (type === 'object') {
        const obj = value as Record<string, unknown> | unknown[]
        if (Array.isArray(obj)) {
          return obj.length > 0
        }
        return Object.keys(obj).length > 0
      }

      if (type === 'string') {
        return value !== ''
      }

      return true
    }

    getRealKeys(module: unknown): string[] {
      if (!module || typeof module !== 'object') {
        return []
      }

      return Object.keys(module as Record<string, unknown>).filter((k) =>
        k !== '__esModule' &&
        k !== 'default' &&
        k !== Symbol.toStringTag.toString() &&
        !k.startsWith('__'),
      )
    }
  }
}

export = ModuleHandlerNs.ModuleHandler