const ResourceProtocol = require('./ResourceProtocol')
const fs = require('fs-extra')

/**
 * 人格协议处理器
 * 处理 persona:// 协议的资源解析。
 * 人格是角色语言风格/价值偏好的补充（如 nuwa 的诗意语调、sean 的简洁直白），
 * 与 role 的"身份骨架"区别：persona 不改变工具白名单，仅调整表达风格与禁区。
 */
class PersonaProtocol extends ResourceProtocol {
  constructor () {
    super('persona')
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
      name: 'persona',
      description: '人格资源协议 - 角色的语言风格与表达偏好补充',
      location: 'persona://{persona_id}',
      examples: [
        'persona://nuwa',
        'persona://sean',
        'persona://luban'
      ]
    }
  }

  /**
   * 解析人格协议
   * @param {string} personaPath - 人格路径，如 'nuwa'
   * @param {Object} queryParams - 查询参数（暂未使用）
   * @returns {Promise<string>} 人格文件内容
   */
  async resolve(personaPath, queryParams = {}) {
    try {
      const fullResourceId = `persona:${personaPath}`

      let resourceData = this.registryManager.registryData.findResourceById(personaPath, 'persona')

      if (!resourceData) {
        resourceData = this.registryManager.registryData.findResourceById(fullResourceId)
      }

      if (!resourceData) {
        const availablePersonas = this.registryManager.registryData.getResourcesByProtocol('persona')
          .map(r => r.id).join(', ')
        throw new Error(`人格 '${personaPath}' 未找到。可用人格: ${availablePersonas || '(空)'}`)
      }

      const result = await this.registryManager.loadResourceByProtocol(resourceData.reference)

      return result
    } catch (error) {
      throw new Error(`PersonaProtocol.resolve failed: ${error.message}`)
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
      throw new Error(`无法加载人格文件 ${resolvedPath}: ${error.message}`)
    }
  }

  /**
   * 验证人格路径
   */
  validatePath (resourcePath) {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

module.exports = PersonaProtocol
