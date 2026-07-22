/**
 * ToolInterface - Perseng 工具接口规范
 *
 * 定义鸭子类型的工具接口，外部工具无需继承任何类。
 * 每个外部工具只需要实现 getMetadata / getSchema / execute 三个方法，
 * 系统会自动通过 `api` 注入 ToolAPI 运行时。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式 + namespace 模式
 * 让 tsup cjsInterop 不包成 namespace，并允许同时导出 const 对象。
 */

// ============================================================
// Tool 接口规范定义
// ============================================================

interface MethodSpec {
  name: string
  signature: string
  description: string
  parameters?: Record<string, string>
  returns?: string | Record<string, string>
  notes?: string
  example?: string
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ToolInterfaceNs {
  export const TOOL_INTERFACE: { required: MethodSpec[]; optional: MethodSpec[] } = {
    required: [
      {
        name: 'getMetadata',
        signature: '() => Object',
        description: '获取工具元信息',
        returns: {
          name: 'string - 工具名称',
          description: 'string - 工具描述',
          version: 'string - 版本号',
          category: 'string - 分类（可选）',
          author: 'string - 作者（可选）',
        },
      },
      {
        name: 'getSchema',
        signature: '() => Object',
        description: '获取参数JSON Schema',
        returns: {
          type: 'string - 参数类型，通常为object',
          properties: 'Object - 参数属性定义',
          required: 'Array - 必需参数列表（可选）',
          additionalProperties: 'boolean - 是否允许额外参数（可选）',
        },
      },
      {
        name: 'execute',
        signature: '(parameters: Object) => Promise<any>',
        description: '执行工具主逻辑',
        parameters: {
          parameters: 'Object - 工具参数，符合getSchema定义',
        },
        returns: 'Promise<any> - 工具执行结果',
      },
    ],

    optional: [
      {
        name: 'api',
        signature: 'ToolAPI',
        description: '统一的工具API接口（由ToolSandbox自动注入）',
        returns: 'ToolAPI - 提供environment, logger, storage, cache, metrics等所有运行时服务',
        notes: '此对象由 ToolSandbox 自动注入，工具无需实现。通过 this.api 访问所有运行时功能。',
      },
      {
        name: 'getDependencies',
        signature: '() => Object',
        description: '声明工具依赖（可选）',
        returns: 'Object - 依赖对象，格式：{包名: 版本}',
        notes: '声明工具需要的npm包依赖，系统会自动安装',
      },
      {
        name: 'cleanup',
        signature: '() => void | Promise<void>',
        description: '清理资源（可选）',
        returns: 'void | Promise<void>',
      },
      {
        name: 'init',
        signature: '(config?: Object) => void | Promise<void>',
        description: '初始化工具（可选）',
        parameters: {
          config: 'Object - 初始化配置（可选）',
        },
        returns: 'void | Promise<void>',
      },
      {
        name: 'getBusinessErrors',
        signature: '() => Array<BusinessError>',
        description: '定义工具的业务执行错误（可选但推荐）',
        returns: `Array<{
        code: string,
        description: string,
        match: string|RegExp|Function,
        solution: string|Object,
        retryable?: boolean
      }>`,
        notes: '工具可以定义特有的业务错误，这些错误将被系统识别并提供给AI处理',
      },
      {
        name: 'getBridges',
        signature: '() => Object<Bridge>',
        description: '定义工具的外部依赖桥接器（可选但推荐）',
        returns: `Object<{
        [operation: string]: {
          real: async (args, api) => any,
          mock: async (args, api) => any
        }
      }>`,
        notes: '定义外部依赖的real和mock实现，支持dry-run测试。每个操作需要提供real和/或mock实现。',
      },
      {
        name: 'getMockArgs',
        signature: '(operation: string) => Object',
        description: '为指定bridge操作生成mock参数（可选）',
        parameters: {
          operation: 'string - bridge操作名称',
        },
        returns: 'Object - 该操作的mock参数',
        notes: '用于dry-run测试时生成合理的测试参数',
      },
      {
        name: 'getBridgeErrors',
        signature: '() => Object<Array<BusinessError>>',
        description: '定义每个bridge操作的特定业务错误（可选）',
        returns: `Object<{
        [operation: string]: Array<BusinessError>
      }>`,
        notes: '为每个bridge操作定义特定的错误处理规则',
      },
    ],
  }

  export const TOOL_ERROR_CODES: Record<string, string> = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    EXECUTION_ERROR: 'EXECUTION_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    RESOURCE_ERROR: 'RESOURCE_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  }

  export const TOOL_RESULT_FORMAT: {
    success: Record<string, unknown>
    error: Record<string, unknown>
  } = {
    success: {
      success: true,
      data: 'any - 工具返回的实际数据',
      metadata: {
        tool: 'string - 工具名称',
        executionTime: 'string - 执行时间',
        timestamp: 'string - 时间戳',
      },
    },

    error: {
      success: false,
      error: {
        code: 'string - 错误代码（见TOOL_ERROR_CODES）',
        message: 'string - 错误消息',
        details: 'Object - 错误详情（可选）',
      },
      metadata: {
        tool: 'string - 工具名称',
        timestamp: 'string - 时间戳',
      },
    },
  }

  export const EXAMPLE_TOOL = `
class ExampleTool {
  getMetadata() {
    return {
      name: 'example-tool',
      description: '示例工具',
      version: '1.0.0',
      category: 'example',
      author: 'Perseng Team'
    };
  }

  getSchema() {
    return {
      parameters: {
        type: 'object',
        properties: { input: { type: 'string', description: '输入参数' } },
        required: ['input'],
        additionalProperties: false
      }
    };
  }

  async execute(parameters) {
    const { input } = parameters;
    return \`处理结果: \${input}\`;
  }

  getDependencies() { return { 'lodash': '^4.17.21' }; }
  cleanup() { console.log('Cleaning up resources'); }
  getBusinessErrors() {
    return [{
      code: 'INVALID_INPUT_FORMAT',
      description: '输入格式不正确',
      match: /invalid format|format error/i,
      solution: '请检查输入格式是否符合要求',
      retryable: false
    }];
  }
}

module.exports = ExampleTool;
`
}

export = ToolInterfaceNs