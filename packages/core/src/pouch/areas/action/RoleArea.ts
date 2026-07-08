/**
 * RoleArea - 角色定义区域
 * 负责渲染角色相关内容：人格特征、行为原则、专业知识
 *
 * P0 step 0B.4.2: 迁 .js → .ts.
 * semanticRenderer / resourceManager 是 dpml + resource 模块依赖（仍 .js）,
 * 这里用鸭子类型描述契约，避免硬依赖具体类型。
 */

import { BaseArea } from '../BaseArea.js'

/** 角色语义的字段（personality/principle/knowledge 是 DPMLDocument） */
export interface RoleSemantics {
  personality?: unknown
  principle?: unknown
  knowledge?: unknown
  [key: string]: unknown
}

/** SemanticRenderer 鸭子类型（仅 renderSemanticContent 契约） */
export interface SemanticRendererLike {
  renderSemanticContent(content: unknown, resourceManager: ResourceManagerLike): Promise<string>
}

/** ResourceManager 鸭子类型 */
export interface ResourceManagerLike {
  [key: string]: unknown
}

/** sectionFilter 取值 */
export type SectionFilter = 'personality' | 'principle' | 'knowledge' | 'all' | undefined

export class RoleArea extends BaseArea {
  private roleId: string
  private roleName: string
  private roleSemantics: RoleSemantics
  private semanticRenderer: SemanticRendererLike
  private resourceManager: ResourceManagerLike
  private thoughts: unknown[]
  private executions: unknown[]
  private sectionFilter: SectionFilter

  constructor(
    roleId: string,
    roleSemantics: RoleSemantics,
    semanticRenderer: SemanticRendererLike,
    resourceManager: ResourceManagerLike,
    thoughts: unknown[] = [],
    executions: unknown[] = [],
    roleName?: string,
    sectionFilter?: SectionFilter,
  ) {
    super('ROLE_AREA')
    this.roleId = roleId
    this.roleName = roleName || roleId
    this.roleSemantics = roleSemantics
    this.semanticRenderer = semanticRenderer
    this.resourceManager = resourceManager
    this.thoughts = thoughts || []
    this.executions = executions || []
    // Default (undefined): personality only
    this.sectionFilter = sectionFilter
  }

  /**
   * 渲染角色区域内容
   */
  async render(): Promise<string> {
    let content = ''

    const filter = this.sectionFilter
    const loadPersonality = !filter || filter === 'personality' || filter === 'all'
    const loadPrinciple = filter === 'principle' || filter === 'all'
    const loadKnowledge = filter === 'knowledge' || filter === 'all'

    // 角色激活标题
    const loaded: string[] = []
    if (loadPersonality) loaded.push('人格特征')
    if (loadPrinciple) loaded.push('行为原则')
    if (loadKnowledge) loaded.push('专业知识')
    content += `🎭 **角色激活：\`${this.roleId}\` (${this.roleName})** - 已加载：${loaded.join('、')}\n`

    // 提示可按需加载的部分
    const hints: string[] = []
    const semanticsAny = this.roleSemantics as unknown as Record<string, unknown>
    if (!loadPrinciple && semanticsAny.principle) {
      hints.push('执行工具或任务前，先加载「行为原则」获取工作流和方法论：roleResources: "principle"')
    }
    if (!loadKnowledge && semanticsAny.knowledge) {
      hints.push('遇到不确定的专业问题时，先加载「专业知识」获取领域知识：roleResources: "knowledge"')
    }
    if (hints.length > 0) {
      content += `💡 按需加载提示：\n`
      for (const hint of hints) {
        content += `  - ${hint}\n`
      }
    }
    content += '\n'

    // 1. 人格特征
    if (loadPersonality) {
      const personalityContent = await this.renderPersonality()
      if (personalityContent) {
        content += personalityContent + '\n'
      }
    }

    // 2. 行为原则
    if (loadPrinciple) {
      const principleContent = await this.renderPrinciple()
      if (principleContent) {
        content += principleContent + '\n'
      }
    }

    // 3. 专业知识
    if (loadKnowledge) {
      const knowledgeContent = await this.renderKnowledge()
      if (knowledgeContent) {
        content += knowledgeContent + '\n'
      }
    }

    // 4. 激活总结
    content += this.renderSummary()

    return content
  }

