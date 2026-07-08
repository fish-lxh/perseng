/**
 * DPML内容解析器
 * 统一处理DPML标签内的混合内容（@引用 + 直接内容）
 * 确保标签语义完整性
 */

export type DPMLContentType = 'empty' | 'mixed' | 'references-only' | 'direct-only'

export interface DPMLReference {
  fullMatch: string
  priority: string
  protocol: string
  resource: string
  isRequired: boolean
  isOptional: boolean
  /** Only present in references returned from {@link DPMLContentParser.extractReferencesWithPosition}. */
  position?: number
}

export interface DPMLMetadata {
  tagName: string
  hasReferences: boolean
  hasDirectContent: boolean
  contentType: DPMLContentType
}

export interface DPMLTagSemantics {
  /** 完整语义内容（用户看到的最终效果） */
  fullSemantics: string
  /** 引用部分（需要解析和加载的资源） */
  references: DPMLReference[]
  /** 直接部分（用户原创内容） */
  directContent: string
  /** 元数据 */
  metadata: DPMLMetadata
}

export class DPMLContentParser {
  /**
   * 解析DPML标签的完整语义内容
   * @param content - 标签内的原始内容
   * @param tagName - 标签名称
   * @returns 完整的语义结构
   */
  parseTagContent(content: string, tagName: string): DPMLTagSemantics {
    if (!content || !content.trim()) {
      return {
        fullSemantics: '',
        references: [],
        directContent: '',
        metadata: {
          tagName,
          hasReferences: false,
          hasDirectContent: false,
          contentType: 'empty',
        },
      }
    }

    const cleanContent = content.trim()
    const references = this.extractReferencesWithPosition(cleanContent)
    const directContent = this.extractDirectContent(cleanContent)

    return {
      fullSemantics: cleanContent,
      references,
      directContent,
      metadata: {
        tagName,
        hasReferences: references.length > 0,
        hasDirectContent: directContent.length > 0,
        contentType: this.determineContentType(cleanContent),
      },
    }
  }

  /**
   * 提取所有@引用
   * @param content - 内容
   * @returns 引用数组
   */
  extractReferences(content: string): DPMLReference[] {
    // 使用新的位置信息方法，但保持向下兼容
    return this.extractReferencesWithPosition(content).map((ref) => ({
      fullMatch: ref.fullMatch,
      priority: ref.priority,
      protocol: ref.protocol,
      resource: ref.resource,
      isRequired: ref.isRequired,
      isOptional: ref.isOptional,
    }))
  }

  /**
   * 获取引用的位置信息
   * @param content - 内容
   * @returns 包含位置信息的引用数组
   */
  extractReferencesWithPosition(content: string): DPMLReference[] {
    if (!content) {
      return []
    }

    const resourceRegex = /@([!?]?)([a-zA-Z][a-zA-Z0-9_-]*):\/\/([a-zA-Z0-9_\/.,-]+?)(?=[\s\)\],]|$)/g
    const matches: DPMLReference[] = []
    let match: RegExpExecArray | null

    while ((match = resourceRegex.exec(content)) !== null) {
      matches.push({
        fullMatch: match[0],
        priority: match[1] ?? '',
        protocol: match[2] ?? '',
        resource: match[3] ?? '',
        position: match.index,
        isRequired: match[1] === '!',
        isOptional: match[1] === '?',
      })
    }

    return matches.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }

  /**
   * 提取直接内容（移除@引用后的剩余内容）
   * @param content - 内容
   * @returns 直接内容
   */
  extractDirectContent(content: string): string {
    const withoutReferences = content.replace(/^.*@[!?]?[a-zA-Z][a-zA-Z0-9_-]*:\/\/.*$/gm, '')
    const cleaned = withoutReferences.replace(/\n{3,}/g, '\n\n').trim()
    return cleaned
  }

  /**
   * 检查是否包含引用
   * @param content - 内容
   */
  hasReferences(content: string): boolean {
    return /@[!?]?[a-zA-Z][a-zA-Z0-9_-]*:\/\//.test(content)
  }

  /**
   * 检查是否包含直接内容
   * @param content - 内容
   */
  hasDirectContent(content: string): boolean {
    const withoutReferences = this.extractDirectContent(content)
    return withoutReferences.length > 0
  }

  /**
   * 确定内容类型
   * @param content - 内容
   */
  determineContentType(content: string): DPMLContentType {
    const hasRefs = this.hasReferences(content)
    const hasDirect = this.hasDirectContent(content)

    if (hasRefs && hasDirect) return 'mixed'
    if (hasRefs) return 'references-only'
    if (hasDirect) return 'direct-only'
    return 'empty'
  }

  /**
   * 从DPML文档中提取指定标签的内容
   * @param dpmlContent - 完整的DPML文档内容
   * @param tagName - 标签名称
   */
  extractTagContent(dpmlContent: string, tagName: string): string {
    const regex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i')
    const match = dpmlContent.match(regex)
    return match ? match[1] ?? '' : ''
  }

  /**
   * 解析完整的DPML角色文档
   * @param roleContent - 角色文档内容
   * @returns 解析后的角色语义结构
   */
  parseRoleDocument(roleContent: string): Record<string, DPMLTagSemantics> {
    const dpmlTags = ['personality', 'principle', 'knowledge']
    const roleSemantics: Record<string, DPMLTagSemantics> = {}

    dpmlTags.forEach((tagName) => {
      const tagContent = this.extractTagContent(roleContent, tagName)
      if (tagContent) {
        roleSemantics[tagName] = this.parseTagContent(tagContent, tagName)
      }
    })

    return roleSemantics
  }
}
