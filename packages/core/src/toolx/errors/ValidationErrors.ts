/**
 * ValidationErrors - 参数和环境验证错误定义
 *
 * 这些错误由系统自动检测，基于工具的 getSchema() 和 getMetadata()。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式 + namespace 模式，
 * 同时导出 VALIDATION_ERRORS (const) + validateAgainstSchema (function)。
 */

interface ValidationContext {
  validationResult?: {
    valid: boolean
    errors?: string[]
    missing?: string[]
    typeErrors?: Array<{ param: string; expected: string; actual: string }>
    enumErrors?: Array<{ param: string; value: unknown; allowed: unknown[] }>
  }
  missingEnvVars?: string[]
  mode?: string
  tool_resource?: string
  [k: string]: unknown
}

interface ValidationSolution {
  message: string
  detail?: string | null
  example?: string | null
  autoRecoverable: boolean
  command?: string
  params?: string | string[]
  errors?: string[]
}

interface ValidationErrorDefinition {
  code: string
  category: string
  description: string
  identify: (error: Error, context?: ValidationContext) => boolean
  getSolution: (error: Error, context?: ValidationContext) => ValidationSolution
}

interface AjvTypeError {
  param: string
  expected: string
  actual: string
}

interface AjvEnumError {
  param: string
  value: unknown
  allowed: unknown[]
}

interface AjvRawError {
  keyword: string
  instancePath?: string
  params?: { missingProperty?: string }
  schema?: unknown
  data?: unknown
  message?: string
}

