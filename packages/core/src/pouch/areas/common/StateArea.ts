/**
 * StateArea - 状态区域
 * 负责渲染当前状态和导航信息
 *
 * P0 step 0B.4.2: 迁 .js → .ts, BaseArea 已在 .ts, 用 ESM import
 */

import { BaseArea } from '../BaseArea.js'

export class StateArea extends BaseArea {
  private currentState: string
  private availableActions: string[]

  constructor(currentState: string = '', availableActions: string[] = []) {
    super('STATE_AREA')
    this.currentState = currentState || ''
    this.availableActions = availableActions || []
  }

  /**
   * 渲染状态区域内容
   */
  async render(): Promise<string> {
    let content = ''

    // 当前状态
    content += `📍 **当前状态**：${this.currentState}\n`

    // 可用行动
    if (this.availableActions.length > 0) {
      content += '\n🚀 **可用行动**：\n'
      this.availableActions.forEach((action, index) => {
        content += `${index + 1}. ${action}\n`
      })
    }

    return content
  }

  /**
   * 设置当前状态
   */
  setCurrentState(state: string): void {
    this.currentState = state
  }

  /**
   * 添加可用行动
   */
  addAction(action: string): void {
    this.availableActions.push(action)
  }

  /**
   * 清空可用行动
   */
  clearActions(): void {
    this.availableActions = []
  }
}

export default StateArea
