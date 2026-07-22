/**
 * ESModuleHandler - ES Module 处理器
 *
 * 处理带有 __esModule 标记的模块
 * 优先返回 default 导出。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 * 类型 ModuleHandleResult / ModuleHandlerContext 在 base/ModuleHandler 是 namespace 内部 export，
 * ESM `import type` 拿不到，直接在子类文件本地重新声明保持语义一致。
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

class ESModuleHandler extends ModuleHandler {
  constructor() {
    super('ESModuleHandler', 30) // 优先级 30
  }

  async process(
    module: unknown,
    _moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    if (!module || typeof module !== 'object') {
      return { handled: false }
    }

    const mod = module as { __esModule?: boolean; default?: unknown }

    if (mod.__esModule) {
      const realKeys = this.getRealKeys(module)

      if (mod.default !== undefined && realKeys.length > 0) {
        return { handled: true, result: module }
      }

      if (mod.default !== undefined) {
        return { handled: true, result: mod.default }
      }

      return { handled: true, result: module }
    }

    return { handled: false }
  }
}

export = ESModuleHandler