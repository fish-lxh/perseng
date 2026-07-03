const BaseDiscovery = require('./BaseDiscovery')
const logger = require('@promptx/logger')
const RegistryData = require('../RegistryData')
const ResourceData = require('../ResourceData')
const fs = require('fs-extra')
const path = require('path')

/**
 * UserDiscovery - User 级资源发现器
 *
 * 核心设计原则：
 * 1. 基于 @user 协议，扫描 ~/.perseng/resource 目录
 * 2. 优先使用注册表，fallback 到动态扫描
 * 3. 与 ProjectDiscovery 保持相同的目录结构和扫描逻辑
 * 4. User 级资源具有最高优先级（priority = 3）
 */
class UserDiscovery extends BaseDiscovery {
  constructor() {
    super('USER', 3)  // source = 'USER', priority = 3 (最高优先级)
    this.userProtocol = null
  }

  /**
   * 获取 UserProtocol 实例
   */
  getUserProtocol() {
    if (!this.userProtocol) {
      const { getGlobalResourceManager } = require('../../resource')
      const resourceManager = getGlobalResourceManager()
      this.userProtocol = resourceManager.protocols.get('user')
    }
    return this.userProtocol
  }

  /**
   * 发现 User 级资源注册表
   * @returns {Promise<Map>} 资源注册表 Map<resourceId, reference>
   */
  async discoverRegistry() {
    try {
      // 1. 优先尝试从注册表加载
      const registryMap = await this.loadFromRegistry()
      if (registryMap.size > 0) {
        logger.debug(`UserDiscovery 从注册表加载 ${registryMap.size} 个资源`)
        return registryMap
      }

      // 2. Fallback: 动态扫描生成注册表
      logger.debug('UserDiscovery 注册表不存在，使用动态扫描')
      const resources = await this.scanUserResources()
      return this.buildRegistryFromResources(resources)

    } catch (error) {
      logger.warn(`[UserDiscovery] Registry discovery failed: ${error.message}`)
      return new Map()
    }
  }

  /**
   * 从注册表文件加载资源
   * @returns {Promise<Map>} 资源注册表
   */
  async loadFromRegistry() {
    try {
      const protocol = this.getUserProtocol()
      
      // 使用 @user 协议检查注册表文件
      const registryPath = await protocol.resolvePath('.perseng/resource/user.registry.json')
      
      if (!await fs.pathExists(registryPath)) {
        return new Map()
      }

      // 加载并解析注册表
      const registryData = await RegistryData.fromFile('user', registryPath)
      return registryData.getResourceMap(true) // 带前缀
      
    } catch (error) {
      logger.warn(`[UserDiscovery] Failed to load registry: ${error.message}`)
      return new Map()
    }
  }

  /**
   * 动态扫描 User 资源
   * @returns {Promise<Array>} 资源列表
   */
  async scanUserResources() {
    try {
      const protocol = this.getUserProtocol()
      
      // 使用 @user 协议获取资源目录
      const resourceDir = await protocol.resolvePath('.perseng/resource')
      
      if (!await fs.pathExists(resourceDir)) {
        logger.debug('UserDiscovery User 资源目录不存在')
        return []
      }

      // 创建临时注册表来收集资源
      const tempRegistry = RegistryData.createEmpty('user', null)
      
      // 扫描目录结构（复用 ProjectDiscovery 的扫描逻辑）
      await this._scanDirectory(resourceDir, tempRegistry)
      
      // 转换为资源列表
      const resources = []
      for (const resource of tempRegistry.resources) {
        resources.push({
          id: resource.id,
          protocol: resource.protocol,
          reference: resource.reference,
          source: resource.source
        })
      }

      logger.info(`[UserDiscovery] User 扫描完成，发现 ${resources.length} 个资源`)
      return resources
      
    } catch (error) {
      logger.warn(`[UserDiscovery] 扫描 User 资源失败: ${error.message}`)
      return []
    }
  }

