/**
 * Manual协议处理器
 * 处理 @manual://tool-name 格式的资源引用
 * 从注册表中查找并加载工具使用手册
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

interface ManualResource {
  reference: string
  source?: string
}

interface RegistryManagerForManual {
  registryData: {
    findResourceById: (id: string, protocol?: string | null) => ManualResource | null
  }
  loadResourceByProtocol: (ref: string) => Promise<string>
}

class ManualProtocol extends ResourceProtocol {
  public registryManager: RegistryManagerForManual | null

  constructor() {
    super('manual')
    this.registryManager = null
  }

  setRegistryManager(manager: RegistryManagerForManual): void {
    this.registryManager = manager
  }

  async resolve(manualPath: string, _queryParams: QueryParams): Promise<string | { id: string; content: string; metadata: ManualResource; source: string }> {
    if (!this.registryManager) {
      throw new Error('ManualProtocol: Registry manager not set')
    }

    const manualResource = this.registryManager.registryData
      .findResourceById(manualPath, 'manual')

    if (!manualResource) {
      const toolResource = this.registryManager.registryData
        .findResourceById(manualPath, 'tool')

      if (toolResource) {
        throw new Error(`Manual '${manualPath}' not found. Found corresponding tool but no manual. Consider creating ${manualPath}.manual.md`)
      }

      throw new Error(`Manual '${manualPath}' not found in registry`)
    }

    const manualContent = await this.registryManager
      .loadResourceByProtocol(manualResource.reference)

    this.validateManualContent(manualContent, manualPath)

    return {
      id: manualPath,
      content: manualContent,
      metadata: manualResource,
      source: manualResource.source || 'unknown',
    }
  }

  async loadContent(_resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    throw new Error('ManualProtocol: use resolve() instead')
  }

  validateManualContent(content: string, manualPath: string): void {
    if (!content || typeof content !== 'string') {
      throw new Error(`Manual '${manualPath}': Invalid or empty content`)
    }

    const trimmedContent = content.trim()
    if (trimmedContent.length === 0) {
      throw new Error(`Manual '${manualPath}': Empty manual content`)
    }

    if (!trimmedContent.includes('<manual>') || !trimmedContent.includes('</manual>')) {
      throw new Error(`Manual '${manualPath}': Missing required <manual> tags`)
    }
  }

  getProtocolInfo(): { name: string; description: string; syntax: string; examples: string[]; supportedFileTypes: string[]; usageNote: string } {
    return {
      name: 'manual',
      description: 'Manual资源协议 - 加载工具使用手册和说明文档',
      syntax: 'manual://{manual_id}',
      examples: [
        'manual://calculator',
        'manual://send-email',
        'manual://data-processor',
        'manual://api-client',
      ],
      supportedFileTypes: ['.manual.md'],
      usageNote: '手册文件必须使用<manual>标签包裹内容，提供工具的详细使用说明',
    }
  }

  shouldCache(_manualPath: string): boolean {
    return true
  }

  getCacheKey(manualPath: string): string {
    return `manual://${manualPath}`
  }
}

export = ManualProtocol