interface SchemaValidationResult {
  valid: boolean
  errors: string[]
  missing: string[]
  typeErrors: AjvTypeError[]
  enumErrors?: AjvEnumError[]
  ajvErrors?: unknown
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ValidationErrorsNs {
  export const VALIDATION_ERRORS: Record<string, ValidationErrorDefinition> = {
    MISSING_REQUIRED_PARAM: {
      code: 'MISSING_REQUIRED_PARAM',
      category: 'VALIDATION',
      description: '缺少必需的参数',
      identify: (error, context = {}) => {
        if (context.validationResult && !context.validationResult.valid) {
          return (context.validationResult.errors || []).some((e) =>
            e.includes('required') || e.includes('missing'),
          )
        }
        return error.message.includes('Missing required parameter') ||
               error.message.includes('required property')
      },
      getSolution: (_error, context = {}) => {
        const missing = context.validationResult?.missing || []
        return {
          message: `提供必需的参数。如不清楚参数格式，请使用 mode: manual 查看工具的完整参数说明`,
          params: missing.length > 0 ? missing : 'Check schema for required parameters',
          example: missing.length > 0
            ? `{ ${missing.map((p) => `"${p}": "value"`).join(', ')} }`
            : null,
          autoRecoverable: false,
        }
      },
    },

    INVALID_PARAM_TYPE: {
      code: 'INVALID_PARAM_TYPE',
      category: 'VALIDATION',
      description: '参数类型错误',
      identify: (error, context = {}) => {
        if (context.validationResult && !context.validationResult.valid) {
          return (context.validationResult.errors || []).some((e) =>
            e.includes('type') || e.includes('should be'),
          )
        }
        return /expected (string|number|boolean|object|array) but got/i.test(error.message) ||
               error.message.includes('type mismatch')
      },
      getSolution: (_error, context = {}) => {
        const typeErrors = context.validationResult?.typeErrors || []
        return {
          message: '修正参数类型。如不清楚参数格式，请使用 mode: manual 查看工具的完整参数说明',
          detail: typeErrors.length > 0
            ? typeErrors.map((e) => `${e.param}: 期望 ${e.expected}, 实际 ${e.actual}`).join('\n')
            : '检查参数类型是否符合 schema 定义',
          autoRecoverable: false,
        }
      },
    },

    PARAM_OUT_OF_RANGE: {
      code: 'PARAM_OUT_OF_RANGE',
      category: 'VALIDATION',
      description: '参数值超出允许范围',
      identify: (error, context = {}) => {
        if (context.validationResult && !context.validationResult.valid) {
          if (context.validationResult.enumErrors && context.validationResult.enumErrors.length > 0) {
            return true
          }
          return (context.validationResult.errors || []).some((e) =>
            e.includes('must be one of') ||
            e.includes('enum') ||
            e.includes('>= ') ||
            e.includes('<= '),
          )
        }
        return /out of range|exceeds maximum|below minimum/i.test(error.message) ||
               error.message.includes('enum') ||
               error.message.includes('not in allowed values') ||
               error.message.includes('must be one of')
      },
      getSolution: (_error, context = {}) => {
        const enumErrors = context.validationResult?.enumErrors || []
        if (enumErrors.length > 0) {
          const enumError = enumErrors[0] as AjvEnumError
          return {
            message: `参数 ${enumError.param} 的值无效。如不清楚参数格式，请使用 mode: manual 查看工具的完整参数说明`,
            detail: `当前值: "${String(enumError.value)}"\n允许的值: ${(enumError.allowed as unknown[]).join(', ')}`,
            example: `将 ${enumError.param} 设置为: ${String((enumError.allowed as unknown[])[0])}`,
            autoRecoverable: false,
          }
        }
        return {
          message: '参数值超出允许范围。如不清楚参数格式，请使用 mode: manual 查看工具的完整参数说明',
          detail: '请检查参数值是否在允许的范围内',
          autoRecoverable: false,
        }
      },
    },

    MISSING_ENV_VAR: {
      code: 'MISSING_ENV_VAR',
      category: 'VALIDATION',
      description: '缺少必需的环境变量',
      identify: (error, context = {}) => {
        if (context.missingEnvVars && context.missingEnvVars.length > 0) {
          return true
        }
        return error.message.includes('Missing environment variable') ||
               error.message.includes('env var not set') ||
               error.message.includes('缺少必需的配置')
      },
      getSolution: (error, context = {}) => {
        const missing = context.missingEnvVars || []
        const envVar = missing[0] || error.message.match(/variable ['"]?(\w+)['"]?/)?.[1] || 'UNKNOWN'

        return {
          message: `使用 configure 模式设置环境变量`,
          command: `toolx configure --set ${envVar}=value`,
          detail: missing.length > 0
            ? `缺少环境变量: ${missing.join(', ')}`
            : `缺少环境变量: ${envVar}`,
          autoRecoverable: false,
        }
      },
    },

    INVALID_ENV_VAR_VALUE: {
      code: 'INVALID_ENV_VAR_VALUE',
      category: 'VALIDATION',
      description: '环境变量值无效',
      identify: (error) => {
        return error.message.includes('Invalid environment variable') ||
               error.message.includes('env var invalid')
      },
      getSolution: () => {
        return {
          message: '检查环境变量值是否正确',
          detail: '使用 configure 模式重新设置',
          autoRecoverable: false,
        }
      },
    },

    PARAMETERS_NOT_OBJECT: {
      code: 'PARAMETERS_NOT_OBJECT',
      category: 'VALIDATION',
      description: 'execute/rebuild 模式需要 parameters 对象',
      identify: (error) => {
        return error.message.includes('Parameters must be an object') ||
               error.message.includes('需要 parameters 对象') ||
               error.message.includes('parameters 参数')
      },
      getSolution: (_error, context = {}) => {
        const mode = context.mode || 'execute'
        const toolName = (context.tool_resource as string | undefined)?.replace('@tool://', '') || 'tool-name'
        return {
          message: `${mode} 模式需要 parameters 对象`,
          example: `{tool_resource: '@tool://${toolName}', mode: '${mode}', parameters: {...}}`,
          detail: `💡 建议：先用 mode: 'manual' 查看工具参数要求`,
          command: `先执行: {tool_resource: '@tool://${toolName}', mode: 'manual'}`,
          autoRecoverable: false,
        }
      },
    },

    SCHEMA_VALIDATION_FAILED: {
      code: 'SCHEMA_VALIDATION_FAILED',
      category: 'VALIDATION',
      description: '参数未通过 schema 验证',
      identify: (_error, context = {}) => {
        return !!(context.validationResult && !context.validationResult.valid)
      },
      getSolution: (_error, context = {}) => {
        const errors = context.validationResult?.errors || []
        return {
          message: '参数验证失败',
          errors,
          detail: errors.length > 0 ? errors.join('\n') : '请检查参数格式',
          autoRecoverable: false,
        }
      },
    },
  }

  /**
   * 基于 schema 自动验证参数（使用 Ajv）。
   */
  export function validateAgainstSchema(params: unknown, schema: any): SchemaValidationResult {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Ajv = require('ajv')
    const ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
      coerceTypes: false,
    })

    if (!schema || !schema.properties) {
      return { valid: true, errors: [], missing: [], typeErrors: [] }
    }

    try {
      const validate = ajv.compile(schema)
      const valid = validate(params)

      if (valid) {
        return { valid: true, errors: [], missing: [], typeErrors: [] }
      }

      const errors: string[] = []
      const missing: string[] = []
      const typeErrors: AjvTypeError[] = []
      const enumErrors: AjvEnumError[] = []

      for (const error of (validate.errors || []) as AjvRawError[]) {
        const field = error.instancePath ? error.instancePath.substring(1) : error.params?.missingProperty

        switch (error.keyword) {
          case 'required':
            if (error.params?.missingProperty) {
              missing.push(error.params.missingProperty)
            }
            errors.push(`Missing required parameter: ${error.params?.missingProperty}`)
            break

          case 'type':
            typeErrors.push({
              param: field as string,
              expected: String(error.schema),
              actual: typeof error.data,
            })
            errors.push(`Parameter ${field} should be ${error.schema} but got ${typeof error.data}`)
            break

          case 'enum': {
            enumErrors.push({
              param: field as string,
              value: error.data,
              allowed: error.schema as unknown[],
            })
            errors.push(`Parameter ${field} must be one of: ${(error.schema as unknown[]).join(', ')}`)
            break
          }

          case 'minimum':
            errors.push(`Parameter ${field} must be >= ${error.schema}`)
            break

          case 'maximum':
            errors.push(`Parameter ${field} must be <= ${error.schema}`)
            break

          case 'minLength':
            errors.push(`Parameter ${field} length must be >= ${error.schema}`)
            break

          case 'maxLength':
            errors.push(`Parameter ${field} length must be <= ${error.schema}`)
            break

          case 'pattern':
            errors.push(`Parameter ${field} does not match required pattern`)
            break

          default:
            errors.push(error.message || `Parameter ${field} validation failed`)
        }
      }

      return {
        valid: false,
        errors,
        missing,
        typeErrors,
        enumErrors,
        ajvErrors: validate.errors,
      }
    } catch (err) {
      return {
        valid: false,
        errors: [`Schema compilation error: ${(err as Error).message}`],
        missing: [],
        typeErrors: [],
      }
    }
  }
}

declare interface ValidationErrorsExport {
  VALIDATION_ERRORS: typeof ValidationErrorsNs.VALIDATION_ERRORS
  validateAgainstSchema: typeof ValidationErrorsNs.validateAgainstSchema
}

const self = {} as ValidationErrorsExport
self.VALIDATION_ERRORS = ValidationErrorsNs.VALIDATION_ERRORS
self.validateAgainstSchema = ValidationErrorsNs.validateAgainstSchema

export = self