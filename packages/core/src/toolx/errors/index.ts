/**
 * 错误管理系统入口
 * 导出增强的 ToolError 和相关定义。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ToolErrorModule = require('./ToolError')
import ValidationErrorsExport from './ValidationErrors'

type ToolError = typeof ToolErrorModule

declare interface ErrorsIndexExport {
  ToolError: ToolError
  ERROR_CATEGORIES: unknown
  DEVELOPMENT_ERRORS: unknown
  VALIDATION_ERRORS: unknown
  SYSTEM_ERRORS: unknown
  validateAgainstSchema: (params: unknown, schema: unknown) => unknown
  checkMissingEnvVars: (envSchema: unknown, env: unknown) => string[]
}

const self = {} as ErrorsIndexExport

const ToolError = ToolErrorModule as ToolError

self.ToolError = ToolError
self.ERROR_CATEGORIES = ToolError.CATEGORIES
self.DEVELOPMENT_ERRORS = ToolError.DEVELOPMENT_ERRORS
self.VALIDATION_ERRORS = ToolError.VALIDATION_ERRORS
self.SYSTEM_ERRORS = ToolError.SYSTEM_ERRORS
self.validateAgainstSchema = (ToolError.validateAgainstSchema as (p: unknown, s: unknown) => unknown)
// KNUTH-NOTE: errors/index.js 把 validateAgainstSchema 直接挂在 module.exports 上，
// 旧消费方可能解构 const { validateAgainstSchema } = require('./errors')，
// 也可能通过 ToolError.validateAgainstSchema 访问。两路兼容。
self.validateAgainstSchema = ToolError.validateAgainstSchema as (p: unknown, s: unknown) => unknown
// KNUTH-NOTE: errors/index.js 用了 ValidationErrors 名字指向同一个 const 对象。
self.VALIDATION_ERRORS = ValidationErrorsExport.VALIDATION_ERRORS
self.checkMissingEnvVars = ((envSchema: unknown, env: unknown) =>
  ToolError.checkMissingEnvVars(envSchema as { required?: string[] }, env as Record<string, unknown>))

export = self