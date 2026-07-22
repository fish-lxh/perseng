/**
 * NullHandler - 空值处理器
 *
 * 处理 null 和 undefined 的模块。
 * 优先级最高（10），空值不需要进一步处理。
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

class NullHandler extends ModuleHandler {
  constructor() {
    super('NullHandler', 10) // 优先级 10，最高
  }

  async process(
    module: unknown,
    _moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    if (module === null || module === undefined) {
      return { handled: true, result: module }
    }
    return { handled: false }
  }
}

export = NullHandler
