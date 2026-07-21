/**
 * AI角色协议处理器
 * 处理 role:// 协议的资源解析
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 *
 * KNUTH-NOTE: resolve() 内 inline require('../rolex/RolexBridge') 保留 — v2 角色桥接。
 */
import fs from 'fs-extra'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

class RoleProtocol extends ResourceProtocol {
  public registry: Record<string, unknown>
  public registryManager: { registryData: { findResourceById: (id: string, protocol?: string | null) => unknown; getResourcesByProtocol: (protocol: string) => Array<{ id: string }> }; loadResourceByProtocol: (ref: string) => Promise<string> } | null

  constructor() {
    super('role')
    this.registry = {}
    this.registryManager = null
  }

  setRegistryManager(manager: { registryData: { findResourceById: (id: string, protocol?: string | null) => unknown; getResourcesByProtocol: (protocol: string) => Array<{ id: string }> }; loadResourceByProtocol: (ref: string) => Promise<string> } | null): void {
    this.registryManager = manager
  }

  setRegistry(registry: Record<string, unknown>): void {
    this.registry = registry || {}
  }

  getProtocolInfo(): { name: string; description: string; location: string; examples: string[] } {
    return {
      name: 'role',
      description: 'AI角色资源协议',
      location: 'role://{role_id}',
      examples: [
        'role://video-copywriter',
        'role://product-owner',
        'role://assistant',
        'role://prompt-developer',
      ],
    }
  }

  async resolve(rolePath: string, _queryParams: QueryParams): Promise<string> {
    try {
      if (rolePath.startsWith('v2:')) {
        const roleId = rolePath.substring(3)
        const RolexBridgeModule = require('../rolex/RolexBridge') as { getRolexBridge: () => { identity: (id: string) => Promise<string> } }
        const bridge = RolexBridgeModule.getRolexBridge()
        const content = await bridge.identity(roleId)
        return content
      }

      const fullResourceId = `role:${rolePath}`
      const mgr = this.registryManager
      if (!mgr) throw new Error('registryManager not set')

      let resourceData = mgr.registryData.findResourceById(rolePath, 'role') as { reference: string } | null
      if (!resourceData) {
        resourceData = mgr.registryData.findResourceById(fullResourceId) as { reference: string } | null
      }
      if (!resourceData) {
        const availableRoles = mgr.registryData.getResourcesByProtocol('role')
          .map((r) => r.id).join(', ')
        throw new Error(`角色 '${rolePath}' 未找到。可用角色: ${availableRoles}`)
      }

      const result = await mgr.loadResourceByProtocol(resourceData.reference)
      return result
    } catch (error) {
      throw new Error(`RoleProtocol.resolve failed: ${(error as Error).message}`)
    }
  }

  async loadContent(resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法加载角色文件 ${resolvedPath}: ${(error as Error).message}`)
    }
  }

  validatePath(resourcePath: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

export = RoleProtocol