/**
 * MultiExportHandler - 多导出对象处理器
 *
 * 处理有多个导出的对象类型模块。
 * 例如：lodash、nodemailer 等工具库。
 * 这类模块应该保持整个对象，不要解包。
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

class MultiExportHandler extends ModuleHandler {
  constructor() {
    super('MultiExportHandler', 40) // 优先级 40，在 ESModule 之后
  }

  async process(
    module: unknown,
    moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    if (!module || typeof module !== 'object') {
      return { handled: false }
    }

    // 获取实际的导出键（排除元数据）
    const realKeys = this.getRealKeys(module)

    // 多个导出的对象，保持原样返回
    if (realKeys.length > 1) {
      logger.debug(
        `[MultiExportHandler] ${moduleName} has ${realKeys.length} exports - ${JSON.stringify(realKeys.slice(0, 10))}`,
      )
      return { handled: true, result: module }
    }

    return { handled: false }
  }
}

export = MultiExportHandler
