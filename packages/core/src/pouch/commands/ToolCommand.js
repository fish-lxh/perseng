const BasePouchCommand = require('../BasePouchCommand')
const { getGlobalResourceManager } = require('../../resource')
const ToolSandbox = require('~/toolx/ToolSandbox')
const ToolManualFormatter = require('~/toolx/ToolManualFormatter')
const logger = require('@promptx/logger')

/**
 * Tool命令处理器
 * 实现toolx MCP工具，执行通过@tool协议声明的工具
 */
class ToolCommand extends BasePouchCommand {
  constructor() {
    super()
    this.resourceManager = null
  }

  /**
   * 获取或初始化ResourceManager
   */
  async getResourceManager() {
    if (!this.resourceManager) {
      this.resourceManager = getGlobalResourceManager()
      // 确保ResourceManager已初始化
      if (!this.resourceManager.initialized) {
        await this.resourceManager.initializeWithNewArchitecture()
      }
    }
    return this.resourceManager
  }

  // BasePouchCommand的抽象方法实现
  getPurpose() {
    return '执行通过@tool协议声明的JavaScript工具'
  }

  async getContent(args) {
    try {
      // 处理参数：如果是数组格式，需要转换为对象格式
      let toolArgs;
      logger.info('[ToolCommand] getContent 接收到的 args:', args);
      logger.info('[ToolCommand] args 类型:', Array.isArray(args) ? 'Array' : typeof args);
      
      if (Array.isArray(args)) {
        // 从CLI调用时，args是数组：[tool_resource, mode?, parameters?, ...options]
        logger.info('[ToolCommand] 数组参数长度:', args.length);
        logger.info('[ToolCommand] args[0]:', args[0]);
        
        toolArgs = {
          tool_resource: args[0]
        };
        
        // 解析mode和parameters
        if (args.length >= 2) {
          // 检查第二个参数是否是mode
          const validModes = ['execute', 'manual', 'configure', 'rebuild', 'log', 'dryrun'];
          if (validModes.includes(args[1])) {
            toolArgs.mode = args[1];
            // 如果有第三个参数，它是parameters
            if (args.length >= 3) {
              let parameters = args[2];
              if (typeof parameters === 'string') {
                try {
                  parameters = JSON.parse(parameters);
                } catch (e) {
                  // 保持原样
                }
              }
              toolArgs.parameters = parameters;
            }
          } else {
            // 第二个参数是parameters（默认execute模式）
            let parameters = args[1];
            if (typeof parameters === 'string') {
              try {
                parameters = JSON.parse(parameters);
              } catch (e) {
                // 保持原样
              }
            }
            toolArgs.parameters = parameters;
          }
        }
        
        // 提取timeout
        toolArgs.timeout = this.extractTimeout(args);
        logger.info('[ToolCommand] 构建的 toolArgs:', toolArgs);
      } else {
        // 从其他方式调用时，args已经是对象格式
        toolArgs = args;
        logger.info('[ToolCommand] 直接使用对象格式参数:', toolArgs);
      }
      
      // 执行工具调用
      const result = await this.executeToolInternal(toolArgs)
      
      // 根据mode格式化不同的响应
      if (result.success) {
        const mode = result.mode || 'execute'
        
        switch(mode) {
          case 'manual':
            return `📚 工具手册

📋 工具资源: ${result.tool_resource}

${result.result.manual}

⏱️ 加载时间: ${result.metadata.execution_time_ms}ms`
          
          case 'configure':
            if (result.result.action === 'get') {
              // 显示配置状态
              const vars = result.result.variables
              const summary = result.result.summary
              let output = `🔧 环境变量配置状态

📋 工具资源: ${result.tool_resource}
📁 配置文件: ${result.result.envPath}

📊 配置摘要:
- 总计: ${summary.total} 个变量
- 已配置: ${summary.configured} 个
- 必需: ${summary.required} 个
- 缺失: ${summary.missing} 个

📝 变量详情:
`
              for (const [key, info] of Object.entries(vars)) {
                const status = info.configured ? '✅' : (info.required ? '❌' : '⭕')
                const value = info.configured ? info.value : (info.default ? `默认: ${info.default}` : '未设置')
                output += `${status} ${key}: ${value}\n   ${info.description || ''}\n`
              }
              
              return output
            } else {
              // 设置/清除操作
              return `🔧 环境变量配置

📋 工具资源: ${result.tool_resource}
✅ 操作: ${result.result.action}
📝 结果: ${result.result.message}
${result.result.configured ? `📋 已配置: ${result.result.configured.join(', ')}` : ''}

⏱️ 执行时间: ${result.metadata.execution_time_ms}ms`
            }
          
          case 'dryrun':
            // dryrun模式的特殊输出
            const dryRunResult = result.result
            let output = `🧪 Tool Dry-Run 测试${dryRunResult.success ? '成功' : '失败'}

📋 工具资源: ${result.tool_resource}
🔬 模式: 干运行测试
`
            if (dryRunResult.success) {
              output += `✅ 执行结果:
${JSON.stringify(dryRunResult.result, null, 2)}
`
              // 如果有Bridge测试结果
              if (dryRunResult.bridgeTests) {
                const bridgeTests = dryRunResult.bridgeTests
                output += `
🌉 Bridge测试结果:
- 总计: ${bridgeTests.summary.total} 个Bridge
- 成功: ${bridgeTests.summary.success} 个
- 失败: ${bridgeTests.summary.failed} 个
`
                for (const [operation, testResult] of Object.entries(bridgeTests.results)) {
                  const status = testResult.success ? '✅' : '❌'
                  output += `  ${status} ${operation}\n`
                }
              }
            } else {
              output += `❌ 错误信息: ${dryRunResult.message}
📝 错误详情:
${JSON.stringify(dryRunResult.error, null, 2)}
`
            }
            output += `
⏱️ 执行时间: ${result.metadata.execution_time_ms}ms`
            return output

          case 'rebuild':
          case 'execute':
          default:
            // 检查工具内部执行状态
            const actualToolResult = result.result
            const isToolInternalSuccess = this.isToolInternalSuccess(actualToolResult)

            if (isToolInternalSuccess) {
              return `🔧 Tool${mode === 'rebuild' ? '重建并' : ''}执行成功

📋 工具资源: ${result.tool_resource}
${mode === 'rebuild' ? '♻️ 模式: 强制重建\n' : ''}📊 执行结果:
${JSON.stringify(actualToolResult, null, 2)}

⏱️ 性能指标:
- 执行时间: ${result.metadata.execution_time_ms}ms
- 时间戳: ${result.metadata.timestamp}`
            } else {
              const internalError = this.extractToolInternalError(actualToolResult)
              return this.formatToolInternalError(result.tool_resource, internalError, result.metadata)
            }
        }
      } else {
        // 渲染错误，根据错误类型显示不同信息
        return this.formatErrorOutput(result.error, result.tool_resource, result.metadata, result.mode);
      }
    } catch (error) {
      return `❌ Tool执行异常

错误详情: ${error.message}

💡 请检查:
1. 工具资源引用格式是否正确 (@tool://tool-name)
2. 工具参数是否有效
3. 工具文件是否存在并可执行`
    }
  }

