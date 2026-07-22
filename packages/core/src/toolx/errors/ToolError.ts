/**
 * ToolError - 增强的工具错误类
 *
 * 统一的错误处理入口，承担所有错误分析和分类职责
 * - 内置错误分析逻辑（替代 ToolErrorManager）
 * - 支持四层错误分类体系
 * - 提供结构化错误数据
 * - 渲染职责交给 ToolCommand
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ERROR_CATEGORIES from './ErrorCategories'
import DEVELOPMENT_ERRORS from './DevelopmentErrors'
import ValidationErrorsExport, { validateAgainstSchema } from './ValidationErrors'
import SYSTEM_ERRORS from './SystemErrors'

// KNUTH-FIX 2026-07-22 (TS migration): 匿名 any 兜底，避开 TS4023 外部 module 私有类型
// (ValidationErrorDefinition 等) 不能 name 的问题。运行时类型仍由 ValidationErrors.ts 保证。
const VALIDATION_ERRORS_OBJ = ValidationErrorsExport.VALIDATION_ERRORS as unknown as Record<string, {
  code: string
  description: string
  identify?: (error: Error, context?: unknown) => boolean
  getSolution: (error: Error, context?: unknown) => unknown
}>

interface CategoryInfo {
  name: string
  emoji?: string
  description?: string
  responsibility?: string
  severity?: string
}

interface ErrorDetails {
  category?: string
  solution?: unknown
  retryable?: boolean
  businessError?: unknown
  context?: Record<string, unknown>
  originalError?: Error
  [k: string]: unknown
}

interface AnalysisResult {
  category: string
  code: string
  description?: string
  solution?: unknown
  retryable?: boolean
  businessError?: unknown
}

interface BusinessErrorDef {
  code: string
  description?: string
  match?: string | RegExp | ((error: Error, context?: unknown) => boolean)
  identify?: string | RegExp | ((error: Error, context?: unknown) => boolean)
  solution?: unknown
  retryable?: boolean
}

type Matcher = string | RegExp | ((error: Error, context?: unknown) => boolean)

interface ToolErrorContext {
  businessErrors?: BusinessErrorDef[]
  schema?: { parameters?: unknown; environment?: { required?: string[] }; [k: string]: unknown }
  params?: unknown
  environment?: Record<string, unknown>
  validationResult?: unknown
  missingEnvVars?: string[]
  [k: string]: unknown
}

class ToolError extends Error {
  static CATEGORIES: typeof ERROR_CATEGORIES
  static DEVELOPMENT_ERRORS: typeof DEVELOPMENT_ERRORS
  static VALIDATION_ERRORS: typeof VALIDATION_ERRORS_OBJ
  static SYSTEM_ERRORS: typeof SYSTEM_ERRORS

  // KNUTH-FIX 2026-07-22 (TS migration): 私有类型 SchemaValidationResult 在
  // ValidationErrors.ts 命名空间内部，不能 export name — 用 unknown 兜底避免 TS4026。
  static validateAgainstSchema: (params: unknown, schema: unknown) => unknown = validateAgainstSchema as unknown as (params: unknown, schema: unknown) => unknown

  static CODES: Record<string, string>

  static checkMissingEnvVars(
    envSchema: { required?: string[] } | unknown,
    env: Record<string, unknown>,
  ): string[] {
    const missing: string[] = []
    if (envSchema && typeof envSchema === 'object') {
      const req = (envSchema as { required?: unknown }).required
      if (Array.isArray(req)) {
        for (const envName of req) {
          if (typeof envName === 'string' && !env[envName]) {
            missing.push(envName)
          }
        }
      }
    }
    return missing
  }

  public code: string
  public category: string
  public categoryInfo: CategoryInfo | undefined
  public solution: unknown
  public retryable: boolean
  public businessError: unknown
  public context: Record<string, unknown>
  public originalError: Error | null
  public details: ErrorDetails

  constructor(message: string, code: string = 'UNKNOWN_ERROR', details: ErrorDetails = {}) {
    super(message)
    this.name = 'ToolError'
    this.code = code

    this.category = details.category || 'UNKNOWN'
    this.categoryInfo = (ERROR_CATEGORIES as Record<string, CategoryInfo>)[this.category]
    this.solution = details.solution || null
    this.retryable = details.retryable || false
    this.businessError = details.businessError || null
    this.context = details.context || {}
    this.originalError = details.originalError || null
    this.details = details

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ToolError)
    }
  }

  static from(source: unknown, context: ToolErrorContext = {}): ToolError {
    if (source instanceof ToolError) {
      return source
    }

    if (source instanceof Error) {
      const analysis = ToolError.analyze(source, context)

      return new ToolError(
        source.message,
        analysis.code,
        {
          category: analysis.category,
          solution: analysis.solution,
          retryable: analysis.retryable,
          businessError: analysis.businessError,
          context: context as Record<string, unknown>,
          originalError: source,
          stack: source.stack,
        },
      )
    }

    if (source && typeof source === 'object') {
      const src = source as { formatted?: string; message?: string; code?: string; category?: string; solution?: unknown }
      return new ToolError(
        src.formatted || src.message || 'Unknown error',
        src.code || src.category || 'UNKNOWN_ERROR',
        {
          category: src.category,
          solution: src.solution,
          ...context,
        },
      )
    }

    return new ToolError(String(source), 'UNKNOWN_ERROR', context as ErrorDetails)
  }

  static analyze(error: Error, context: ToolErrorContext = {}): AnalysisResult {
    if (context.businessErrors && Array.isArray(context.businessErrors)) {
      for (const bizError of context.businessErrors) {
        if (ToolError.isMatch(error, bizError.match || bizError.identify, context)) {
          return {
            category: ERROR_CATEGORIES.BUSINESS!.name,
            code: bizError.code,
            description: bizError.description,
            solution: bizError.solution,
            retryable: bizError.retryable || false,
            businessError: bizError,
          }
        }
      }
    }

    if (context.schema && context.params) {
      const paramSchema = (context.schema.parameters || context.schema) as unknown
      const validation = validateAgainstSchema(context.params, paramSchema)
      if (!validation.valid) {
        context.validationResult = validation

        if (validation.missing && validation.missing.length > 0) {
          const errorDef = VALIDATION_ERRORS_OBJ.MISSING_REQUIRED_PARAM!
          return {
            category: ERROR_CATEGORIES.VALIDATION!.name,
            code: errorDef!.code,
            description: errorDef!.description,
            solution: errorDef!.getSolution(error, context as unknown as Parameters<typeof errorDef.getSolution>[1]),
          }
        }

        if (validation.typeErrors && validation.typeErrors.length > 0) {
          const errorDef = VALIDATION_ERRORS_OBJ.INVALID_PARAM_TYPE!
          return {
            category: ERROR_CATEGORIES.VALIDATION!.name,
            code: errorDef!.code,
            description: errorDef!.description,
            solution: errorDef!.getSolution(error, context as unknown as Parameters<typeof errorDef.getSolution>[1]),
          }
        }

        if (validation.enumErrors && validation.enumErrors.length > 0) {
          const errorDef = VALIDATION_ERRORS_OBJ.PARAM_OUT_OF_RANGE!
          return {
            category: ERROR_CATEGORIES.VALIDATION!.name,
            code: errorDef!.code,
            description: errorDef!.description,
            solution: errorDef!.getSolution(error, context as unknown as Parameters<typeof errorDef.getSolution>[1]),
          }
        }
      }
    }

    if (context.environment && context.schema?.environment) {
      const envSchema = context.schema.environment
      const missingEnvVars: string[] = []

      if (envSchema.required && Array.isArray(envSchema.required)) {
        for (const envName of envSchema.required) {
          if (!context.environment[envName]) {
            missingEnvVars.push(envName)
          }
        }
      }

      if (missingEnvVars.length > 0) {
        context.missingEnvVars = missingEnvVars
        const errorDef = VALIDATION_ERRORS_OBJ.MISSING_ENV_VAR!
        return {
          category: ERROR_CATEGORIES.VALIDATION!.name,
          code: errorDef!.code,
          description: errorDef!.description,
          solution: errorDef!.getSolution(error, context as unknown as Parameters<typeof errorDef.getSolution>[1]),
        }
      }
    }

    for (const [, errorDef] of Object.entries(VALIDATION_ERRORS_OBJ)) {
      const def = errorDef as { code: string; description: string; identify?: (error: Error, context?: unknown) => boolean; getSolution?: (error: Error, context?: unknown) => unknown }
      if (def.identify && def.identify(error, context)) {
        return {
          category: ERROR_CATEGORIES.VALIDATION!.name,
          code: def.code,
          description: def.description,
          solution: def.getSolution?.(error, context),
        }
      }
    }

    for (const [, errorDef] of Object.entries(DEVELOPMENT_ERRORS)) {
      const def = errorDef as { code: string; description: string; identify?: (error: Error, context?: unknown) => boolean; getSolution?: (error: Error, context?: unknown) => unknown }
      if (def.identify && def.identify(error, context)) {
        return {
          category: ERROR_CATEGORIES.DEVELOPMENT!.name,
          code: def.code,
          description: def.description,
          solution: def.getSolution?.(error, context),
        }
      }
    }

    for (const [, errorDef] of Object.entries(SYSTEM_ERRORS)) {
      const def = errorDef as { code: string; description: string; identify?: (error: Error, context?: unknown) => boolean; getSolution?: (error: Error, context?: unknown) => { autoRecoverable?: boolean } }
      if (def.identify && def.identify(error, context)) {
        const sol = def.getSolution?.(error, context) as { autoRecoverable?: boolean } | undefined
        return {
          category: ERROR_CATEGORIES.SYSTEM!.name,
          code: def.code,
          description: def.description,
          solution: sol,
          retryable: sol?.autoRecoverable || false,
        }
      }
    }

    return {
      category: ERROR_CATEGORIES.SYSTEM!.name,
      code: 'UNKNOWN_ERROR',
      description: '未知错误',
      solution: null,
    }
  }

  static isMatch(error: Error, matcher: Matcher | undefined, context: ToolErrorContext = {}): boolean {
    if (!matcher) return false

    if (typeof matcher === 'string') {
      return !!(error.message && error.message.includes(matcher))
    }
    if (matcher instanceof RegExp) {
      return !!(error.message && matcher.test(error.message))
    }
    if (typeof matcher === 'function') {
      return matcher(error, context)
    }

    return false
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      category: this.category,
      categoryInfo: this.categoryInfo,
      solution: this.solution,
      retryable: this.retryable,
      businessError: this.businessError,
      context: this.context,
      details: this.details,
    }
  }

  toMCPFormat(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      category: this.category,
      solution: this.solution,
      retryable: this.retryable,
      details: this.details,
    }
  }
}

ToolError.CATEGORIES = ERROR_CATEGORIES
ToolError.DEVELOPMENT_ERRORS = DEVELOPMENT_ERRORS
ToolError.VALIDATION_ERRORS = VALIDATION_ERRORS_OBJ
ToolError.SYSTEM_ERRORS = SYSTEM_ERRORS
ToolError.CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_PARAM: 'MISSING_PARAM',
  INVALID_TYPE: 'INVALID_TYPE',

  MISSING_DEPENDENCY: 'MISSING_DEPENDENCY',
  SYNTAX_ERROR: 'SYNTAX_ERROR',

  EXECUTION_ERROR: 'EXECUTION_ERROR',
  TIMEOUT: 'TIMEOUT',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',

  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
}

export = ToolError