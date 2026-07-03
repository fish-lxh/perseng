const BaseArea = require('../BaseArea')

/**
 * DiscoverHeaderArea - 发现信息头部区域
 */
class DiscoverHeaderArea extends BaseArea {
  constructor(stats) {
    super('DISCOVER_HEADER_AREA')
    this.stats = stats
  }

  async render() {
    return `🎭 **Perseng 专业服务清单**
📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

## 📊 资源统计
- 🎭 角色总数: ${this.stats.totalRoles}个 (系统${this.stats.systemRoles}个 + 项目${this.stats.projectRoles}个 + 用户${this.stats.userRoles}个)
- 🔧 工具总数: ${this.stats.totalTools}个 (系统${this.stats.systemTools}个 + 项目${this.stats.projectTools}个 + 用户${this.stats.userTools}个)
`
  }
}

module.exports = DiscoverHeaderArea