  getPATEOAS(args) {
    return {
      currentState: 'tool_executed',
      nextActions: [
        {
          action: 'execute_another_tool',
          description: '执行其他工具',
          method: 'promptx tool'
        },
        {
          action: 'view_available_tools', 
          description: '查看可用工具',
          method: 'promptx discover'
        }
      ]
    }
  }

  /**
   * 内部工具执行方法 - 支持多种执行模式
   * @param {Object} args - 命令参数
   * @param {string} args.tool_resource - 工具资源引用，格式：@tool://tool-name
   * @param {string} args.mode - 执行模式：execute/manual/configure/rebuild（默认execute）
   * @param {Object} args.parameters - 传递给工具的参数（含义根据mode不同而不同）
   * @param {number} args.timeout - 工具执行超时时间（毫秒，默认30000ms）
   * @returns {Promise<Object>} 执行结果
   */
  async executeToolInternal(args) {
    const startTime = Date.now()
    
    try {
      logger.info('[ToolCommand] executeToolInternal 接收到的 args:', JSON.stringify(args, null, 2))
      
      // 1. 参数验证
      this.validateArguments(args)
      
      const { tool_resource, mode = 'execute', parameters = {}, timeout = 30000 } = args
      
      logger.info('[ToolCommand] 执行模式 mode:', mode)
      logger.debug(`[PersengTool] 开始执行工具: ${tool_resource}, 模式: ${mode}`)
      
      // 2. 根据mode分发到不同的处理方法
      switch(mode) {
        case 'execute':
          return await this.executeNormalMode(tool_resource, parameters, timeout, startTime)

        case 'manual':
          return await this.executeManualMode(tool_resource, startTime)

        case 'configure':
          return await this.executeConfigureMode(tool_resource, parameters, startTime)

        case 'rebuild':
          return await this.executeRebuildMode(tool_resource, parameters, timeout, startTime)

        case 'log':
          return await this.executeLogMode(tool_resource, parameters, startTime)

        case 'dryrun':
          return await this.executeDryRunMode(tool_resource, parameters, startTime)

        default:
          throw new Error(`Unsupported mode: ${mode}. Supported modes: execute, manual, configure, rebuild, log, dryrun`)
      }
      
    } catch (error) {
      // 格式化错误结果
      logger.error(`[PersengTool] 工具执行失败: ${error.message}`, error)
      return this.formatErrorResult(error, args.tool_resource, startTime)
    }
  }

