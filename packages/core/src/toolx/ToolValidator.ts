/**
 * ToolValidator - 工具接口验证器
 *
 * 使用鸭子类型验证工具是否符合 Perseng 接口规范。
 * 必填 getMetadata/getSchema/execute，可选 api 等 8 个 hooks。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 * ToolInterface 用 `export = Ns` 模式，consumer 拿不到内部 MethodSpec 类型 — 私有 self 字段
 * 用 Record<string, unknown> 兜底。
 */
import ToolInterfaceModule = require('./ToolInterface')

const ToolInterfaceMod = ToolInterfaceModule as unknown as {
  TOOL_INTERFACE: {
    required: Array<{ name: string; [k: string]: unknown }>
    optional: Array<{ name: string; [k: string]: unknown }>
  }
  TOOL_ERROR_CODES: Record<string, string>
}

interface ToolLike {
  getMetadata?: () => Record<string, unknown>
  getSchema?: () => { type?: unknown; properties?: unknown; required?: unknown; parameters?: unknown; [k: string]: unknown }
  execute?: (...args: unknown[]) => unknown
  validate?: (...args: unknown[]) => unknown
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

interface MethodValidationResult extends ValidationResult {}

interface FieldError {
  param: string
  expected: string
  actual: string
}

interface DefaultValidateResult {
  valid: boolean
  errors: string[]
  missing: string[]
  typeErrors: FieldError[]
}

interface InterfaceReport {
  toolName: string
  valid: boolean
  errors: string[]
  warnings: string[]
  implementedMethods: {
    required: string[]
    optional: string[]
  }
  metadata: Record<string, unknown> | null
  schema: unknown
}

class ToolValidator {
  /**
   * 验证工具是否符合接口规范
   * @returns 验证结果 {valid, errors, warnings}
   */
  static validateTool(tool: unknown): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // 基础类型检查
    if (!tool || typeof tool !== 'object') {
      errors.push('工具必须是对象类型')
      return { valid: false, errors, warnings }
    }

    const toolObj = tool as ToolLike

    // 验证必需方法
    for (const methodSpec of ToolInterfaceMod.TOOL_INTERFACE.required) {
      const methodName = methodSpec.name

      if (!(methodName in toolObj)) {
        errors.push(`缺少必需方法: ${methodName}`)
        continue
      }

      if (typeof toolObj[methodName as keyof ToolLike] !== 'function') {
        errors.push(`${methodName} 必须是函数类型`)
        continue
      }

      // 方法签名验证
      try {
        const validationResult = this.validateMethod(toolObj, methodSpec)
        if (!validationResult.valid) {
          errors.push(...validationResult.errors)
          warnings.push(...validationResult.warnings)
        }
      } catch (error) {
        warnings.push(`${methodName} 方法验证时出错: ${(error as Error).message}`)
      }
    }

