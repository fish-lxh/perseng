/**
 * RoleListArea - 角色列表展示区域
 *
 * KNUTH-FEAT 2026-07-04: archiveFilter 选项
 * - showArchived: 当为 true 时，archived 角色仍会渲染（带 ⚠️ [archived] 标记）
 * - onlyArchived: 当为 true 时，仅渲染 archived 角色（也会带标记，保持一致）
 *
 * 正常过滤由 DiscoverCommand.loadRoleRegistry 完成，本类只负责标记渲染。
 *
 * P0 step 0B.4.2: 迁 .js → .ts, BaseArea .ts; logger 原 .js 是 dead import, 清理掉。
 */

import { BaseArea } from '../BaseArea.js'

/** 角色条目（仅取渲染用到的字段） */
export interface RoleEntry {
  id: string
  name?: string
  title?: string
  source?: string
  version?: string
  archived?: boolean
}

export interface RoleCategories {
  [source: string]: RoleEntry[]
}

/** Directory 数据接口（仅取角色查找用到的字段） */
export interface DirectoryData {
  roles: Array<{ name: string; org?: string; position?: string }>
  organizations: unknown[]
}

export interface ArchiveFilter {
  showArchived?: boolean
  onlyArchived?: boolean
}

export interface OrganizationInfo {
  org: string
  position: string
}

export class RoleListArea extends BaseArea {
  private roleCategories: RoleCategories
  private directoryData: DirectoryData | null
  private archiveFilter: { showArchived: boolean; onlyArchived: boolean }

  constructor(
    roleCategories: RoleCategories,
    directoryData: DirectoryData | null = null,
    archiveFilter: ArchiveFilter = {},
  ) {
    super('ROLE_LIST_AREA')
    this.roleCategories = roleCategories
    this.directoryData = directoryData || { roles: [], organizations: [] }
    this.archiveFilter = {
      showArchived: !!archiveFilter.showArchived,
      onlyArchived: !!archiveFilter.onlyArchived,
    }
  }

  async render(): Promise<string> {
    let content = ''

    // 渲染各个来源的角色
    for (const [source, roles] of Object.entries(this.roleCategories)) {
      if (roles.length === 0) continue

      const sourceIcon = this.getSourceIcon(source)
      const sourceTitle = this.getSourceTitle(source)

      content += `\n${sourceIcon} **${sourceTitle}** (${roles.length}个)\n`

      // 按 ID 排序
      roles.sort((a, b) => a.id.localeCompare(b.id))

      for (const role of roles) {
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
      }
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
   * @param roleId 角色 ID
   * @returns { org, position } 或 null
   */
  getOrganizationInfo(roleId: string): OrganizationInfo | null {
    if (!this.directoryData || !this.directoryData.roles) {
      return null
    }

    const roleData = this.directoryData.roles.find((r) => r.name === roleId)
    if (roleData && roleData.org && roleData.position) {
      return {
        org: roleData.org,
        position: roleData.position,
      }
    }
    return null
  }

  private getSourceIcon(source: string): string {
    const icons: Record<string, string> = {
      system: '📦',
      project: '🏗️',
      user: '👤',
      rolex: '🎭',
    }
    return icons[source] || '📄'
  }

  private getSourceTitle(source: string): string {
    const titles: Record<string, string> = {
      system: '系统角色',
      project: '项目角色',
      user: '用户角色',
      rolex: 'V2角色 (RoleX)',
    }
    return titles[source] || '其他角色'
  }
}

export default RoleListArea