  /**
   * Execute模式 - 正常执行工具
   */
  async executeNormalMode(tool_resource, parameters, timeout, startTime) {
    let sandbox = null
    
    try {
      // 创建沙箱
      sandbox = new ToolSandbox(tool_resource, { timeout })
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)
      
      // 三阶段执行
      logger.debug(`[PersengTool] Execute模式: Phase 1 - 分析工具`)
      const analysisResult = await sandbox.analyze()
      
      logger.debug(`[PersengTool] Execute模式: Phase 2 - 准备依赖`)
      await sandbox.prepareDependencies()
      
      logger.debug(`[PersengTool] Execute模式: Phase 3 - 执行工具`)
      const result = await sandbox.execute(parameters)
      
      return this.formatSuccessResult(result, tool_resource, startTime)
      
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * Manual模式 - 从工具接口自动生成手册
   */
  async executeManualMode(tool_resource, startTime) {
    let sandbox = null
    
    try {
      // 创建沙箱来分析工具
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)
      
      // 分析工具获取接口信息
      await sandbox.analyze()
      
      // 获取工具实例
      const toolInstance = sandbox.toolInstance
      if (!toolInstance) {
        throw new Error('Tool instance not found')
      }
      
      // 尝试获取工具源码（用于提取注释）
      let sourceCode = null
      try {
        const resourceResult = await resourceManager.loadResource(tool_resource)
        if (resourceResult.success && resourceResult.content) {
          sourceCode = resourceResult.content
        }
      } catch (e) {
        logger.debug(`[ToolCommand] Could not load source code for manual generation: ${e.message}`)
        // 没有源码也能生成基础手册，继续执行
      }
      
      // 使用新的 ToolManualFormatter 生成手册
      const formatter = new ToolManualFormatter()
      const formattedManual = formatter.format(toolInstance, tool_resource, sourceCode)
      
      return {
        success: true,
        tool_resource: tool_resource,
        mode: 'manual',
        result: {
          manual: formattedManual,
          toolId: sandbox.getAnalysisResult().toolId
        },
        metadata: {
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'ToolManualFormatter'
        }
      }
    } catch (error) {
      throw error
    } finally {
      // 清理沙箱
      if (sandbox) {
        try {
          await sandbox.cleanup()
        } catch (cleanupError) {
          logger.warn(`[PersengTool] 清理沙箱失败: ${cleanupError.message}`)
        }
      }
    }
  }

