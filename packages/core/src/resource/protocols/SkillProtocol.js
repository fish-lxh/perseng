const ResourceProtocol = require('./ResourceProtocol')
const fs = require('fs-extra')

/**
 * 技能协议处理器
 * 处理 skill:// 协议的资源解析。
 * 技能是角色可挂载的能力片段（如 story-weaving / character-improvisation），
 * 与 thought 的"通用思维模式"区别：skill 是角色特有的、不分 V1/V2 的执行能力。
 */
class SkillProtocol extends ResourceProtocol {
  constructor () {
    super('skill')
    this.registry = {}
    this.registryManager = null
  }

  /**
   * 设置注册表管理器
   */
  setRegistryManager(manager) {
    this.registryManager = manager
  }

  /**
   * 设置注册表
   */
  setRegistry (registry) {
    this.registry = registry || {}
  }

  /**
   * 获取协议信息
   */
  getProtocolInfo () {
    return {
      name: 'skill',
      description: '技能资源协议 - 角色可挂载的执行能力片段',
      location: 'skill://{skill_id}',
      examples: [
        'skill://story-weaving',
        'skill://character-improvisation',
        'skill://dpml-composition'
      ]
    }
  }

  /**
   * 解析技能协议
   * @param {string} skillPath - 技能路径，如 'story-weaving'
   * @param {Object} queryParams - 查询参数（暂未使用）
   * @returns {Promise<string>} 技能文件内容
   */
  async resolve(skillPath, queryParams = {}) {
    try {
      const fullResourceId = `skill:${skillPath}`

      // 从 RegistryData 查找资源
      let resourceData = this.registryManager.registryData.findResourceById(skillPath, 'skill')

      if (!resourceData) {
        // 如果没找到，尝试其他格式
        resourceData = this.registryManager.registryData.findResourceById(fullResourceId)
      }

      if (!resourceData) {
        const availableSkills = this.registryManager.registryData.getResourcesByProtocol('skill')
          .map(r => r.id).join(', ')
        throw new Error(`技能 '${skillPath}' 未找到。可用技能: ${availableSkills || '(空)'}`)
      }

      // 通过 ResourceManager 加载实际内容
      const result = await this.registryManager.loadResourceByProtocol(resourceData.reference)

      return result
    } catch (error) {
      throw new Error(`SkillProtocol.resolve failed: ${error.message}`)
    }
  }

  /**
   * 加载资源内容
   */
  async loadContent (resolvedPath, queryParams) {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法加载技能文件 ${resolvedPath}: ${error.message}`)
    }
  }

  /**
   * 验证技能路径
   * @param {string} resourcePath - 资源路径
   * @returns {boolean} 是否合法
   */
  validatePath (resourcePath) {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

module.exports = SkillProtocol
