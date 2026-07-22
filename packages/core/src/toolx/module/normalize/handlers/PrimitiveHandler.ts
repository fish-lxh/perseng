/**
 * PrimitiveHandler - 原始类型处理器
 *
 * 处理字符串、数字、布尔值等原始类型。
 * 优先级最低（100），作为兜底。
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

class PrimitiveHandler extends ModuleHandler {
  constructor() {
    super('PrimitiveHandler', 100) // 优先级 100，最低
  }

  async process(
    module: unknown,
    _moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    const type = typeof module

    // 原始类型直接返回
    if (
      type === 'string' ||
      type === 'number' ||
      type === 'boolean' ||
      type === 'symbol' ||
      type === 'bigint'
    ) {
      return { handled: true, result: module }
    }

    // 对象类型在前面的处理器应该已经处理了
    // 到这里还是对象，说明是普通对象，直接返回
    if (type === 'object' && module !== null) {
      return { handled: true, result: module }
    }

    return { handled: false }
  }
}

export = PrimitiveHandler