  /**
   * 渲染人格特征
   */
  private async renderPersonality(): Promise<string> {
    const semanticsAny = this.roleSemantics as unknown as Record<string, unknown>
    if (!semanticsAny.personality) {
      return ''
    }

    let content = '# 👤 角色人格特征\n'

    const rendered = await this.semanticRenderer.renderSemanticContent(
      semanticsAny.personality,
      this.resourceManager,
    )
    content += rendered

    // 添加思维资源
    if (this.thoughts.length > 0) {
      content += '\n---\n'
      for (const thought of this.thoughts) {
        const thoughtContent = await this.semanticRenderer.renderSemanticContent(
          thought,
          this.resourceManager,
        )
        if (thoughtContent) {
          content += thoughtContent + '\n'
        }
      }
    }

    return content
  }

  /**
   * 渲染行为原则
   */
  private async renderPrinciple(): Promise<string> {
    const semanticsAny = this.roleSemantics as unknown as Record<string, unknown>
    if (!semanticsAny.principle) {
      return ''
    }

    let content = '# ⚖️ 角色行为原则\n'

    const rendered = await this.semanticRenderer.renderSemanticContent(
      semanticsAny.principle,
      this.resourceManager,
    )
    content += rendered

    // 添加执行资源
    if (this.executions.length > 0) {
      content += '\n---\n'
      for (const execution of this.executions) {
        const execContent = await this.semanticRenderer.renderSemanticContent(
          execution,
          this.resourceManager,
        )
        if (execContent) {
          content += execContent + '\n'
        }
      }
    }

    return content
  }

  /**
   * 渲染专业知识
   */
  private async renderKnowledge(): Promise<string> {
    const semanticsAny = this.roleSemantics as unknown as Record<string, unknown>
    if (!semanticsAny.knowledge) {
      return ''
    }

    let content = '# 📚 专业知识体系\n'

    const rendered = await this.semanticRenderer.renderSemanticContent(
      semanticsAny.knowledge,
      this.resourceManager,
    )
    content += rendered

    return content
  }

  /**
   * 渲染激活总结
   */
  private renderSummary(): string {
    const filter = this.sectionFilter
    const loadPersonality = !filter || filter === 'personality' || filter === 'all'
    const loadPrinciple = filter === 'principle' || filter === 'all'
    const loadKnowledge = filter === 'knowledge' || filter === 'all'

    const semanticsAny = this.roleSemantics as unknown as Record<string, unknown>

    let content = '---\n'
    content += '# 🎯 角色激活总结\n'
    content += `✅ **\`${this.roleId}\` 角色已激活**\n`
    content += '📋 **已加载能力**：\n'

    const components: string[] = []
    if (loadPersonality && semanticsAny.personality) components.push('👤 人格特征')
    if (loadPrinciple && semanticsAny.principle) components.push('⚖️ 行为原则')
    if (loadKnowledge && semanticsAny.knowledge) components.push('📚 专业知识')

    content += `- 🎭 角色组件：${components.join(', ')}\n`

    if (this.thoughts.length > 0) {
      content += `- 🧠 思维模式：${this.thoughts.length}个专业思维模式已加载\n`
    }

    if (this.executions.length > 0) {
      content += `- ⚡ 执行技能：${this.executions.length}个执行技能已激活\n`
    }

    content += `💡 **现在可以立即开始以 \`${this.roleId}\` 身份提供专业服务！**\n`

    return content
  }
}

export default RoleArea
