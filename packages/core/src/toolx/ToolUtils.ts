/**
 * ToolUtils - 工具实用函数集合
 *
 * 提供工具开发和使用的辅助函数：
 * - createSuccessResult / createErrorResult：标准化结果包装
 * - validateResult：结果格式校验
 * - safeExecute / benchmarkTool：安全执行 + 性能分析
 * - generateToolTemplate / getDevGuide：开发辅助
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ToolValidatorModule = require('./ToolValidator')

const ToolValidator = ToolValidatorModule as unknown as {
  validateTool: (tool: unknown) => { valid: boolean; errors: string[]; warnings: string[] }
}

interface ToolLike {
  getMetadata?: () => Record<string, unknown>
  getSchema?: () => Record<string, unknown>
  execute?: (...args: unknown[]) => Promise<unknown> | unknown
  validate?: (params: Record<string, unknown>) => { valid: boolean; errors: unknown }
}

interface SuccessResultOptions {
  tool?: string
  executionTime?: string | number | null
  metadata?: Record<string, unknown>
}

interface ErrorResultOptions {
  tool?: string
  details?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface ValidationResult {
  valid: boolean
  errors: string[]
}

interface BenchmarkStats {
  count?: number
  min?: number
  max?: number
  mean?: number
  median?: number
  p95?: number
  p99?: number
}

interface BenchmarkResult {
  toolName: string
  iterations: number
  warmup: number
  times: number[]
  stats: BenchmarkStats
  error?: string
}

interface BenchmarkOptions {
  iterations?: number
  warmup?: number
}

class ToolUtils {
  /**
   * 创建标准化的成功结果
   */
  static createSuccessResult(data: unknown, options: SuccessResultOptions = {}): Record<string, unknown> {
    const tool = options.tool ?? 'unknown'
    const executionTime = options.executionTime ?? null
    const metadata = options.metadata ?? {}

    return {
      success: true,
      data,
      metadata: {
        tool,
        executionTime,
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    }
  }

  /**
   * 创建标准化的错误结果
   */
  static createErrorResult(code: string, message: string, options: ErrorResultOptions = {}): Record<string, unknown> {
    const tool = options.tool ?? 'unknown'
    const details = options.details ?? {}
    const metadata = options.metadata ?? {}

    return {
      success: false,
      error: {
        code,
        message,
        details,
      },
      metadata: {
        tool,
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    }
  }

  /**
   * 验证工具结果格式
   */
  static validateResult(result: unknown): ValidationResult {
    const errors: string[] = []

    if (!result || typeof result !== 'object') {
      errors.push('结果必须是对象类型')
      return { valid: false, errors }
    }

    const r = result as { success?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } }

    if (typeof r.success !== 'boolean') {
      errors.push('结果必须包含 success(boolean) 字段')
    }

    if (r.success) {
      // 成功结果验证
      if (!('data' in r)) {
        errors.push('成功结果必须包含 data 字段')
      }
    } else {
      // 错误结果验证
      if (!r.error || typeof r.error !== 'object') {
        errors.push('错误结果必须包含 error(object) 字段')
      } else {
        if (!r.error.code || typeof r.error.code !== 'string') {
          errors.push('错误结果必须包含 error.code(string) 字段')
        }
        if (!r.error.message || typeof r.error.message !== 'string') {
          errors.push('错误结果必须包含 error.message(string) 字段')
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * 安全地执行工具方法
   */
  static async safeExecute(tool: ToolLike, methodName: string, ...args: unknown[]): Promise<unknown> {
    try {
      // KNUTH-NOTE: tool[methodName] 类型为 unknown，需要做函数检查
      const fn = tool[methodName as keyof ToolLike]
      if (!tool || typeof fn !== 'function') {
        throw new Error(`工具不存在方法: ${methodName}`)
      }

      const result = await (fn as (...a: unknown[]) => unknown)(...args)
      return result
    } catch (error) {
      throw new Error(`方法执行失败 ${methodName}: ${(error as Error).message}`)
    }
  }

  /**
   * 工具性能分析
   */
  static async benchmarkTool(
    tool: ToolLike,
    parameters: Record<string, unknown> = {},
    options: BenchmarkOptions = {},
  ): Promise<BenchmarkResult> {
    const iterations = options.iterations ?? 10
    const warmup = options.warmup ?? 3

    const results: BenchmarkResult = {
      toolName: 'unknown',
      iterations,
      warmup,
      times: [],
      stats: {},
    }

    try {
      // 获取工具名称
      if (tool.getMetadata) {
        const metadata = tool.getMetadata()
        results.toolName = (metadata.name as string) || 'unknown'
      }

      // 验证工具接口
      const validation = ToolValidator.validateTool(tool)
      if (!validation.valid) {
        throw new Error(`工具接口验证失败: ${validation.errors.join(', ')}`)
      }

      // 预热运行
      const exec = tool.execute as ((p: Record<string, unknown>) => Promise<unknown>) | undefined
      if (typeof exec !== 'function') {
        throw new Error('工具缺少 execute 方法')
      }
      for (let i = 0; i < warmup; i++) {
        await exec(parameters)
      }

      // 性能测试
      for (let i = 0; i < iterations; i++) {
        const startTime = process.hrtime.bigint()
        await exec(parameters)
        const endTime = process.hrtime.bigint()

        // 转换为毫秒
        const executionTime = Number(endTime - startTime) / 1000000
        results.times.push(executionTime)
      }

      // 计算统计信息
      results.stats = this.calculateStats(results.times)
    } catch (error) {
      results.error = (error as Error).message
    }

    return results
  }

  /**
   * 计算统计信息
   */
  static calculateStats(times: number[]): BenchmarkStats {
    if (times.length === 0) {
      return {}
    }

    const sorted = [...times].sort((a, b) => a - b)
    const sum = times.reduce((a, b) => a + b, 0)

    return {
      count: times.length,
      min: Math.min(...times),
      max: Math.max(...times),
      mean: sum / times.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    }
  }

  /**
   * 生成工具模板代码
   */
  static generateToolTemplate(options: Record<string, string> = {}): string {
    const toolName = options.toolName ?? 'ExampleTool'
    const className = options.className ?? 'ExampleTool'
    const description = options.description ?? '示例工具'
    const category = options.category ?? 'utility'
    const author = options.author ?? 'Perseng Developer'

    return `/**
 * ${className} - ${description}
 * 使用 Perseng 鸭子类型接口，无需继承任何基类
 */
class ${className} {
  getMetadata() {
    return {
      name: '${toolName}',
      description: '${description}',
      version: '1.0.0',
      category: '${category}',
      author: '${author}'
    };
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: '输入参数'
        }
      },
      required: ['input'],
      additionalProperties: false
    };
  }

  async execute(parameters) {
    const { input } = parameters;

    try {
      // TODO: 实现工具逻辑
      const result = \`处理结果: \${input}\`;

      return result;
    } catch (error) {
      throw new Error(\`执行失败: \${error.message}\`);
    }
  }

  // 可选：自定义参数验证
  validate(parameters) {
    const errors = [];

    if (!parameters.input || parameters.input.trim() === '') {
      errors.push('input 不能为空');
    }

    return { valid: errors.length === 0, errors };
  }

  // 可选：清理资源
  cleanup() {
    // 清理逻辑
  }
}

module.exports = ${className};
`
  }

  /**
   * 创建工具开发指南
   */
  static getDevGuide(): string {
    return `
# Perseng Tool 开发指南

## 鸭子类型接口
Perseng 工具使用鸭子类型设计，无需继承任何基类。只需实现以下接口：

### 必需方法
1. \`getMetadata()\` - 返回工具元信息
2. \`getSchema()\` - 返回参数 JSON Schema
3. \`execute(parameters)\` - 执行工具逻辑

### 可选方法
1. \`validate(parameters)\` - 自定义参数验证
2. \`cleanup()\` - 清理资源
3. \`init(config)\` - 初始化工具

## 开发步骤
1. 使用 ToolUtils.generateToolTemplate() 生成模板
2. 实现必需的接口方法
3. 使用 ToolValidator.validateTool() 验证接口
4. 使用 ToolUtils.benchmarkTool() 性能测试
5. 注册到工具注册表

## 示例代码
\`\`\`javascript
${this.generateToolTemplate()}
\`\`\`

## 最佳实践
- 保持 execute 方法的幂等性
- 提供清晰的错误消息
- 使用合适的 JSON Schema 验证
- 实现适当的资源清理
- 遵循统一的结果格式
`
  }
}

export = ToolUtils
