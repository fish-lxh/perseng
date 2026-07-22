/**
 * SingleExportHandler - 单一导出处理器
 *
 * 处理只有一个导出的模块。
 * 需要智能判断是否应该解包。
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

class SingleExportHandler extends ModuleHandler {
  constructor() {
    super('SingleExportHandler', 50) // 优先级 50，在多导出之后
  }

  async process(
    module: unknown,
    moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    if (!module || typeof module !== 'object') {
      return { handled: false }
    }

    const mod = module as Record<string, unknown>
    const realKeys = this.getRealKeys(module)

    if (realKeys.length === 1) {
      const key = realKeys[0]
      if (key === undefined) {
        return { handled: false }
      }
      const singleExport = mod[key]

      // 如果单一导出是函数，直接返回
      if (typeof singleExport === 'function') {
        logger.debug(`[SingleExportHandler] ${moduleName} single function export: ${key}`)
        return { handled: true, result: singleExport }
      }

      // 检查是否是包装键（应该解包）
      const wrappingKeys = [
        'default',
        'exports',
        moduleName,
        moduleName.split('/').pop() || '',
        moduleName.split('-').join(''),
        moduleName.split('_').join(''),
      ]

      const matched = wrappingKeys.some(
        (wk) => wk.toLowerCase() === key.toLowerCase(),
      )
      if (matched) {
        logger.debug(`[SingleExportHandler] ${moduleName} unwrapping ${key}`)
        return { handled: true, result: singleExport }
      }

      // 保守策略：不确定时返回整个模块
      logger.debug(`[SingleExportHandler] ${moduleName} keeping whole module (single export: ${key})`)
      return { handled: true, result: module }
    }

    return { handled: false }
  }
}

export = SingleExportHandler
