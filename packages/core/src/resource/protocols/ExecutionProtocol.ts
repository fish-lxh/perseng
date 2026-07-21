/**
 * 执行模式协议处理器
 * 处理 execution:// 协议的资源解析
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace，
 * 旧 .js 消费者直接 `require('./ExecutionProtocol')` 当 class 用。
 */
import fs from 'fs-extra'
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

class ExecutionProtocol extends ResourceProtocol {
  public registry: Record<string, unknown>
  public registryManager: { registryData: { findResourceById: (id: string, protocol?: string | null) => unknown; getResourcesByProtocol: (protocol: string) => Array<{ id: string }> }; loadResourceByProtocol: (ref: string) => Promise<string> } | null

  constructor() {
    super('execution')
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
      name: 'execution',
      description: '执行模式资源协议',
      location: 'execution://{execution_id}',
      examples: [
        'execution://deal-at-reference',
        'execution://prompt-developer',
        'execution://memory-trigger',
      ],
    }
  }

  async resolve(executionPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const fullResourceId = `execution:${executionPath}`

      const mgr = this.registryManager
      if (!mgr) throw new Error('registryManager not set')

      let resourceData = mgr.registryData.findResourceById(executionPath, 'execution') as { reference: string } | null
      if (!resourceData) {
        resourceData = mgr.registryData.findResourceById(fullResourceId) as { reference: string } | null
      }
      if (!resourceData) {
        const availableExecutions = mgr.registryData.getResourcesByProtocol('execution')
          .map((r) => r.id).join(', ')
        throw new Error(`执行模式 '${executionPath}' 未找到。可用执行模式: ${availableExecutions}`)
      }

      const result = await mgr.loadResourceByProtocol(resourceData.reference)
      return result
    } catch (error) {
      throw new Error(`ExecutionProtocol.resolve failed: ${(error as Error).message}`)
    }
  }

  async loadContent(resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法加载执行模式文件 ${resolvedPath}: ${(error as Error).message}`)
    }
  }

  validatePath(resourcePath: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(resourcePath)
  }
}

export = ExecutionProtocol