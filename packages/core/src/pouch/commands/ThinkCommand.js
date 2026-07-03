const BasePouchCommand = require('../BasePouchCommand')
const { getGlobalResourceManager } = require('../../resource')
const CognitionManager = require('../../cognition/CognitionManager')
const logger = require('@promptx/logger')

/**
 * 思考锦囊命令 - 基于认知心理学的思维链式推理
 * 使用 CognitionManager 进行递归深化的思考过程
 */
class ThinkCommand extends BasePouchCommand {
  constructor () {
    super()
    this.resourceManager = getGlobalResourceManager()
    this.cognitionManager = new CognitionManager(this.resourceManager)
  }

  getPurpose () {
    return 'AI主动深度思考，通过认知循环生成洞察和结论'
  }

  async getContent (args) {
    // 解析参数：role、thought对象
    const { role, thought } = this.parseArgs(args)

    if (!role || !thought) {
      return this.getUsageHelp()
    }

    try {
      logger.info('🤔 [ThinkCommand] Starting thinking process')
      logger.info(`🧠 [ThinkCommand] Role: ${role}, Pattern: ${thought.thinkingPattern || 'not specified'}`)
      
      // 处理 spreadActivationCues：如果是字符串，转换为数组
      if (thought.spreadActivationCues && typeof thought.spreadActivationCues === 'string') {
        thought.spreadActivationCues = thought.spreadActivationCues.split(' ').filter(cue => cue.trim() !== '');
      }
      
      // 验证必需字段
      if (!thought.goalEngram) {
        throw new Error('Thought 必须包含 goalEngram')
      }
      if (!thought.thinkingPattern) {
        throw new Error('Thought 必须包含 thinkingPattern')
      }
      if (!thought.spreadActivationCues || thought.spreadActivationCues.length === 0) {
        throw new Error('Thought 必须包含 spreadActivationCues')
      }
      
      // 使用 CognitionManager 进行思考
      const prompt = await this.cognitionManager.think(role, thought)

      logger.info(' [ThinkCommand] Thinking guidance generation completed')
      return this.formatThinkResponse(thought, prompt, role)
      
    } catch (error) {
      logger.error(` [ThinkCommand] Thinking failed: ${error.message}`)
      logger.error(` [ThinkCommand] Error stack:\n${error.stack}`)
      
      return `❌ 思考失败：${error.message}

📋 **错误堆栈**：
\`\`\`
${error.stack}
\`\`\`

💡 **可能的原因**：
- 角色ID不正确
- Thought 对象格式错误
- 缺少必需的字段（goalEngram、thinkingPattern、spreadActivationCues）
- 思维模式不存在

🔧 **建议操作**：
1. 确保 Thought 包含所有必需字段
2. 检查角色是否已激活
3. 验证思维模式名称是否正确`
    }
  }

  /**
   * 解析命令行参数
   */
  parseArgs(args) {
    let role = ''
    let thought = null
    
    // 第一个参数是role
    if (args.length > 0) {
      role = args[0]
    }
    
    // 第二个参数是JSON格式的thought对象
    if (args.length > 1) {
      try {
        thought = JSON.parse(args[1])
        if (typeof thought !== 'object') {
          throw new Error('thought必须是对象格式')
        }
      } catch (error) {
        logger.error(` [ThinkCommand] Failed to parse thought parameter: ${error.message}`)
        thought = null
      }
    }
    
    return { role, thought }
  }

  /**
   * 格式化思考响应
   */
  formatThinkResponse (thought, prompt, role) {
    const hasInsights = thought.insightEngrams && thought.insightEngrams.length > 0
    const hasConclusion = !!thought.conclusionEngram
    const hasConfidence = thought.confidence !== undefined
    
    let status = '初始思考'
    if (hasConfidence) {
      status = '完整思考'
    } else if (hasConclusion) {
      status = '形成结论'
    } else if (hasInsights) {
      status = '产生洞察'
    }
    
    return `🧠 思考指导已生成

## 📊 当前思考状态
- **角色**: ${role}
- **状态**: ${status}
- **目标**: ${thought.goalEngram.content}
- **思维模式**: ${thought.thinkingPattern}
- **激活线索**: ${thought.spreadActivationCues.join(', ')}

## 💭 生成的思考指导
${prompt}

## 📊 当前进展
${hasInsights ? `- **洞察数量**: ${thought.insightEngrams.length}` : '- **洞察**: 尚未生成'}
${hasConclusion ? `- **已形成结论**: ${thought.conclusionEngram.content}` : '- **结论**: 尚未形成'}
${hasConfidence ? `- **置信度**: ${thought.confidence}` : '- **置信度**: 尚未评估'}

## 🔄 思考深化建议
${this.getDeepingAdvice(thought)}`
  }

