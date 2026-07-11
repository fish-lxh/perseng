/**
 * 智能学习锦囊命令
 * 支持加载thought、execution、memory等协议资源，以及角色的personality、principle、knowledge
 * 支持语义占位符渲染，将@引用展开为完整的语义内容
 *
 * P0 step 0B.4.3: 迁 .js → .ts. BasePouchCommand 已 .ts;
 * resource/ / dpml/ / project/ProjectManager / ~/constants 仍 .js, 走 const+require.
 */

import { BasePouchCommand } from '../BasePouchCommand.js'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalResourceManager } = require('../../resource') as {
  getGlobalResourceManager(): ResourceManagerLike
}
// KNUTH-FIX 2026-07-09: 走具名导出。tsup CJS interop 把模块包成
// { __esModule: true, DPMLContentParser: class }，原代码 `new require(...)` 会报
// "DPMLContentParser2 is not a constructor"。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DPMLContentParser = (require('../../dpml/DPMLContentParser') as { DPMLContentParser: new () => DPMLParserLike })
  .DPMLContentParser
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SemanticRenderer = (require('../../dpml/SemanticRenderer') as { SemanticRenderer: new () => SemanticRendererLike })
  .SemanticRenderer
// KNUTH-FEAT 2026-07-11: Phase 3 cast 清理 — ProjectManager 真实 .d.ts 已生成, require() 直接出类型。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectManager = require('~/project/ProjectManager')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getGlobalProjectManager } = require('~/project/ProjectManager')

/** ResourceManager 鸭子类型 */
interface ResourceManagerLike {
  resolve(url: string): Promise<{
    success: boolean
    content?: string
    error?: { message: string }
  }>
  [key: string]: unknown
}

/** DPMLContentParser 鸭子类型 */
interface DPMLParserLike {
  parseTagContent(content: string, protocol: string): unknown
  [key: string]: unknown
}

/** SemanticRenderer 鸭子类型 */
interface SemanticRendererLike {
  renderSemanticContent(content: unknown, resourceManager: ResourceManagerLike): Promise<string>
  [key: string]: unknown
}

/** ProjectManager 鸭子类型 */
interface ProjectManagerLike {
  getCurrentMcpId(): string
  getIdeType(mcpId: string): Promise<string>
  generateTopLevelProjectPrompt(command: string, mcpId: string, ideType: string): Promise<string>
  [key: string]: unknown
}

/** PATEOAS action 项 */
interface PateoasAction {
  name: string
  description: string
  method: string
  priority: 'high' | 'medium' | 'low'
}

/** PATEOAS 导航 */
interface PateoasNavigation {
  currentState: string
  availableTransitions: string[]
  nextActions: PateoasAction[]
  metadata?: Record<string, unknown>
}

export class LearnCommand extends BasePouchCommand {
  private resourceManager: ResourceManagerLike
  private dpmlParser: DPMLParserLike
  private semanticRenderer: SemanticRendererLike
  private projectManager: ProjectManagerLike

  constructor() {
    super()
    // 使用全局单例 ResourceManager
    this.resourceManager = getGlobalResourceManager()
    this.dpmlParser = new DPMLContentParser()
    this.semanticRenderer = new SemanticRenderer()
    this.projectManager = getGlobalProjectManager()
  }

  getPurpose(): string {
    return '智能学习指定协议的资源内容，支持thought、execution、memory、manual等协议以及角色组件，支持@引用的语义渲染'
  }

  /**
   * 学习指定资源并返回结果
   */
  async getContent(args: unknown[] = []): Promise<string> {
    const [resourceUrl] = args as [string?]

    if (!resourceUrl) {
      return this.getUsageHelp()
    }

    // 复用ActionCommand的成功资源加载逻辑
    return await this.loadLearnContentUsingActionLogic(resourceUrl)
  }