    // 验证可选方法
    for (const methodSpec of ToolInterfaceMod.TOOL_INTERFACE.optional) {
      const methodName = methodSpec.name

      if (methodName in toolObj) {
        const fn = toolObj[methodName as keyof ToolLike]
        if (typeof fn !== 'function') {
          warnings.push(`${methodName} 应该是函数类型`)
        } else {
          try {
            const validationResult = this.validateMethod(toolObj, methodSpec)
            if (!validationResult.valid) {
              warnings.push(...validationResult.errors)
            }
          } catch (error) {
            warnings.push(`${methodName} 方法验证时出错: ${(error as Error).message}`)
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * 验证特定方法
   */
  static validateMethod(tool: ToolLike, methodSpec: { name: string; [k: string]: unknown }): MethodValidationResult {
    const errors: string[] = []
    const warnings: string[] = []
    const methodName = methodSpec.name

    try {
      switch (methodName) {
        case 'getMetadata':
          return this.validateGetMetadata(tool)
        case 'getSchema':
          return this.validateGetSchema(tool)
        case 'execute':
          return this.validateExecute(tool)
        case 'validate':
          return this.validateValidateMethod(tool)
        default:
          return { valid: true, errors: [], warnings: [] }
      }
    } catch (error) {
      errors.push(`${methodName} 方法调用失败: ${(error as Error).message}`)
      return { valid: false, errors, warnings }
    }
  }

  /**
   * 验证 getMetadata 方法
   */
  static validateGetMetadata(tool: ToolLike): MethodValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      if (!tool.getMetadata) {
        return { valid: false, errors: ['缺少 getMetadata 方法'], warnings }
      }
      const metadata = tool.getMetadata()

      if (!metadata || typeof metadata !== 'object') {
        errors.push('getMetadata() 必须返回对象')
        return { valid: false, errors, warnings }
      }

      // 验证必需字段
      if (!metadata.name || typeof metadata.name !== 'string') {
        errors.push('metadata.name 必须是非空字符串')
      }

      if (!metadata.description || typeof metadata.description !== 'string') {
        errors.push('metadata.description 必须是非空字符串')
      }

      if (!metadata.version || typeof metadata.version !== 'string') {
        errors.push('metadata.version 必须是非空字符串')
      }

      // 验证可选字段
      if (metadata.category && typeof metadata.category !== 'string') {
        warnings.push('metadata.category 应该是字符串类型')
      }

      if (metadata.author && typeof metadata.author !== 'string') {
        warnings.push('metadata.author 应该是字符串类型')
      }
    } catch (error) {
      errors.push(`getMetadata() 执行失败: ${(error as Error).message}`)
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * 验证 getSchema 方法
   */
  static validateGetSchema(tool: ToolLike): MethodValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      if (!tool.getSchema) {
        return { valid: false, errors: ['缺少 getSchema 方法'], warnings }
      }
      const schema = tool.getSchema()

      if (!schema || typeof schema !== 'object') {
        errors.push('getSchema() 必须返回对象')
        return { valid: false, errors, warnings }
      }

      // 基础 JSON Schema 验证
      if (!schema.type) {
        warnings.push('schema.type 建议定义')
      }

      if (schema.type && typeof schema.type !== 'string') {
        errors.push('schema.type 必须是字符串')
      }

      if (schema.properties && typeof schema.properties !== 'object') {
        errors.push('schema.properties 必须是对象')
      }

      if (schema.required && !Array.isArray(schema.required)) {
        errors.push('schema.required 必须是数组')
      }
    } catch (error) {
      errors.push(`getSchema() 执行失败: ${(error as Error).message}`)
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * 验证 execute 方法
   */
  static validateExecute(tool: ToolLike): MethodValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // 检查方法签名
    const executeMethod = tool.execute as (...args: unknown[]) => unknown
    if (executeMethod && executeMethod.length === 0) {
      warnings.push('execute() 方法建议接受 parameters 参数')
    }

    // 注意：这里不实际调用 execute 方法，因为可能有副作用
    // 只进行静态检查

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * 验证 validate 方法（可选）
   */
  static validateValidateMethod(tool: ToolLike): MethodValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    try {
      // 测试 validate 方法的返回格式
      const testParams: Record<string, unknown> = {}
      if (!tool.validate) {
        return { valid: false, errors: ['缺少 validate 方法'], warnings }
      }
      const result = tool.validate(testParams)

      if (!result || typeof result !== 'object') {
        errors.push('validate() 必须返回对象')
        return { valid: false, errors, warnings }
      }

      const r = result as { valid?: unknown; errors?: unknown }
      if (typeof r.valid !== 'boolean') {
        errors.push('validate() 返回值必须包含 valid(boolean)字段')
      }

      if (r.errors && !Array.isArray(r.errors)) {
        errors.push('validate() 返回值的 errors 字段必须是数组')
      }
    } catch (error) {
      warnings.push(`validate() 方法测试失败: ${(error as Error).message}`)
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * 为工具提供默认的 validate 方法实现
   */
  static defaultValidate(tool: ToolLike, parameters: Record<string, unknown>): DefaultValidateResult {
    const errors: string[] = []
    const missing: string[] = []
    const typeErrors: FieldError[] = []

    try {
      // 获取 schema
      if (!tool.getSchema) {
        return {
          valid: false,
          errors: ['缺少 getSchema 方法'],
          missing,
          typeErrors,
        }
      }
      const schema = tool.getSchema()

      // 基础类型检查
      if (!parameters || typeof parameters !== 'object') {
        errors.push('参数必须是对象类型')
        return { valid: false, errors, missing, typeErrors }
      }

      // 适配新 schema 格式：支持 schema.parameters 或直接使用 schema
      // 标准格式: { parameters: {...}, environment: {...} }
      // 兼容格式: { type: 'object', properties: {...}, required: [...] }
      const paramSchema = (schema.parameters || schema) as {
        required?: unknown
        properties?: Record<string, { type?: string; [k: string]: unknown }>
      }

      // 必需参数检查
      if (paramSchema.required && Array.isArray(paramSchema.required)) {
        for (const field of paramSchema.required) {
          if (typeof field === 'string' && !(field in parameters)) {
            errors.push(`缺少必需参数: ${field}`)
            missing.push(field)
          }
        }
      }

      // 基础字段类型检查
      if (paramSchema.properties && typeof paramSchema.properties === 'object') {
        for (const [field, fieldSchema] of Object.entries(paramSchema.properties)) {
          if (field in parameters) {
            const value = parameters[field]
            const expectedType = fieldSchema.type

            if (expectedType && !this.validateType(value, expectedType)) {
              const errorMsg = `参数 ${field} 类型错误，期望 ${expectedType}，实际 ${typeof value}`
              errors.push(errorMsg)
              typeErrors.push({
                param: field,
                expected: expectedType,
                actual: typeof value,
              })
            }
          }
        }
      }
    } catch (error) {
      errors.push(`参数验证失败: ${(error as Error).message}`)
    }

    return {
      valid: errors.length === 0,
      errors,
      missing,
      typeErrors,
    }
  }

  /**
   * 类型验证辅助方法
   */
  static validateType(value: unknown, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number'
      case 'boolean':
        return typeof value === 'boolean'
      case 'object':
        return typeof value === 'object' && value !== null
      case 'array':
        return Array.isArray(value)
      default:
        return true // 未知类型，跳过验证
    }
  }

  /**
   * 生成工具接口报告
   */
  static generateInterfaceReport(tool: ToolLike): InterfaceReport {
    const validation = this.validateTool(tool)
    const report: InterfaceReport = {
      toolName: 'unknown',
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      implementedMethods: {
        required: [],
        optional: [],
      },
      metadata: null,
      schema: null,
    }

    try {
      // 获取工具名称
      if (tool.getMetadata) {
        const metadata = tool.getMetadata()
        report.toolName = (metadata.name as string) || 'unknown'
        report.metadata = metadata
      }

      // 获取 schema
      if (tool.getSchema) {
        report.schema = tool.getSchema()
      }

      // 检查已实现的方法
      for (const methodSpec of ToolInterfaceMod.TOOL_INTERFACE.required) {
        const fn = tool[methodSpec.name as keyof ToolLike]
        if (typeof fn === 'function') {
          report.implementedMethods.required.push(methodSpec.name)
        }
      }

      for (const methodSpec of ToolInterfaceMod.TOOL_INTERFACE.optional) {
        const fn = tool[methodSpec.name as keyof ToolLike]
        if (typeof fn === 'function') {
          report.implementedMethods.optional.push(methodSpec.name)
        }
      }
    } catch (error) {
      report.warnings.push(`生成报告时出错: ${(error as Error).message}`)
    }

    return report
  }
}

export = ToolValidator
