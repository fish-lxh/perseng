/**
 * ToolManualFormatter
 *
 * 负责从工具实例和源码生成 Markdown 格式的工具手册。
 *
 * 主要功能：
 * 1. 提取工具的 metadata/schema/dependencies
 * 2. 从源码中提取注释文档
 * 3. 生成格式化的 Markdown 手册
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const extractComments = require('extract-comments') as {
  (source: string): Array<{
    type: string
    value: string
    loc: { start: { line: number } }
  }>
}

interface ToolMetadata {
  name?: string
  id?: string
  description?: string
  version?: string
  category?: string
  author?: string
  tags?: string[]
  scenarios?: string[]
  limitations?: string[]
  [k: string]: unknown
}

interface ToolSchema {
  parameters?: SchemaNode
  environment?: SchemaNode
  [k: string]: unknown
}

interface SchemaNode {
  type?: string
  properties?: Record<string, SchemaProperty>
  required?: string[]
  items?: SchemaProperty
  enum?: unknown[]
  default?: unknown
  minimum?: number
  description?: string
}

interface SchemaProperty extends SchemaNode {
  [k: string]: unknown
}

interface BusinessError {
  code: string
  description?: string
  solution?: string
  retryable?: boolean
}

interface ToolInstance {
  getMetadata?: () => ToolMetadata
  getSchema?: () => ToolSchema
  getDependencies?: () => Record<string, string>
  getBusinessErrors?: () => BusinessError[]
  [k: string]: unknown
}

class ToolManualFormatter {
  constructor() {
    // 简化版，无需配置
  }

  /**
   * 生成工具手册
   */
  format(toolInstance: ToolInstance, toolResource: string, sourceCode: string | null = null): string {
    const metadata = this.safeGet(toolInstance, 'getMetadata') as ToolMetadata | null
    const schema = this.safeGet(toolInstance, 'getSchema') as ToolSchema | null
    const dependencies = this.safeGet(toolInstance, 'getDependencies') as Record<string, string> | null
    const businessErrors = this.safeGet(toolInstance, 'getBusinessErrors') as BusinessError[] | null

    const comments = sourceCode ? this.extractComments(sourceCode) : null

    return this.buildMarkdown({
      resource: toolResource,
      metadata,
      schema,
      dependencies,
      businessErrors,
      comments,
      toolInstance,
    })
  }

  /**
   * 安全调用工具方法
   */
  safeGet(instance: ToolInstance, methodName: keyof ToolInstance): unknown {
    try {
      const fn = instance[methodName]
      return typeof fn === 'function' ? (fn as () => unknown)() : null
    } catch {
      return null
    }
  }

  /**
   * 提取源码中的注释
   */
  extractComments(sourceCode: string): string | null {
    try {
      const comments = extractComments(sourceCode)

      // 查找文件顶部的块注释（通常是主要文档）
      const blockComment = comments.find(
        (c) => c.type === 'BlockComment' && c.loc.start.line <= 10,
      )

      if (blockComment) {
        // 清理注释内容，去掉星号前缀
        return blockComment.value
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, ''))
          .join('\n')
          .trim()
      }

      // 没有块注释，尝试多个行注释
      const lineComments = comments
        .filter((c) => c.type === 'LineComment' && c.loc.start.line <= 20)
        .map((c) => c.value.trim())
        .join('\n')

      return lineComments || null
    } catch {
      return null
    }
  }

  /**
   * 构建 Markdown 文档
   */
  buildMarkdown(data: {
    resource: string
    metadata: ToolMetadata | null
    schema: ToolSchema | null
    dependencies: Record<string, string> | null
    businessErrors: BusinessError[] | null
    comments: string | null
    toolInstance: ToolInstance
  }): string {
    const sections: string[] = []
    const { metadata, schema, dependencies, businessErrors, comments, resource, toolInstance } = data

    // 1. 标题和基础信息
    const title = metadata?.name || metadata?.id || resource.replace('@tool://', '')
    sections.push(`# 🔧 ${title}`)

    if (metadata?.description) {
      sections.push(`\n> ${metadata.description}`)
    }

    // 2. 源码注释
    if (comments) {
      sections.push(`\n## 📝 详细说明\n\n${comments}`)
    }

    // 3. 基础信息
    const infoLines: string[] = []
    if (metadata?.id) infoLines.push(`- **标识**: \`${resource}\``)
    if (metadata?.version) infoLines.push(`- **版本**: ${metadata.version}`)
    if (metadata?.category) infoLines.push(`- **分类**: ${metadata.category}`)
    if (metadata?.author) infoLines.push(`- **作者**: ${metadata.author}`)
    if (metadata?.tags && metadata.tags.length > 0) infoLines.push(`- **标签**: ${metadata.tags.join(', ')}`)

    if (infoLines.length > 0) {
      sections.push(`\n## 📋 基础信息\n\n${infoLines.join('\n')}`)
    }

    // 4. 使用场景
    if (metadata?.scenarios && metadata.scenarios.length > 0) {
      sections.push(`\n## ✅ 适用场景\n\n${metadata.scenarios.map((s) => `- ${s}`).join('\n')}`)
    }

    // 5. 限制说明
    if (metadata?.limitations && metadata.limitations.length > 0) {
      sections.push(`\n## ⚠️ 限制说明\n\n${metadata.limitations.map((l) => `- ${l}`).join('\n')}`)
    }

    // 6. 参数定义
    if (schema?.parameters) {
      sections.push(this.formatParameters(schema.parameters))
    }

    // 7. 环境变量
    if (schema?.environment) {
      const envSection = this.formatEnvironment(schema.environment)
      if (envSection) sections.push(envSection)
    }

    // 8. 依赖包
    if (dependencies && Object.keys(dependencies).length > 0) {
      sections.push(this.formatDependencies(dependencies))
    }

    // 9. 业务错误
    if (businessErrors && businessErrors.length > 0) {
      sections.push(this.formatBusinessErrors(businessErrors))
    }

    // 10. 接口实现状态
    sections.push(this.formatInterfaces(toolInstance))

    // 11. 使用示例
    sections.push(this.formatExamples(resource, schema))

    return sections.filter(Boolean).join('\n')
  }

  /**
   * 格式化参数定义
   */
  formatParameters(params: SchemaNode): string {
    if (!params.properties || Object.keys(params.properties).length === 0) {
      return '\n## 📝 参数定义\n\n无需参数'
    }

    const lines = ['\n## 📝 参数定义']
    lines.push('\n| 参数 | 类型 | 必需 | 描述 | 默认值 |')
    lines.push('|------|------|------|------|--------|')

    const rows = this.collectParameterRows(params, '')
    lines.push(...rows)

    return lines.join('\n')
  }

  /**
   * 递归收集参数行（包括嵌套结构）
   */
  collectParameterRows(schema: SchemaNode, prefix = '', parentRequired: string[] = []): string[] {
    const rows: string[] = []

    if (!schema.properties) return rows

    const required = schema.required || parentRequired || []

    for (const [key, prop] of Object.entries(schema.properties)) {
      const propSchema = prop as SchemaProperty
      const isRequired = required.includes(key) ? '✅' : '❌'
      const type = this.formatType(propSchema)
      const desc = propSchema.description || '-'
      const defaultVal = propSchema.default !== undefined ? `\`${JSON.stringify(propSchema.default)}\`` : '-'

      // 当前参数行
      rows.push(`| ${prefix}${key} | ${type} | ${isRequired} | ${desc} | ${defaultVal} |`)

      // 嵌套结构
      if (propSchema.type === 'array' && propSchema.items?.type === 'object' && propSchema.items.properties) {
        const nestedPrefix = prefix ? prefix.replace(/└─ |├─ /, '│  ') + '└─ ' : '├─ '
        const nestedRows = this.collectParameterRows(propSchema.items, nestedPrefix, propSchema.items.required || [])
        rows.push(...nestedRows)
      } else if (propSchema.type === 'object' && propSchema.properties) {
        const nestedPrefix = prefix ? prefix.replace(/└─ |├─ /, '│  ') + '└─ ' : '├─ '
        const nestedRows = this.collectParameterRows(propSchema, nestedPrefix, propSchema.required || [])
        rows.push(...nestedRows)
      }
    }

    // 优化树形符号
    if (prefix && rows.length > 0) {
      let lastDirectChildIndex = -1
      const currentIndent = prefix.length

      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]
        if (!row) continue
        const match = row.match(/^[|]\s*([│├└─\s]+)/)
        if (match && match[1]) {
          const indent = match[1].replace(/[├└─]/g, '').length
          if (indent === currentIndent) {
            lastDirectChildIndex = i
            break
          }
        }
      }

      if (lastDirectChildIndex >= 0) {
        const target = rows[lastDirectChildIndex]
        if (target !== undefined) {
          rows[lastDirectChildIndex] = target.replace('├─', '└─')
        }
      }
    }

    return rows
  }

  /**
   * 格式化环境变量
   */
  formatEnvironment(env: SchemaNode): string | null {
    if (!env.properties || Object.keys(env.properties).length === 0) {
      return null
    }

    const lines = ['\n## 🔧 环境变量']
    lines.push('\n| 变量 | 类型 | 必需 | 描述 | 默认值 |')
    lines.push('|------|------|------|------|--------|')

    const required = env.required || []

    for (const [key, prop] of Object.entries(env.properties)) {
      const propertySchema = prop as SchemaProperty
      const isRequired = required.includes(key) ? '✅' : '❌'
      const type = propertySchema.type || 'string'
      const desc = propertySchema.description || '-'
      const defaultVal = propertySchema.default !== undefined ? `\`${propertySchema.default}\`` : '-'

      lines.push(`| ${key} | ${type} | ${isRequired} | ${desc} | ${defaultVal} |`)
    }

    return lines.join('\n')
  }

  /**
   * 格式化依赖包
   */
  formatDependencies(deps: Record<string, string>): string {
    const lines = ['\n## 📦 依赖包']
    lines.push('\n| 包名 | 版本 |')
    lines.push('|------|------|')

    for (const [name, version] of Object.entries(deps)) {
      lines.push(`| ${name} | \`${version}\` |`)
    }

    return lines.join('\n')
  }

  /**
   * 格式化业务错误
   */
  formatBusinessErrors(errors: BusinessError[]): string {
    const lines = ['\n## 🚨 业务错误']
    lines.push('\n| 错误码 | 描述 | 解决方案 | 可重试 |')
    lines.push('|--------|------|----------|--------|')

    for (const error of errors) {
      const retryable = error.retryable ? '✅' : '❌'
      lines.push(`| ${error.code} | ${error.description || ''} | ${error.solution || '-'} | ${retryable} |`)
    }

    return lines.join('\n')
  }

  /**
   * 格式化接口实现状态
   */
  formatInterfaces(toolInstance: ToolInstance): string {
    const lines = ['\n## 🔌 接口实现']
    lines.push('\n| 接口 | 状态 | 说明 |')
    lines.push('|------|------|------|')

    const interfaces: Array<{ name: string; required: boolean; desc: string }> = [
      { name: 'execute', required: true, desc: '执行工具（必需）' },
      { name: 'getMetadata', required: true, desc: '工具元信息（必需）' },
      { name: 'getDependencies', required: true, desc: '依赖声明（必需）' },
      { name: 'getSchema', required: false, desc: '参数定义' },
      { name: 'validate', required: false, desc: '参数验证' },
      { name: 'getBusinessErrors', required: false, desc: '业务错误定义' },
      { name: 'init', required: false, desc: '初始化钩子' },
      { name: 'cleanup', required: false, desc: '清理钩子' },
    ]

    for (const intf of interfaces) {
      const hasImpl = typeof toolInstance[intf.name] === 'function'
      const status = hasImpl ? '✅' : intf.required ? '❌' : '⭕'
      lines.push(`| ${intf.name} | ${status} | ${intf.desc} |`)
    }

    return lines.join('\n')
  }

  /**
   * 格式化使用示例
   */
  formatExamples(resource: string, schema: ToolSchema | null): string {
    const lines = ['\n## 💻 使用示例']
    lines.push('\n通过 mcp__promptx__toolx 调用，使用 YAML 格式：')
    lines.push('\n```yaml')

    lines.push('# 执行工具')
    const toolName = resource.replace('@tool://', '')
    lines.push(`url: tool://${toolName}`)
    lines.push('mode: execute')
    if (schema?.parameters?.properties && Object.keys(schema.parameters.properties).length > 0) {
      lines.push('parameters:')
      const exampleParams = this.generateExampleParams(schema.parameters)
      this.formatYAMLParams(lines, exampleParams, '  ')
    }

    lines.push('')
    lines.push('# 查看手册（第一次使用必看）')
    lines.push(`url: tool://${toolName}`)
    lines.push('mode: manual')

    // 配置环境变量
    if (schema?.environment?.properties && Object.keys(schema.environment.properties).length > 0) {
      lines.push('')
      lines.push('# 配置环境变量')
      lines.push(`url: tool://${toolName}`)
      lines.push('mode: configure')
      lines.push('parameters:')
      const firstEnvKey = Object.keys(schema.environment.properties)[0]
      if (firstEnvKey) {
        lines.push(`  ${firstEnvKey}: your_value_here`)
      }
    }

    lines.push('')
    lines.push('# 查看日志')
    lines.push(`url: tool://${toolName}`)
    lines.push('mode: log')
    lines.push('parameters:')
    lines.push('  action: tail')
    lines.push('  lines: 50')

    lines.push('```')

    return lines.join('\n')
  }

  /**
   * 格式化 YAML 参数
   */
  formatYAMLParams(lines: string[], params: Record<string, unknown>, indent = ''): void {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) {
        lines.push(`${indent}${key}: null`)
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        lines.push(`${indent}${key}:`)
        this.formatYAMLParams(lines, value as Record<string, unknown>, indent + '  ')
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${indent}${key}: []`)
        } else {
          lines.push(`${indent}${key}:`)
          for (const item of value) {
            if (typeof item === 'object') {
              lines.push(`${indent}- `)
              this.formatYAMLParams(lines, item as Record<string, unknown>, indent + '  ')
            } else {
              lines.push(`${indent}- ${item}`)
            }
          }
        }
      } else if (typeof value === 'string') {
        // 包含特殊字符的字符串用引号
        if (value.includes(':') || value.includes('#') || value.includes('|') || value.includes('>')) {
          lines.push(`${indent}${key}: "${value}"`)
        } else {
          lines.push(`${indent}${key}: ${value}`)
        }
      } else {
        lines.push(`${indent}${key}: ${value}`)
      }
    }
  }

  /**
   * 生成示例参数
   */
  generateExampleParams(paramSchema: SchemaNode): Record<string, unknown> {
    const example: Record<string, unknown> = {}

    if (!paramSchema.properties) return example

    for (const [key, prop] of Object.entries(paramSchema.properties)) {
      const propSchema = prop as SchemaProperty

      // 优先使用默认值
      if (propSchema.default !== undefined) {
        example[key] = propSchema.default
        continue
      }

      // 根据类型生成示例值
      switch (propSchema.type) {
        case 'string':
          example[key] = propSchema.enum ? (propSchema.enum[0] as string) : `example_${key}`
          break
        case 'number':
        case 'integer':
          example[key] = propSchema.minimum || 1
          break
        case 'boolean':
          example[key] = false
          break
        case 'array':
          if (propSchema.items?.type === 'object' && propSchema.items.properties) {
            example[key] = [this.generateExampleParams(propSchema.items)]
          } else {
            example[key] = []
          }
          break
        case 'object':
          if (propSchema.properties) {
            example[key] = this.generateExampleParams(propSchema)
          } else {
            example[key] = {}
          }
          break
        default:
          example[key] = null
      }
    }

    return example
  }

  /**
   * 格式化类型信息
   */
  formatType(prop: SchemaProperty): string {
    let type = prop.type || 'any'

    if (prop.enum && Array.isArray(prop.enum)) {
      type += ` (${prop.enum.join('|')})`
    }

    if (type === 'array' && prop.items) {
      type = `${prop.items.type || 'any'}[]`
    }

    return type
  }
}

export = ToolManualFormatter
