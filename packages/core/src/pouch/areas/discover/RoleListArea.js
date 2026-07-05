const BaseArea = require('../BaseArea')
const logger = require('@promptx/logger')

/**
 * RoleListArea - 角色列表展示区域
 *
 * KNUTH-FEAT 2026-07-04: archiveFilter 选项
 * - showArchived: 当为 true 时，archived 角色仍会渲染（带 ⚠️ [archived] 标记）
 * - onlyArchived: 当为 true 时，仅渲染 archived 角色（也会带标记，保持一致）
 *
 * 正常过滤由 DiscoverCommand.loadRoleRegistry 完成，本类只负责标记渲染。
 */
class RoleListArea extends BaseArea {
  constructor(roleCategories, directoryData = null, archiveFilter = {}) {
    super('ROLE_LIST_AREA')
    this.roleCategories = roleCategories
    this.directoryData = directoryData || { roles: [], organizations: [] }
    this.archiveFilter = {
      showArchived: !!archiveFilter.showArchived,
      onlyArchived: !!archiveFilter.onlyArchived,
    }
  }

  async render() {
    let content = ''

    // 渲染各个来源的角色
    for (const [source, roles] of Object.entries(this.roleCategories)) {
      if (roles.length === 0) continue

      const sourceIcon = this.getSourceIcon(source)
      const sourceTitle = this.getSourceTitle(source)

      content += `\n${sourceIcon} **${sourceTitle}** (${roles.length}个)\n`

      // 按ID排序
      roles.sort((a, b) => a.id.localeCompare(b.id))

      roles.forEach(role => {
        const archiveTag = role.archived ? '⚠️ [已归档] ' : ''
        if (role.version === 'v2') {
          const command = `action({ operation: "activate", role: "${role.id}" })`
          const orgInfo = this.getOrganizationInfo(role.id)
          if (orgInfo) {
            content += `- ${archiveTag}\`${role.id}\` [V2]: ${role.name || '未命名角色'} (${orgInfo.org} - ${orgInfo.position}) → ${command}\n`
          } else {
            content += `- ${archiveTag}\`${role.id}\` [V2]: ${role.name || '未命名角色'} → ${command}\n`
          }
        } else {
          const command = `action("${role.id}")`
          content += `- ${archiveTag}\`${role.id}\`: ${role.name || role.title || '未命名角色'} → ${command}\n`
        }
      })
    }

    // KNUTH-FEAT 2026-07-04: onlyArchived 时加顶提示
    if (this.archiveFilter.onlyArchived) {
      content = '\n📜 **仅显示已归档角色** — 默认 `discover` 不展示\n' + content
    } else if (this.archiveFilter.showArchived) {
      content = '\n📜 **包含已归档角色** — 带 ⚠️ 标记\n' + content
    }

    return content || '暂无可用角色'
  }

  /**
   * 获取角色的组织和岗位信息
   * @param {string} roleId - 角色ID
   * @returns {Object|null} { org: string, position: string } 或 null
   */
  getOrganizationInfo(roleId) {
    if (!this.directoryData || !this.directoryData.roles) {
      return null
    }

    const roleData = this.directoryData.roles.find(r => r.name === roleId)
    if (roleData && roleData.org && roleData.position) {
      return {
        org: roleData.org,
        position: roleData.position
      }
    }
    return null
  }

  getSourceIcon(source) {
    const icons = {
      'system': '📦',
      'project': '🏗️',
      'user': '👤',
      'rolex': '🎭'
    }
    return icons[source] || '📄'
  }

  getSourceTitle(source) {
    const titles = {
      'system': '系统角色',
      'project': '项目角色',
      'user': '用户角色',
      'rolex': 'V2角色 (RoleX)'
    }
    return titles[source] || '其他角色'
  }
}

module.exports = RoleListArea
