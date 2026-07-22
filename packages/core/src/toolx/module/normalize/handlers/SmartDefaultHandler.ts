/**
 * SmartDefaultHandler - 智能 Default 导出处理器
 *
 * 更智能地处理 default 导出，解决 CommonJS/ES Module 互操作问题。
 * 优先级比 MultiExportHandler 高，以便优先处理有 default 的情况。
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

class SmartDefaultHandler extends ModuleHandler {
  constructor() {
    super('SmartDefaultHandler', 35) // 优先级 35，在 ESModule 之后，MultiExport 之前
  }

  async process(
    module: unknown,
    moduleName: string,
    _context: ModuleHandlerContext,
  ): Promise<ModuleHandleResult> {
    if (!module || typeof module !== 'object') {
      return { handled: false }
    }

    const mod = module as { default?: unknown; __esModule?: boolean } & Record<string, unknown>

    // 如果没有 default 属性，不处理
    if (mod.default === undefined) {
      return { handled: false }
    }

    // 已经被 ESModuleHandler 处理过的跳过
    if (mod.__esModule) {
      return { handled: false }
    }

    const realKeys = this.getRealKeys(module)
    const hasDefault = mod.default !== undefined
    const defaultType = typeof mod.default
    const isDefaultSubstantial = this.isSubstantial(mod.default)

    logger.info(
      `[SmartDefaultHandler] Analyzing ${moduleName} hasDefault=${hasDefault} defaultType=${defaultType} isDefaultSubstantial=${isDefaultSubstantial} realKeysCount=${realKeys.length} realKeys=${JSON.stringify(realKeys.slice(0, 5))}`,
    )

    // 策略1: 纯包装型 - 只有 default 没有其他实质内容
    if (realKeys.length === 0 && isDefaultSubstantial) {
      logger.info(`[SmartDefaultHandler] ${moduleName} - Pure wrapper, using default`)
      return { handled: true, result: mod.default }
    }

    // 策略2: default 是函数，且同级都是辅助属性
    if (defaultType === 'function' && realKeys.length > 0) {
      const hasMainFunction = this.checkIfDefaultIsMain(mod, realKeys)
      if (hasMainFunction) {
        logger.info(`[SmartDefaultHandler] ${moduleName} - Default is main function`)
        return { handled: true, result: mod.default }
      }
    }

    // 策略3: 检查是否是 CommonJS 转 ES Module 的典型模式
    if (this.isCommonJSWrapped(mod, realKeys)) {
      logger.info(`[SmartDefaultHandler] ${moduleName} - CommonJS wrapped, using default`)
      return { handled: true, result: mod.default }
    }

    // 策略4: default 和同级内容相同（重复导出）
    if (this.isDefaultDuplicate(mod, realKeys)) {
      logger.info(`[SmartDefaultHandler] ${moduleName} - Default duplicates content, using default`)
      return { handled: true, result: mod.default }
    }

    // 不确定的情况，不处理，让其他 Handler 接手
    return { handled: false }
  }

  /**
   * 检查 default 是否是主函数
   * 例如 express: default 是主函数，其他是辅助
   */
  checkIfDefaultIsMain(module: Record<string, unknown>, realKeys: string[]): boolean {
    const mod = module as { default?: unknown }
    // 如果 default 不是函数，返回 false
    if (typeof mod.default !== 'function') {
      return false
    }

    // 策略1: 特定包的特殊处理
    // Express 的特征：有 Route, Router, application 等
    if (
      realKeys.includes('Router') &&
      realKeys.includes('Route') &&
      (realKeys.includes('application') || realKeys.includes('static'))
    ) {
      logger.info(`[SmartDefaultHandler] Detected express-like pattern`)
      return true
    }

    // Debug 的特征：有 colors, formatters 等
    if (realKeys.includes('colors') && realKeys.includes('formatters')) {
      logger.info(`[SmartDefaultHandler] Detected debug-like pattern`)
      return true
    }

    // Chalk 的特征：有大量颜色名称
    const colorPatterns = ['colors', 'backgroundColors', 'foregroundColors', 'modifierNames']
    const hasColorPattern = colorPatterns.some((p) => realKeys.includes(p))
    if (hasColorPattern) {
      logger.info(`[SmartDefaultHandler] Detected chalk-like pattern`)
      return true
    }

    // 策略2: 通用判断 - 如果 default 是函数，而同级大多是类或对象
    let nonFunctionCount = 0
    for (const key of realKeys.slice(0, 5)) {
      if (typeof module[key] !== 'function') {
        nonFunctionCount++
      }
    }

    // 如果大部分同级不是函数，可能 default 是主函数
    return nonFunctionCount > Math.min(realKeys.length, 5) * 0.6
  }

  /**
   * 检查是否是 CommonJS 包装模式
   */
  isCommonJSWrapped(module: Record<string, unknown>, realKeys: string[]): boolean {
    const mod = module as { default?: unknown }
    // 特征：default 包含所有同级功能
    if (!mod.default || typeof mod.default !== 'object') {
      return false
    }

    const def = mod.default as Record<string, unknown>

    // 检查 default 是否包含同级的主要方法
    let matchCount = 0
    for (const key of realKeys.slice(0, 5)) {
      if (
        typeof module[key] === 'function' &&
        typeof def[key] === 'function'
      ) {
        matchCount++
      }
    }

    // 如果大部分方法都在 default 中存在，可能是包装
    return matchCount > Math.min(realKeys.length, 5) * 0.6
  }

  /**
   * 检查 default 是否与模块内容重复
   */
  isDefaultDuplicate(module: Record<string, unknown>, realKeys: string[]): boolean {
    const mod = module as { default?: unknown }
    const def = mod.default

    // 如果 default 不是对象或函数，不可能重复
    if (
      !def ||
      (typeof def !== 'object' && typeof def !== 'function')
    ) {
      return false
    }

    // 函数的情况：检查是否 ALL exports 都是同一个引用
    if (typeof def === 'function') {
      let matchCount = 0
      for (const key of realKeys) {
        if (module[key] === def) {
          matchCount++
        }
      }

      // Only return true if ALL named exports are duplicates of default
      // If even ONE export is different, we must keep the whole module
      if (matchCount === realKeys.length && realKeys.length > 0) {
        return true
      }

      // Partial match means NOT duplicate - keep all exports
      return false
    }

    // 对象的情况：检查关键属性是否相同
    if (typeof def === 'object') {
      const defAsObj = def as Record<string, unknown>
      const defKeys = Object.keys(defAsObj).slice(0, 5)
      let sameCount = 0

      for (const key of defKeys) {
        if (module[key] === defAsObj[key]) {
          sameCount++
        }
      }

      // 如果大部分属性相同，认为是重复
      return sameCount > defKeys.length * 0.7
    }

    return false
  }
}

export = SmartDefaultHandler
