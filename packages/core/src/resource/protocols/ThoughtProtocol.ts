/**
 * 思维模式协议处理器
 * 处理 thought:// 协议的资源解析
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs-extra'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

class ThoughtProtocol extends ResourceProtocol {
  public registry: Record<string, unknown>
  public registryManager: { registryData: { findResourceById: (id: string, protocol?: string | null) => unknown; getResourcesByProtocol: (protocol: string) => Array<{ id: string }> }; loadResourceByProtocol: (ref: string) => Promise<string> } | null

  constructor() {
    super('thought')
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
      name: 'thought',
      description: '思维模式资源协议',
      location: 'thought://{thought_id}',
      examples: [
        'thought://prompt-developer',
        'thought://product-owner',
      ],
    }
  }

  async resolve(thoughtPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const fullResourceId = `thought:${thoughtPath}`
      const mgr = this.registryManager
      if (!mgr) throw new Error('registryManager not set')

      let resourceData = mgr.registryData.findResourceById(thoughtPath, 'thought') as { reference: string } | null
      if (!resourceData) {
        resourceData = mgr.registryData.findResourceById(fullResourceId) as { reference: string } | null
      }
      if (!resourceData) {
        const availableThoughts = mgr.registryData.getResourcesByProtocol('thought')
          .map((r) => r.id).join(', ')
        throw new Error(`思维模式 '${thoughtPath}' 未找到。可用思维模式: ${availableThoughts}`)
      }

      const result = await mgr.loadResourceByProtocol(resourceData.reference)
      return result
    } catch (error) {
      throw new Error(`ThoughtProtocol.resolve failed: ${(error as Error).message}`)
    }
  }

  async loadContent(resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法加载思维模式文件 ${resolvedPath}: ${(error as Error).message}`)
    }
  }

  validatePath(resourcePath: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

export = ThoughtProtocol