/**
 * FunctionHandler - 函数处理器
 *
 * 处理函数类型的模块。
 * 例如：express、moment 等直接导出函数的模块。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ModuleHandlerModule = require('../base/ModuleHandler')

interface ModuleHandleResult {
  handled: boolean
  result?: unknown
}

interface ModuleHandlerContext {
  [k: string]: unknown
}

const ModuleHandler = ModuleHandlerModule

class FunctionHandler extends ModuleHandler {
  constructor() {
    super('FunctionHandler', 20) // 优先级 20
  }

  async process(
    module: unknown,
    _moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    if (typeof module === 'function') {
      return { handled: true, result: module }
    }
    return { handled: false }
  }
}

export = FunctionHandler