  /**
   * 扫描目录并添加资源到注册表
   * @param {string} resourcesDir - 资源目录
   * @param {RegistryData} registryData - 注册表数据
   * @private
   */
  async _scanDirectory(resourcesDir, registryData) {
    try {
      // 递归扫描整个 resource 目录
      await this._recursiveScan(resourcesDir, '', registryData)
    } catch (error) {
      logger.warn(`[UserDiscovery] 扫描资源目录失败: ${error.message}`)
    }
  }

  /**
   * 递归扫描目录
   * @param {string} currentPath - 当前扫描路径
   * @param {string} relativePath - 相对于 resource 目录的路径
   * @param {RegistryData} registryData - 注册表数据
   * @private
   */
  async _recursiveScan(currentPath, relativePath, registryData) {
    try {
      const items = await fs.readdir(currentPath)
      
      for (const item of items) {
        const itemPath = path.join(currentPath, item)
        const stat = await fs.stat(itemPath)
        const newRelativePath = relativePath ? `${relativePath}/${item}` : item
        
        if (stat.isDirectory()) {
          // 递归扫描子目录
          await this._recursiveScan(itemPath, newRelativePath, registryData)
        } else {
          // 处理文件
          await this._processFile(itemPath, newRelativePath, registryData)
        }
      }
    } catch (error) {
      logger.warn(`[UserDiscovery] 扫描${currentPath}失败: ${error.message}`)
    }
  }

  /**
   * 处理单个文件
   * @param {string} filePath - 文件完整路径
   * @param {string} relativePath - 相对路径
   * @param {RegistryData} registryData - 注册表数据
   * @private
   */
  async _processFile(filePath, relativePath, registryData) {
    const fileName = path.basename(filePath)
    let protocol = null
    let resourceId = null
    
    // 🔍 Knuth调试日志：追踪文件处理
    logger.debug(`[UserDiscovery._processFile] Processing: ${relativePath} (file: ${fileName})`)
    
    // 根据文件名后缀识别资源类型
    if (fileName.endsWith('.role.md')) {
      protocol = 'role'
      resourceId = path.basename(fileName, '.role.md')
    } else if (fileName.endsWith('.thought.md')) {
      protocol = 'thought'
      resourceId = path.basename(fileName, '.thought.md')
    } else if (fileName.endsWith('.execution.md')) {
      protocol = 'execution'
      resourceId = path.basename(fileName, '.execution.md')
    } else if (fileName.endsWith('.knowledge.md')) {
      protocol = 'knowledge'
      resourceId = path.basename(fileName, '.knowledge.md')
    } else if (fileName.endsWith('.tool.js')) {
      protocol = 'tool'
      resourceId = path.basename(fileName, '.tool.js')
    } else if (fileName.endsWith('.manual.md')) {
      protocol = 'manual'
      resourceId = path.basename(fileName, '.manual.md')
    }
    
    if (protocol && resourceId) {
      // 🔍 Knuth调试：发现资源类型
      logger.info(`[UserDiscovery._processFile] Found ${protocol} resource: ${resourceId}`)
      
      // 验证文件内容
      if (await this._validateResourceFile(filePath, protocol)) {
        const reference = `@user://.perseng/resource/${relativePath}`
        
        const resourceData = new ResourceData({
          id: resourceId,
          source: 'user',
          protocol: protocol,
          name: ResourceData._generateDefaultName(resourceId, protocol),
          description: ResourceData._generateDefaultDescription(resourceId, protocol),
          reference: reference,
          metadata: {
            scannedAt: new Date().toISOString(),
            path: relativePath
          }
        })
        
        registryData.addResource(resourceData)
        logger.info(`[UserDiscovery] 成功添加${protocol}资源: ${resourceId} at ${relativePath}`)
      }
    }
  }

