/**
 * ToolListArea - 工具列表展示区域
 *
 * P0 step 0B.4.1: 迁 .js → .ts. BaseArea 仍在 .js（0B.4.2 迁）,
 * 用 const+require 模式。
 *
 * 原 .js 引用了 logger 但实际未调用（dead import），迁到 .ts 时清理掉
 * （strict noUnusedLocals 会触发错误，不如源头删干净）。
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BaseArea = require('../BaseArea') as unknown as new (name: string) => {
  render(): Promise<string>
  getName(): string
}

/** 工具条目（仅取渲染用到的字段） */
export interface ToolEntry {
  id: string
  name?: string
  title?: string
}

export interface ToolCategories {
  [source: string]: ToolEntry[]
}

export class ToolListArea extends BaseArea {
  private toolCategories: ToolCategories

  constructor(toolCategories: ToolCategories) {
    super('TOOL_LIST_AREA')
    this.toolCategories = toolCategories
  }

  async render(): Promise<string> {
    let content = ''

    // 渲染各个来源的工具
    for (const [source, tools] of Object.entries(this.toolCategories)) {
      if (tools.length === 0) continue

      const sourceIcon = this.getSourceIcon(source)
      const sourceTitle = this.getSourceTitle(source)

      content += `\n${sourceIcon} **${sourceTitle}** (${tools.length}个)\n`

      // 按 ID 排序
      tools.sort((a, b) => a.id.localeCompare(b.id))

      for (const tool of tools) {
        const toolCommand = `toolx("@tool://${tool.id}", mode: 'manual')`
        const executeCommand = `toolx("@tool://${tool.id}", parameters)`

        content += `- \`${tool.id}\`: ${tool.name || tool.title || '未命名工具'}\n`
        content += `  - 📖 查看使用手册: ${toolCommand}\n`
        content += `  - 🔧 执行工具: ${executeCommand}\n`
      }
    }

    if (!content) return '暂无可用工具'
    return content
  }

  private getSourceIcon(source: string): string {
    const icons: Record<string, string> = {
      system: '📦',
      project: '🏗️',
      user: '👤',
    }
    return icons[source] || '📄'
  }

  private getSourceTitle(source: string): string {
    const titles: Record<string, string> = {
      system: '系统工具',
      project: '项目工具',
      user: '用户工具',
    }
    return titles[source] || '其他工具'
  }
}

export default ToolListArea
