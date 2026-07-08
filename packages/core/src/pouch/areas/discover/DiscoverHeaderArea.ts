/**
 * DiscoverHeaderArea - 发现信息头部区域
 *
 * P0 step 0B.4.1: 迁 .js → .ts.
 * 0B.4.3: BaseArea 已在 .ts, 改用正式 ESM import.
 */

import { BaseArea } from '../BaseArea.js'

/** DiscoverHeaderArea 用的 stats 形状（仅取渲染用到的字段） */
export interface DiscoverStats {
  totalRoles: number
  systemRoles: number
  projectRoles: number
  userRoles: number
  rolexRoles: number
  totalTools: number
  systemTools: number
  projectTools: number
  userTools: number
}

export class DiscoverHeaderArea extends BaseArea {
  private stats: DiscoverStats

  constructor(stats: DiscoverStats) {
    super('DISCOVER_HEADER_AREA')
    this.stats = stats
  }

  async render(): Promise<string> {
    const s = this.stats
    return `🎭 **Perseng 专业服务清单**
📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

## 📊 资源统计
- 🎭 角色总数: ${s.totalRoles}个 (系统${s.systemRoles}个 + 项目${s.projectRoles}个 + 用户${s.userRoles}个)
- 🔧 工具总数: ${s.totalTools}个 (系统${s.systemTools}个 + 项目${s.projectTools}个 + 用户${s.userTools}个)
`
  }
}

export default DiscoverHeaderArea