  /**
   * 获取思考深化建议
   */
  getDeepingAdvice(thought) {
    const hasInsights = thought.insightEngrams && thought.insightEngrams.length > 0
    const hasConclusion = !!thought.conclusionEngram
    const hasConfidence = thought.confidence !== undefined
    
    if (!hasInsights) {
      return '- 基于检索到的记忆，生成关键洞察'
    } else if (!hasConclusion) {
      return '- 综合洞察形成明确结论'
    } else if (!hasConfidence) {
      return '- 评估结论的置信度'
    } else {
      return '- 思考已完整，可以开始新的思考目标'
    }
  }

  /**
   * 获取使用帮助
   */
  getUsageHelp () {
    return `🤔 **Think锦囊 - AI深度思考系统**

## 📖 基本用法
think 角色ID '{"goalEngram": {...}, "thinkingPattern": "...", "spreadActivationCues": [...]}'

## 🎯 必填参数
- **角色ID**: 进行思考的角色ID
- **thought对象**: JSON格式的Thought对象，必须包含：
  - **goalEngram**: 思考目标
  - **thinkingPattern**: 思维模式
  - **spreadActivationCues**: 激活线索

## 💭 Thought 结构
\`\`\`json
{
  "goalEngram": {
    "content": "推理天空呈现蓝色的光学原理",
    "schema": "自然现象\\n  光学现象\\n    大气散射"
  },
  "thinkingPattern": "reasoning",
  "spreadActivationCues": ["光学", "大气", "散射", "颜色"],
  "insightEngrams": [...],     // 可选
  "conclusionEngram": {...},    // 可选
  "confidence": 0.95           // 可选
}
\`\`\`

## 📋 使用示例
\`\`\`bash
# 第一次思考
think scientist '{"goalEngram": {"content": "推理天空蓝色原理", "schema": "物理学\\n  光学"}, "thinkingPattern": "reasoning", "spreadActivationCues": ["光学", "大气"]}'

# 深入思考
think scientist '{"goalEngram": {...}, "thinkingPattern": "reasoning", "spreadActivationCues": [...], "insightEngrams": [...]}'

# 使用创造性思维
think writer '{"goalEngram": {...}, "thinkingPattern": "creative", "spreadActivationCues": [...]}'
\`\`\`

## 🧠 思维模式
- **reasoning**: 推理思维（逻辑分析）
- **creative**: 创造性思维 [未实现]
- **critical**: 批判性思维 [未实现]
- **systematic**: 系统性思维 [未实现]
- **narrative**: 叙事思维 [未实现]
- **intuitive**: 直觉思维 [未实现]
- **analytical**: 分析思维 [未实现]
- **experiential**: 经验思维 [未实现]

## 🔍 配套工具
- **激活角色**: action 工具激活角色并启动语义网络
- **检索记忆**: recall 工具为思考提供记忆支持
- **保存洞察**: remember 工具保存重要的思考成果`
  }

  /**
   * 获取PATEOAS导航信息
   */
  getPATEOAS (args) {
    const hasThought = args.length >= 2

    if (!hasThought) {
      return {
        currentState: 'think_awaiting_input',
        availableTransitions: ['action', 'discover'],
        nextActions: [
          {
            name: '激活角色',
            description: '选择并激活思考角色',
            method: 'MCP Perseng action 工具',
            priority: 'high'
          },
          {
            name: '查看角色',
            description: '查看可用角色列表',
            method: 'MCP Perseng discover 工具',
            priority: 'medium'
          }
        ]
      }
    }

    return {
      currentState: 'thinking_in_progress',
      availableTransitions: ['think', 'remember', 'recall'],
      nextActions: [
        {
          name: '继续思考',
          description: '基于生成的prompt继续深化思考',
          method: 'MCP Perseng think 工具',
          priority: 'high'
        },
        {
          name: '保存洞察',
          description: '将重要洞察保存为记忆',
          method: 'MCP Perseng remember 工具',
          priority: 'medium'
        },
        {
          name: '检索记忆',
          description: '检索相关记忆支持思考',
          method: 'MCP Perseng recall 工具',
          priority: 'medium'
        }
      ],
      metadata: {
        thinkingRole: args[0],
        thinkingDepth: this.getThinkingDepth(args[1]),
        timestamp: new Date().toISOString(),
        systemVersion: '锦囊串联状态机 v1.0'
      }
    }
  }

  /**
   * 分析思考深度
   */
  getThinkingDepth(thoughtStr) {
    try {
      const thought = JSON.parse(thoughtStr)
      if (thought.confidence !== undefined) return 'complete'
      if (thought.conclusionEngram) return 'conclusion'
      if (thought.insightEngrams && thought.insightEngrams.length > 0) return 'insights'
      return 'initial'
    } catch {
      return 'unknown'
    }
  }
}

module.exports = ThinkCommand