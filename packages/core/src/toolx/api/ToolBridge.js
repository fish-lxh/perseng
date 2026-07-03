/**
 * ToolBridge - 工具外部依赖桥接器
 *
 * 设计理念：
 * - 桥接模式：分离工具逻辑与外部依赖实现
 * - 双轨执行：支持real和mock两种执行路径
 * - 统一错误：所有错误通过ToolError处理
 * - 工具自主：让工具完全控制自己的依赖行为
 *
 * 使用场景：
 * - 外部API调用（HTTP请求、数据库连接等）
 * - 文件系统操作
 * - 第三方服务集成
 * - 任何需要mock的外部依赖
 */

const ToolError = require('../errors/ToolError');

class ToolBridge {
  constructor(toolInstance, api) {
    this.toolInstance = toolInstance;
    this.api = api;
    this.mode = 'execute'; // 'execute' | 'dryrun'
    this.bridges = null; // 缓存的bridge定义
  }

  /**
   * Bridge特定的错误类型
   */
  static BRIDGE_ERRORS = {
    NO_BRIDGE_DEFINED: {
      code: 'NO_BRIDGE_DEFINED',
      description: '未定义桥接器',
      category: 'DEVELOPMENT',
      getSolution: (error, context) => {
        return `请在工具的 getBridges() 方法中定义 '${context.operation}' 桥接器`;
      }
    },
    NO_IMPLEMENTATION: {
      code: 'NO_BRIDGE_IMPLEMENTATION',
      description: '缺少桥接实现',
      category: 'DEVELOPMENT',
      getSolution: (error, context) => {
        return `Bridge '${context.operation}' 缺少 ${context.mode} 实现`;
      }
    },
    BRIDGE_EXECUTION_FAILED: {
      code: 'BRIDGE_EXECUTION_FAILED',
      description: '桥接执行失败',
      category: 'BUSINESS',
      getSolution: (error, context) => {
        if (context.mode === 'dryrun') {
          return 'Mock实现出错，请检查mock逻辑';
        }
        return '外部依赖调用失败，请检查连接和参数';
      }
    },
    INVALID_BRIDGE_DEFINITION: {
      code: 'INVALID_BRIDGE_DEFINITION',
      description: '无效的桥接定义',
      category: 'DEVELOPMENT',
      getSolution: (error, context) => {
        return `Bridge '${context.bridgeName}' 定义格式错误：real和mock必须是函数`;
      }
    }
  };

  /**
   * 执行桥接操作
   * @param {string} operation - 操作名称，如 'mysql:connect'
   * @param {Object} args - 操作参数
   * @returns {Promise<any>} 操作结果
   */
  async execute(operation, args) {
    try {
      // 延迟加载bridges
      if (!this.bridges) {
        this.loadBridges();
      }

      const bridge = this.bridges[operation];
      if (!bridge) {
        throw new ToolError(
          `Bridge '${operation}' not defined`,
          ToolBridge.BRIDGE_ERRORS.NO_BRIDGE_DEFINED.code,
          {
            category: 'DEVELOPMENT',
            solution: ToolBridge.BRIDGE_ERRORS.NO_BRIDGE_DEFINED.getSolution(null, { operation }),
            context: { operation, availableBridges: Object.keys(this.bridges) }
          }
        );
      }

      // 选择实现路径
      const implementation = this.mode === 'dryrun' ? bridge.mock : bridge.real;

      if (!implementation) {
        throw new ToolError(
          `No ${this.mode} implementation for bridge: ${operation}`,
          ToolBridge.BRIDGE_ERRORS.NO_IMPLEMENTATION.code,
          {
            category: 'DEVELOPMENT',
            solution: ToolBridge.BRIDGE_ERRORS.NO_IMPLEMENTATION.getSolution(null, {
              operation,
              mode: this.mode
            }),
            context: { operation, mode: this.mode }
          }
        );
      }

      // 执行并记录
      this.api.logger.debug(`[Bridge] ${this.mode}: ${operation}`, { args });

      const result = await implementation.call(this.toolInstance, args, this.api);
      this.api.logger.debug(`[Bridge] Success: ${operation}`);
      return result;

    } catch (error) {
      // 如果已经是ToolError，保持原样
      if (error instanceof ToolError) {
        throw error;
      }

      // 包装为ToolError，添加bridge上下文
      throw ToolError.from(error, {
        bridge: operation,
        mode: this.mode,
        args: args,
        // 传递工具的业务错误定义，用于错误分析
        businessErrors: this.getBridgeBusinessErrors(operation)
      });
    }
  }

  /**
   * 获取特定bridge的业务错误定义
   */
  getBridgeBusinessErrors(operation) {
    // 工具可以为每个bridge定义特定的业务错误
    if (typeof this.toolInstance.getBridgeErrors === 'function') {
      const allErrors = this.toolInstance.getBridgeErrors();
      return allErrors[operation] || [];
    }
    return [];
  }

  /**
   * 加载工具定义的bridges
   */
  loadBridges() {
    try {
      // 检查工具是否支持bridges
      if (typeof this.toolInstance.getBridges !== 'function') {
        this.bridges = {};
        this.api.logger.debug('[Bridge] Tool does not support bridges');
        return;
      }

      this.bridges = this.toolInstance.getBridges();

      // 验证bridge定义
      for (const [name, bridge] of Object.entries(this.bridges)) {
        this.validateBridge(name, bridge);
      }

      this.api.logger.info(`[Bridge] Loaded ${Object.keys(this.bridges).length} bridges`);

    } catch (error) {
      throw ToolError.from(error, {
        phase: 'bridge_loading',
        toolId: this.api.toolId
      });
    }
  }