  /**
   * Configure模式 - 配置环境变量
   */
  async executeConfigureMode(tool_resource, parameters, startTime) {
    let sandbox = null
    
    try {
      // 创建沙箱（只需要analyze阶段）
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)
      
      // 只执行分析阶段获取toolId和路径
      logger.debug(`[PersengTool] Configure模式: 分析工具`)
      await sandbox.analyze()
      
      // 调用沙箱的配置方法
      const result = await sandbox.configureEnvironment(parameters)
      
      return {
        success: true,
        tool_resource: tool_resource,
        mode: 'configure',
        result: result,
        metadata: {
          execution_time_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      }
      
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * Rebuild模式 - 强制重建后执行
   */
  async executeRebuildMode(tool_resource, parameters, timeout, startTime) {
    let sandbox = null
    
    try {
      // 创建沙箱，设置rebuild标志
      sandbox = new ToolSandbox(tool_resource, { timeout, rebuild: true })
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)
      
      // 先清理旧沙箱
      logger.debug(`[PersengTool] Rebuild模式: 清理旧沙箱`)
      await sandbox.clearSandbox(true)  // true表示删除目录
      
      // 重新执行三阶段
      logger.debug(`[PersengTool] Rebuild模式: Phase 1 - 分析工具`)
      const analysisResult = await sandbox.analyze()
      
      logger.debug(`[PersengTool] Rebuild模式: Phase 2 - 准备依赖（强制重装）`)
      await sandbox.prepareDependencies()
      
      logger.debug(`[PersengTool] Rebuild模式: Phase 3 - 执行工具`)
      const result = await sandbox.execute(parameters)
      
      return this.formatSuccessResult(result, tool_resource, startTime)
      
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * Log模式 - 查询工具执行日志
   */
  async executeLogMode(tool_resource, parameters, startTime) {
    let sandbox = null

    try {
      // 创建沙箱（不需要执行，只需要查询日志）
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      // 只需要分析工具以获取toolId和sandboxPath
      logger.debug(`[PersengTool] Log模式: 分析工具以获取日志路径`)
      await sandbox.analyze()

      // 查询日志
      logger.debug(`[PersengTool] Log模式: 查询日志，参数:`, parameters)
      const result = await sandbox.queryLogs(parameters)

      return this.formatSuccessResult(result, tool_resource, startTime)

    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * DryRun模式 - 干运行测试工具
   */
  async executeDryRunMode(tool_resource, parameters, startTime) {
    let sandbox = null

    try {
      // 创建沙箱
      sandbox = new ToolSandbox(tool_resource)
      const resourceManager = await this.getResourceManager()
      sandbox.setResourceManager(resourceManager)

      // 分析工具
      logger.debug(`[PersengTool] DryRun模式: Phase 1 - 分析工具`)
      await sandbox.analyze()

      // 准备依赖（必须的，因为dryRun也需要加载依赖）
      logger.debug(`[PersengTool] DryRun模式: Phase 2 - 准备依赖`)
      await sandbox.prepareDependencies()

      // 执行dry-run测试
      logger.debug(`[PersengTool] DryRun模式: Phase 3 - 执行dry-run测试`)
      const result = await sandbox.dryRun(parameters)

      // dryRun的结果包含success字段，需要特殊处理
      if (result.success) {
        return {
          success: true,
          tool_resource: tool_resource,
          mode: 'dryrun',
          result: result,
          metadata: {
            executor: 'ToolSandbox',
            execution_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString(),
            version: '1.0.0'
          }
        }
      } else {
        // dryRun失败时返回的格式
        return {
          success: false,
          tool_resource: tool_resource,
          mode: 'dryrun',
          error: result.error,
          metadata: {
            executor: 'ToolSandbox',
            execution_time_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        }
      }

    } catch (error) {
      // 意外错误
      return this.formatErrorResult(error, tool_resource, startTime)
    } finally {
      if (sandbox) await sandbox.cleanup()
    }
  }

  /**
   * 验证命令参数
   * @param {Object} args - 命令参数
   */
  validateArguments(args) {
    if (!args) {
      throw new Error('Missing arguments')
    }

    if (!args.tool_resource) {
      throw new Error('Missing required parameter: tool_resource')
    }

    if (!args.tool_resource.startsWith('@tool://')) {
      throw new Error('Invalid tool_resource format. Must start with @tool://')
    }

    // mode参数验证
    if (args.mode) {
      const validModes = ['execute', 'manual', 'configure', 'rebuild', 'log', 'dryrun']
      if (!validModes.includes(args.mode)) {
        throw new Error(`Invalid mode: ${args.mode}. Valid modes are: ${validModes.join(', ')}`)
      }
    }

    // parameters验证根据mode不同而不同
    if (args.mode === 'execute' || args.mode === 'rebuild' || !args.mode) {
      // execute和rebuild模式需要parameters是对象
      if (args.parameters !== undefined && typeof args.parameters !== 'object') {
        throw new Error('Parameters must be an object for execute/rebuild mode')
      }
    }
    // manual模式不需要parameters
    // configure模式parameters可选（为空时查看配置）
  }

  /**
   * 格式化成功结果 - 适配ToolSandbox返回格式
   * @param {*} result - 工具执行结果
   * @param {string} toolResource - 工具资源引用
   * @param {number} startTime - 开始时间
   * @returns {Object} 格式化的成功结果
   */
  formatSuccessResult(result, toolResource, startTime) {
    const duration = Date.now() - startTime
    
    return {
      success: true,
      tool_resource: toolResource,
      result: result, // ToolSandbox直接返回工具结果
      metadata: {
        executor: 'ToolSandbox',
        execution_time_ms: duration,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      }
    }
  }

  /**
   * 格式化错误结果（简化版 - 奥卡姆剃刀原则）
   * @param {Error} error - 错误对象
   * @param {string} toolResource - 工具资源引用
   * @param {number} startTime - 开始时间
   * @returns {Object} 格式化的错误结果
   */
  formatErrorResult(error, toolResource, startTime) {
    const { ToolError } = require('~/toolx/errors')
    const duration = Date.now() - startTime
    
    // 统一转换为 ToolError（集成层统一处理）
    const toolError = error instanceof ToolError ? error : ToolError.from(error)
    
    return {
      success: false,
      tool_resource: toolResource || 'unknown',
      error: toolError.toMCPFormat(),
      metadata: {
        executor: 'ToolSandbox',
        execution_time_ms: duration,
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * 格式化错误输出（负责错误的最终渲染）
   * @param {Object} errorInfo - 错误信息（来自ToolError.toMCPFormat）
   * @param {string} toolResource - 工具资源
   * @param {Object} metadata - 元数据
   * @param {string} mode - 执行模式
   * @returns {string} 格式化的错误文本
   */
  formatErrorOutput(errorInfo, toolResource, metadata, mode = 'execute') {
    const { ToolError } = require('~/toolx/errors');
    
    // 根据错误类别展示不同信息
    const categoryInfo = ToolError.CATEGORIES[errorInfo.category];
    
    let output = `❌ Tool执行失败

📋 工具资源: ${toolResource}
🔧 模式: ${mode}
❌ 错误信息: ${errorInfo.message}
🔢 错误代码: ${errorInfo.code}`;

    // 如果有类别信息，显示类别
    if (categoryInfo) {
      output += `
${categoryInfo.emoji} 错误类型: ${categoryInfo.description}
📝 责任方: ${categoryInfo.responsibility}`;
    }
    
    // 如果是BusinessError，显示更多信息
    if (errorInfo.category === 'BUSINESS' && errorInfo.details?.businessError) {
      const be = errorInfo.details.businessError;
      if (be.description) {
        output += `
📄 错误描述: ${be.description}`;
      }
    }
    
    // 显示解决方案
    if (errorInfo.solution) {
      let solutionText = errorInfo.solution;
      
      // 如果solution是对象
      if (typeof errorInfo.solution === 'object') {
        solutionText = errorInfo.solution.message || errorInfo.solution.detail || JSON.stringify(errorInfo.solution);
      }
      
      output += `

💡 解决方案: ${solutionText}`;
    }
    
    // 显示是否可重试
    if (errorInfo.retryable) {
      output += `
🔄 可重试: 是`;
    }
    
    // 显示执行时间
    output += `

⏱️ 执行时间: ${metadata.execution_time_ms}ms`;
    
    return output;
  }



  /**
   * 生成执行ID
   * @returns {string} 唯一的执行ID
   */
  generateExecutionId() {
    return `tool_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 从参数数组中提取timeout值
   * @param {Array} args - 参数数组
   * @returns {number|undefined} timeout值
   */
  extractTimeout(args) {
    const timeoutIndex = args.indexOf('--timeout');
    if (timeoutIndex !== -1 && timeoutIndex < args.length - 1) {
      const timeout = parseInt(args[timeoutIndex + 1]);
      return isNaN(timeout) ? undefined : timeout;
    }
    return undefined;
  }


  /**
   * 检查工具内部执行是否成功
   * @param {*} toolResult - 工具返回的结果
   * @returns {boolean} 工具内部是否成功
   */
  isToolInternalSuccess(toolResult) {
    // 优先检查是否有data字段，这可能是ToolSandbox包装的结果
    if (toolResult && typeof toolResult === 'object' && toolResult.data) {
      // 如果data是对象且包含success字段，检查data的success
      if (typeof toolResult.data === 'object' && 'success' in toolResult.data) {
        return toolResult.data.success === true
      }
    }
    
    // 检查顶层success字段
    if (toolResult && typeof toolResult === 'object' && 'success' in toolResult) {
      return toolResult.success === true
    }
    
    // 如果工具返回结果不包含success字段，认为是成功的（兼容旧工具）
    return true
  }

  /**
   * 从工具内部结果中提取错误信息
   * @param {*} toolResult - 工具返回的结果
   * @returns {Object} 错误信息
   */
  extractToolInternalError(toolResult) {
    // 优先从data字段中提取错误信息
    if (toolResult && typeof toolResult === 'object' && toolResult.data && 
        typeof toolResult.data === 'object' && toolResult.data.error) {
      return {
        code: toolResult.data.error.code || 'TOOL_INTERNAL_ERROR',
        message: toolResult.data.error.message || '工具内部执行失败',
        details: toolResult.data.error.details || toolResult.data.error
      }
    }
    
    // 检查顶层错误信息
    if (toolResult && typeof toolResult === 'object' && toolResult.error) {
      return {
        code: toolResult.error.code || 'TOOL_INTERNAL_ERROR',
        message: toolResult.error.message || '工具内部执行失败',
        details: toolResult.error.details || toolResult.error
      }
    }
    
    return {
      code: 'TOOL_INTERNAL_ERROR',
      message: '工具内部执行失败，但未提供错误详情',
      details: JSON.stringify(toolResult)
    }
  }

  /**
   * 格式化工具内部错误
   * @param {string} toolResource - 工具资源
   * @param {Object} internalError - 内部错误信息
   * @param {Object} metadata - 元数据
   * @returns {string} 格式化的错误信息
   */
  formatToolInternalError(toolResource, internalError, metadata) {
    // 尝试应用智能错误分析
    const intelligentError = this.analyzeToolInternalError(internalError, toolResource)
    
    return `❌ Tool内部执行失败

📋 工具资源: ${toolResource}
❌ 错误信息: ${intelligentError.message}
🏷️ 错误类型: ${intelligentError.type}
🔢 错误代码: ${intelligentError.code}

💡 智能建议:
${intelligentError.suggestion}

⏱️ 执行时间: ${metadata.execution_time_ms}ms`
  }

  /**
   * 分析工具内部错误并提供智能建议
   * @param {Object} internalError - 内部错误
   * @param {string} toolResource - 工具资源
   * @returns {Object} 智能分析结果
   */
  analyzeToolInternalError(internalError, toolResource) {
    const message = internalError.message.toLowerCase()
    const details = internalError.details || ''
    
    // 依赖相关错误
    if (message.includes('is not a function') || message.includes('cannot find module')) {
      return {
        code: 'DEPENDENCY_ERROR',
        type: 'DEPENDENCY_USAGE_ERROR',
        message: internalError.message,
        suggestion: `🔧 依赖使用错误：
• 检查依赖的正确用法
• 确认依赖版本兼容性
• 可能需要使用 "rebuild": true 重建沙箱

💡 建议操作：
toolx ${toolResource} {"rebuild": true, ...其他参数}`
      }
    }
    
    // 参数验证错误
    if (message.includes('validation') || message.includes('parameter')) {
      return {
        code: 'PARAMETER_ERROR',
        type: 'PARAMETER_VALIDATION_ERROR', 
        message: internalError.message,
        suggestion: `📝 参数错误：
• 检查传入的参数格式和类型
• 确认必需参数是否缺失
• 参考工具的schema定义`
      }
    }
    
    // 网络或外部服务错误
    if (message.includes('timeout') || message.includes('network') || message.includes('fetch')) {
      return {
        code: 'NETWORK_ERROR',
        type: 'EXTERNAL_SERVICE_ERROR',
        message: internalError.message,
        suggestion: `🌐 网络服务错误：
• 检查网络连接状态
• 确认外部API服务可用性
• 稍后重试可能解决问题`
      }
    }
    
    // 默认分析
    return {
      code: internalError.code || 'TOOL_INTERNAL_ERROR',
      type: 'UNKNOWN_TOOL_ERROR',
      message: internalError.message,
      suggestion: `🔧 工具内部错误：
• 这可能是工具代码的逻辑问题
• 检查工具的实现是否正确
• 如果问题持续，请联系工具开发者

🐛 错误详情：
${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}`
    }
  }

  /**
   * 获取工具命令的元信息 - ToolSandbox版本
   * @returns {Object} 命令元信息
   */
  getMetadata() {
    return {
      name: 'toolx',
      description: '使用ToolSandbox执行通过@tool协议声明的工具',
      version: '2.0.0',
      author: 'Perseng Framework',
      executor: 'ToolSandbox',
      supports: {
        protocols: ['@tool://'],
        formats: ['.tool.js'],
        features: [
          'ToolSandbox沙箱执行',
          '自动依赖管理',
          '三阶段执行流程',
          'pnpm依赖安装',
          '参数验证',
          '错误处理',
          '执行监控',
          '资源清理'
        ]
      }
    }
  }
}

module.exports = ToolCommand