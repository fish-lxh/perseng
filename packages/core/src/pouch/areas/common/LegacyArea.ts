/**
 * LegacyArea - 兼容旧命令的 Area
 * 用于包装旧的 getPurpose/getContent 输出
 *
 * P0 step 0B.4.1: 迁 .js → .ts. BaseArea 仍在 .js（0B.4.2 迁）,
 * 用 const+require 模式避免 apps/cli TS6059 rootDir。
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const BaseArea = require('../BaseArea') as unknown as new (name: string) => {
  render(): Promise<string>
  format(content: string): string
  getName(): string
}

/** PATEOAS 导航片段（仅取 render 用到的字段） */
interface LegacyPateoas {
  currentState?: string
}

export class LegacyArea extends BaseArea {
  // purpose 参数接收但不存储：原 .js 中也存了 this.purpose 但 render() 实际未读
  // （死代码）。为避免 TS6133 'declared but never read' 在 strict 模式触发，
  // 这里接收参数后不存到 instance。如果未来需要在此 area 内消费 purpose，
  // 加 private purpose: string 字段即可。
  private content: string
  private pateoas: LegacyPateoas | null

  constructor(purpose: string, content: string, pateoas: LegacyPateoas | null) {
    super('LEGACY')
    // 接收但不存储（保持构造器契约不变，避免 .js 调用方破坏）
    void purpose
    this.content = content
    this.pateoas = pateoas
  }

  async render(): Promise<string> {
    // 直接返回内容，不再包装"锦囊"概念
    let output = this.content

    if (this.pateoas && this.pateoas.currentState) {
      output += `\n\n📍 当前状态：${this.pateoas.currentState}`
    }

    return output
  }

  format(content: string): string {
    // LegacyArea 不需要额外格式化，直接返回内容
    return content + '\n'
  }
}

export default LegacyArea