  /**
   * 使用ActionCommand的成功逻辑加载学习内容
   */
  async loadLearnContentUsingActionLogic(resourceUrl: string): Promise<string> {
    try {
      const result = await this.resourceManager.resolve(resourceUrl)

      if (!result.success) {
        return this.formatErrorResponse(resourceUrl, result.error?.message ?? 'unknown error')
      }

      // 解析协议信息
      const urlMatch = resourceUrl.match(/^(@[!?]?)?([a-zA-Z][a-zA-Z0-9_-]*):\/\/(.+)$/)
      if (!urlMatch) {
        return this.formatErrorResponse(resourceUrl, '无效的资源URL格式')
      }

      const [, , protocol, resourceId] = urlMatch
      const protocolStr = protocol ?? ''

      // 检查内容是否包含@引用，如果包含则进行语义渲染
      let finalContent = result.content ?? ''

      // 对于manual协议，不进行语义渲染，保持原始内容
      if (protocolStr !== 'manual' && this.containsReferences(result.content ?? '')) {
        // 对于完整的DPML标签（如<execution>...</execution>），提取标签内容进行渲染
        const innerContent = this.extractTagInnerContent(result.content ?? '', protocolStr)

        if (innerContent) {
          // 解析标签内的混合内容（@引用 + 直接内容）
          const tagSemantics = this.dpmlParser.parseTagContent(innerContent, protocolStr)

          // 使用SemanticRenderer进行语义占位符渲染
          const renderedInnerContent = await this.semanticRenderer.renderSemanticContent(
            tagSemantics,
            this.resourceManager,
          )

          // 如果渲染成功，重新包装为完整的DPML标签
          if (renderedInnerContent && renderedInnerContent.trim()) {
            finalContent = `<${protocolStr}>\n${renderedInnerContent}\n</${protocolStr}>`
          }
        }
      }

      return await this.formatSuccessResponse(protocolStr, resourceId ?? '', finalContent)
    } catch (error) {
      return this.formatErrorResponse(resourceUrl, (error as Error).message)
    }
  }

  /**
   * 检查内容是否包含@引用
   */
  containsReferences(content: string): boolean {
    const resourceRegex = /@([!?]?)([a-zA-Z][a-zA-Z0-9_-]*):\/\/([a-zA-Z0-9_\/.,-]+)/g
    return resourceRegex.test(content)
  }

  /**
   * 提取完整的DPML标签内容
   */
  extractTagInnerContent(content: string, protocol: string): string | null {
    const tagRegex = new RegExp(`<${protocol}>([\\s\\S]*?)<\\/${protocol}>`, 'i')
    const match = content.match(tagRegex)
    return match ? (match[1] ?? '').trim() : null
  }

  /**
   * 格式化成功响应
   */
  async formatSuccessResponse(protocol: string, resourceId: string, content: string): Promise<string> {
    const protocolLabels: Record<string, string> = {
      thought: '🧠 思维模式',
      execution: '⚡ 执行模式',
      memory: '💾 记忆模式',
      personality: '👤 角色人格',
      principle: '⚖️ 行为原则',
      knowledge: '📚 专业知识',
      manual: '📖 工具手册',
      tool: '🔧 工具代码',
    }

    const label = protocolLabels[protocol] || `📄 ${protocol}`

    return `✅ **成功学习${label}：${resourceId}**

## 📋 学习内容

${content}

## 🎯 学习效果
- ✅ **已激活${label}能力**
- ✅ **相关知识已整合到AI认知体系**
- ✅ **可立即应用于实际场景**`
  }

  /**
   * 格式化错误响应
   */
  formatErrorResponse(resourceUrl: string, errorMessage: string): string {
    return `❌ 学习资源失败：${resourceUrl}

🔍 错误详情：
${errorMessage}

💡 支持的协议：
- \`thought://resource-id\` - 学习思维模式
- \`execution://resource-id\` - 学习执行模式
- \`memory://resource-id\` - 学习记忆模式
- \`personality://role-id\` - 学习角色思维
- \`principle://role-id\` - 学习角色原则
- \`knowledge://role-id\` - 学习角色知识
- \`manual://tool-name\` - 学习工具手册
- \`tool://tool-name\` - 学习工具代码

🔍 查看可用资源：
使用 MCP Perseng action 工具查看角色的所有依赖`
  }

  /**
   * 获取使用帮助
   */
  getUsageHelp(): string {
    return `🎓 **Learn锦囊 - 智能学习系统**

## 📖 基本用法
通过 MCP Perseng learn 工具学习资源：
\`<protocol>://<resource-id>\`

## 🎯 支持的协议

### 🔧 DPML核心协议
- **\`thought://\`** - 思维模式资源
- **\`execution://\`** - 执行模式资源
- **\`memory://\`** - 记忆系统资源

### 👤 角色组件协议
- **\`personality://\`** - 角色人格特征
- **\`principle://\`** - 行为原则
- **\`knowledge://\`** - 专业知识

## 📝 使用示例
通过 MCP Perseng learn 工具学习各种资源：
- 学习执行技能: \`execution://deal-at-reference\`
- 学习思维模式: \`thought://prompt-developer\`
- 学习角色人格: \`personality://video-copywriter\`

## 🔍 发现可学习资源
- 使用 MCP Perseng action 工具查看角色需要的所有资源
- 使用 MCP Perseng discover 工具查看可用角色列表`
  }

