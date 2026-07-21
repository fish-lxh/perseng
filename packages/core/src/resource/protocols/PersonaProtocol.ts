/**
 * 人格协议处理器
 * 处理 persona:// 协议的资源解析
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs-extra'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

class PersonaProtocol extends ResourceProtocol {
  public registry: Record<string, unknown>
  public registryManager: { registryData: { findResourceById: (id: string, protocol?: string | null) => unknown; getResourcesByProtocol: (protocol: string) => Array<{ id: string }> }; loadResourceByProtocol: (ref: string) => Promise<string> } | null

  constructor() {
    super('persona')
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
      name: 'persona',
      description: '人格资源协议 - 角色的语言风格与表达偏好补充',
      location: 'persona://{persona_id}',
      examples: [
        'persona://nuwa',
        'persona://sean',
        'persona://luban',
      ],
    }
  }

  async resolve(personaPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const fullResourceId = `persona:${personaPath}`
      const mgr = this.registryManager
      if (!mgr) throw new Error('registryManager not set')

      let resourceData = mgr.registryData.findResourceById(personaPath, 'persona') as { reference: string } | null
      if (!resourceData) {
        resourceData = mgr.registryData.findResourceById(fullResourceId) as { reference: string } | null
      }
      if (!resourceData) {
        const availablePersonas = mgr.registryData.getResourcesByProtocol('persona')
          .map((r) => r.id).join(', ')
        throw new Error(`人格 '${personaPath}' 未找到。可用人格: ${availablePersonas || '(空)'}`)
      }

      const result = await mgr.loadResourceByProtocol(resourceData.reference)
      return result
    } catch (error) {
      throw new Error(`PersonaProtocol.resolve failed: ${(error as Error).message}`)
    }
  }

  async loadContent(resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法加载人格文件 ${resolvedPath}: ${(error as Error).message}`)
    }
  }

  validatePath(resourcePath: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

export = PersonaProtocol