  /**
   * 验证bridge定义
   */
  validateBridge(name, bridge) {
    if (!bridge || typeof bridge !== 'object') {
      throw new ToolError(
        `Bridge '${name}' must be an object`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION.code,
        {
          category: 'DEVELOPMENT',
          solution: `Bridge必须是包含real和/或mock函数的对象`,
          context: { bridgeName: name }
        }
      );
    }

    if (!bridge.real && !bridge.mock) {
      throw new ToolError(
        `Bridge '${name}' must have at least one implementation`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION.code,
        {
          category: 'DEVELOPMENT',
          solution: `Bridge必须至少包含real或mock实现之一`,
          context: { bridgeName: name }
        }
      );
    }

    if (bridge.real && typeof bridge.real !== 'function') {
      throw new ToolError(
        `Bridge '${name}' real implementation must be a function`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION.code,
        {
          category: 'DEVELOPMENT',
          solution: `real必须是异步函数: async (args, api) => {...}`,
          context: { bridgeName: name }
        }
      );
    }

    if (bridge.mock && typeof bridge.mock !== 'function') {
      throw new ToolError(
        `Bridge '${name}' mock implementation must be a function`,
        ToolBridge.BRIDGE_ERRORS.INVALID_BRIDGE_DEFINITION.code,
        {
          category: 'DEVELOPMENT',
          solution: `mock必须是异步函数: async (args, api) => {...}`,
          context: { bridgeName: name }
        }
      );
    }
  }

  /**
   * 设置执行模式
   */
  setMode(mode) {
    if (!['execute', 'dryrun'].includes(mode)) {
      throw new ToolError(
        `Invalid mode: ${mode}`,
        'INVALID_BRIDGE_MODE',
        {
          category: 'VALIDATION',
          solution: `Mode必须是 'execute' 或 'dryrun'`,
          context: { providedMode: mode }
        }
      );
    }

    const previousMode = this.mode;
    this.mode = mode;
    this.api.logger.info(`[Bridge] Mode changed from '${previousMode}' to '${mode}'`);
  }

  /**
   * 获取当前执行模式
   */
  getMode() {
    return this.mode;
  }

  /**
   * 检查是否处于dry-run模式
   */
  isDryRun() {
    return this.mode === 'dryrun';
  }

  /**
   * 执行dry-run测试
   */
  async dryRun(operation, mockArgs = {}) {
    const originalMode = this.mode;

    try {
      this.setMode('dryrun');
      const result = await this.execute(operation, mockArgs);
      return {
        success: true,
        operation,
        result
      };
    } catch (error) {
      return {
        success: false,
        operation,
        error: error instanceof ToolError ? error.toJSON() : {
          message: error.message,
          code: 'DRYRUN_FAILED'
        }
      };
    } finally {
      this.setMode(originalMode);
    }
  }

  /**
   * 批量dry-run所有bridges
   */
  async dryRunAll() {
    if (!this.bridges) {
      this.loadBridges();
    }

    const results = {};

    for (const operation of Object.keys(this.bridges)) {
      // 为每个bridge生成默认的mock参数
      const mockArgs = this.generateMockArgs(operation);
      results[operation] = await this.dryRun(operation, mockArgs);
    }

    const successCount = Object.values(results).filter(r => r.success).length;
    const totalCount = Object.keys(results).length;

    this.api.logger.info(`[Bridge] Dry-run completed: ${successCount}/${totalCount} passed`);

    return {
      summary: {
        total: totalCount,
        success: successCount,
        failed: totalCount - successCount
      },
      results
    };
  }

  /**
   * 生成mock参数（可被工具覆盖）
   */
  generateMockArgs(operation) {
    // 优先使用工具定义的mock参数
    if (typeof this.toolInstance.getMockArgs === 'function') {
      const toolMockArgs = this.toolInstance.getMockArgs(operation);
      if (toolMockArgs !== undefined) {
        return toolMockArgs;
      }
    }

    // 默认mock参数（基于常见模式）
    const defaults = {
      // 数据库相关
      'mysql:connect': { host: 'localhost', user: 'test', password: 'test', database: 'test' },
      'mysql:query': { sql: 'SELECT 1', values: [] },
      'postgres:connect': { host: 'localhost', user: 'test', password: 'test', database: 'test' },
      'mongodb:connect': { uri: 'mongodb://localhost:27017/test' },

      // HTTP相关
      'http:request': { url: 'https://example.com', method: 'GET' },
      'http:get': { url: 'https://example.com/api/test' },
      'http:post': { url: 'https://example.com/api/test', data: {} },

      // 文件系统相关
      'fs:read': { path: '/tmp/test.txt' },
      'fs:write': { path: '/tmp/test.txt', content: 'test' },

      // 消息队列相关
      'redis:connect': { host: 'localhost', port: 6379 },
      'rabbitmq:connect': { url: 'amqp://localhost' },

      // 云服务相关
      's3:upload': { bucket: 'test-bucket', key: 'test-key', body: 'test' },
      'email:send': { to: 'test@example.com', subject: 'Test', body: 'Test message' }
    };

    // 返回匹配的默认参数，如果没有则返回空对象
    return defaults[operation] || {};
  }

  /**
   * 获取所有已定义的bridge操作列表
   */
  getBridgeOperations() {
    if (!this.bridges) {
      this.loadBridges();
    }

    return Object.keys(this.bridges).map(operation => {
      const bridge = this.bridges[operation];
      return {
        operation,
        hasReal: !!bridge.real,
        hasMock: !!bridge.mock
      };
    });
  }
}

module.exports = ToolBridge;