  /**
   * 验证资源文件格式
   * @param {string} filePath - 文件路径
   * @param {string} protocol - 协议类型
   * @returns {Promise<boolean>} 是否是有效的资源文件
   */
  async _validateResourceFile(filePath, protocol) {
    try {
      const content = await fs.readFile(filePath, 'utf8')

      if (!content || typeof content !== 'string') {
        return false
      }

      const trimmedContent = content.trim()
      if (trimmedContent.length === 0) {
        return false
      }

      // 根据协议类型验证 DPML 标签（支持带属性的标签）
      switch (protocol) {
        case 'role':
          return /<role[\s>]/.test(trimmedContent) && trimmedContent.includes('</role>')
        case 'execution':
          return /<execution[\s>]/.test(trimmedContent) && trimmedContent.includes('</execution>')
        case 'thought':
          return /<thought[\s>]/.test(trimmedContent) && trimmedContent.includes('</thought>')
        case 'knowledge':
          // knowledge 类型比较灵活，只要文件有内容就认为是有效的
          return true
        case 'manual':
          return /<manual[\s>]/.test(trimmedContent) && trimmedContent.includes('</manual>')
        case 'tool':
          // tool 文件存在且有内容就认为是有效的，语法验证延迟到加载时
          return true
        default:
          return false
      }
    } catch (error) {
      logger.warn(`[UserDiscovery] Failed to validate ${filePath}: ${error.message}`)
      return false
    }
  }

  /**
   * 从资源列表构建注册表 Map
   * @param {Array} resources - 资源列表
   * @returns {Map} 资源注册表
   */
  buildRegistryFromResources(resources) {
    const registryMap = new Map()
    
    resources.forEach(resource => {
      const key = `user:${resource.id}`
      registryMap.set(key, resource.reference)
    })
    
    return registryMap
  }

  /**
   * 生成并保存 User 注册表文件
   * @returns {Promise<RegistryData>} 生成的注册表数据
   */
  async generateRegistry() {
    try {
      const protocol = this.getUserProtocol()
      
      // 获取注册表文件路径
      const registryPath = await protocol.resolvePath('.perseng/resource/user.registry.json')
      
      // 创建注册表数据
      const registryData = RegistryData.createEmpty('user', registryPath)
      
      // 扫描资源目录
      const resourceDir = await protocol.resolvePath('.perseng/resource')
      
      if (await fs.pathExists(resourceDir)) {
        await this._scanDirectory(resourceDir, registryData)
      }
      
      // 确保目录存在
      await fs.ensureDir(path.dirname(registryPath))
      
      // 保存注册表
      await registryData.save()
      
      logger.info(`[UserDiscovery] User 注册表生成完成，发现 ${registryData.size} 个资源`)
      return registryData
      
    } catch (error) {
      logger.error(`[UserDiscovery] 生成注册表失败: ${error.message}`)
      return RegistryData.createEmpty('user')
    }
  }

  /**
   * 获取注册表数据（兼容接口）
   * @returns {Promise<RegistryData>} 注册表数据
   */
  async getRegistryData() {
    try {
      const protocol = this.getUserProtocol()
      const registryPath = await protocol.resolvePath('.perseng/resource/user.registry.json')
      
      if (await fs.pathExists(registryPath)) {
        const registryData = await RegistryData.fromFile('user', registryPath)
        
        if (registryData.size > 0) {
          logger.info(`[UserDiscovery] 从注册表加载 ${registryData.size} 个资源`)
          return registryData
        }
      }
      
      // 动态生成注册表
      logger.info(`[UserDiscovery] User 注册表无效，重新生成`)
      return await this.generateRegistry()
      
    } catch (error) {
      logger.error(`[UserDiscovery] 获取注册表数据失败: ${error.message}`)
      return RegistryData.createEmpty('user')
    }
  }

  /**
   * 发现资源（BaseDiscovery 要求的抽象方法）
   * @returns {Promise<Array>} 发现的资源列表
   */
  async discover() {
    const registryMap = await this.discoverRegistry()
    const resources = []
    
    for (const [key, reference] of registryMap) {
      // 解析 key 格式：user:resourceId
      const [source, id] = key.split(':')
      if (source === 'user' && id) {
        resources.push({
          id,
          reference,
          source: 'user'
        })
      }
    }
    
    return resources
  }
}

module.exports = UserDiscovery