/**
 * DefaultExportHandler - Default 导出处理器
 *
 * 处理有 default 属性但不是 ES Module 的情况。
 * 需要检查 default 是否有实质内容。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ModuleHandlerModule = require('../base/ModuleHandler')
import logger from '@promptx/logger'

interface ModuleHandleResult {
  handled: boolean
  result?: unknown
}

interface ModuleHandlerContext {
  [k: string]: unknown
}

const ModuleHandler = ModuleHandlerModule

class DefaultExportHandler extends ModuleHandler {
  constructor() {
    super('DefaultExportHandler', 60) // 优先级 60
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

    // 已经被 ESModuleHandler 处理过的跳过
    if (mod.__esModule) {
      return { handled: false }
    }

    // 检查是否有 default 导出
    if (mod.default !== undefined) {
      // 检查 default 是否有实质内容
      if (this.isSubstantial(mod.default)) {
        logger.debug(`[DefaultExportHandler] Found substantial default export`)
        return { handled: true, result: mod.default }
      }

      // default 没有实质内容，检查其他导出
      const realKeys = this.getRealKeys(module)
      if (realKeys.length > 0) {
        logger.debug(`[DefaultExportHandler] Default is empty, using whole module`)
        return { handled: true, result: module }
      }
    }

    return { handled: false }
  }
}

export = DefaultExportHandler