  /**
   * 获取PATEOAS导航信息
   */
  getPATEOAS(args: unknown[] = []): PateoasNavigation {
    const [resourceUrl] = args as [string?]

    if (!resourceUrl) {
      return {
        currentState: 'learn_awaiting_resource',
        availableTransitions: ['discover', 'action'],
        nextActions: [
          {
            name: '查看可用角色',
            description: '返回角色选择页面',
            method: 'MCP Perseng discover 工具',
            priority: 'high',
          },
          {
            name: '生成学习计划',
            description: '为特定角色生成学习计划',
            method: 'MCP Perseng action 工具',
            priority: 'high',
          },
        ],
      }
    }

    const urlMatch = resourceUrl.match(/^([a-zA-Z]+):\/\/(.+)$/)
    if (!urlMatch) {
      return {
        currentState: 'learn_error',
        availableTransitions: ['discover', 'action'],
        nextActions: [
          {
            name: '查看使用帮助',
            description: '重新学习命令使用方法',
            method: 'MCP Perseng learn 工具',
            priority: 'high',
          },
        ],
      }
    }

    const [, protocol, resourceId] = urlMatch

    return {
      currentState: `learned_${protocol ?? ''}`,
      availableTransitions: ['learn', 'recall', 'discover', 'action'],
      nextActions: [
        {
          name: '继续学习',
          description: '学习其他资源',
          method: 'MCP Perseng learn 工具',
          priority: 'medium',
        },
        {
          name: '应用记忆',
          description: '检索相关经验',
          method: 'MCP Perseng recall 工具',
          priority: 'medium',
        },
        {
          name: '激活角色',
          description: '激活完整角色能力',
          method: 'MCP Perseng action 工具',
          priority: 'high',
        },
        {
          name: '查看角色列表',
          description: '选择其他角色',
          method: 'MCP Perseng welcome 工具',
          priority: 'low',
        },
      ],
      metadata: {
        learnedResource: resourceUrl,
        protocol: protocol ?? '',
        resourceId: resourceId ?? '',
        systemVersion: '锦囊串联状态机 v1.0',
      },
    }
  }

  /**
   * 重写execute方法以添加多项目状态检查
   */
  async execute(args: unknown[] = []): Promise<unknown> {
    // 从执行上下文获取MCP信息
    const mcpId = this.detectMcpId()
    const ideType = await this.detectIdeType()

    // 获取多项目状态提示
    const projectPrompt = await this.projectManager.generateTopLevelProjectPrompt('learn', mcpId, ideType)

    const purpose = this.getPurpose()
    const content = await this.getContent(args)
    const pateoas = this.getPATEOAS(args)

    return this.formatOutputWithProjectCheck(purpose, content, pateoas, projectPrompt)
  }

  /**
   * 检测MCP进程ID
   */
  detectMcpId(): string {
    return ProjectManager.getCurrentMcpId()
  }

  /**
   * 检测IDE类型 - 从配置文件读取，移除环境变量检测
   */
  async detectIdeType(): Promise<string> {
    const mcpId = this.detectMcpId()
    return await this.projectManager.getIdeType(mcpId)
  }

  /**
   * 格式化带有项目检查的输出
   */
  formatOutputWithProjectCheck(
    purpose: string,
    content: string,
    pateoas: PateoasNavigation,
    projectPrompt: string,
  ): unknown {
    const output = {
      purpose,
      content,
      pateoas,
      context: this.context,
      format: this.outputFormat,
      projectPrompt,
    }

    if (this.outputFormat === 'json') {
      return output
    }

    // 人类可读格式
    return {
      ...output,
      toString() {
        const divider = '='.repeat(60)

        return `${projectPrompt}

${divider}
🎯 锦囊目的：${purpose}
${divider}

📜 锦囊内容：
${content}

📍 当前状态：${pateoas.currentState}
${divider}
`
      },
    }
  }
}

export default LearnCommand
