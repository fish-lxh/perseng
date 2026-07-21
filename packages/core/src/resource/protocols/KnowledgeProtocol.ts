/**
 * 知识资源协议处理器
 * 处理 knowledge:// 协议的资源解析
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs-extra'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

class KnowledgeProtocol extends ResourceProtocol {
  public registry: Record<string, unknown>
  public registryManager: { registryData: { findResourceById: (id: string, protocol?: string | null) => unknown; getResourcesByProtocol: (protocol: string) => Array<{ id: string }> }; loadResourceByProtocol: (ref: string) => Promise<string> } | null

  constructor() {
    super('knowledge')
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
      name: 'knowledge',
      description: '知识资源协议',
      location: 'knowledge://{knowledge_id}',
      examples: [
        'knowledge://xiaohongshu-marketing',
        'knowledge://ai-tools-guide',
      ],
    }
  }

  async resolve(knowledgePath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const fullResourceId = `knowledge:${knowledgePath}`
      const mgr = this.registryManager
      if (!mgr) throw new Error('registryManager not set')

      let resourceData = mgr.registryData.findResourceById(knowledgePath, 'knowledge') as { reference: string } | null
      if (!resourceData) {
        resourceData = mgr.registryData.findResourceById(fullResourceId) as { reference: string } | null
      }
      if (!resourceData) {
        const availableKnowledge = mgr.registryData.getResourcesByProtocol('knowledge')
          .map((r) => r.id).join(', ')
        throw new Error(`知识模块 '${knowledgePath}' 未找到。可用知识模块: ${availableKnowledge}`)
      }

      const result = await mgr.loadResourceByProtocol(resourceData.reference)
      return result
    } catch (error) {
      throw new Error(`KnowledgeProtocol.resolve failed: ${(error as Error).message}`)
    }
  }

  async loadContent(resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法加载知识资源文件 ${resolvedPath}: ${(error as Error).message}`)
    }
  }

  validatePath(resourcePath: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

export = KnowledgeProtocol