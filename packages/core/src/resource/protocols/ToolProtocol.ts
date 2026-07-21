/**
 * Tool协议处理器
 * 处理 @tool://tool-name 格式的资源引用
 * 从注册表中查找并加载工具JavaScript代码
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import ResourceProtocol = require('./ResourceProtocol')
import typesModule = require('../types')

type QueryParams = InstanceType<typeof typesModule.QueryParams>

interface ToolResource {
  reference: string
  source?: string
}

interface RegistryManagerForTool {
  registryData: {
    findResourceById: (id: string, protocol?: string | null) => ToolResource | null
  }
  loadResourceByProtocol: (ref: string) => Promise<string>
}

class ToolProtocol extends ResourceProtocol {
  public registryManager: RegistryManagerForTool | null

  constructor() {
    super('tool')
    this.registryManager = null
  }

  setRegistryManager(manager: RegistryManagerForTool): void {
    this.registryManager = manager
  }

  async resolve(toolPath: string, _queryParams: QueryParams): Promise<string | { id: string; content: string; metadata: ToolResource; source: string }> {
    if (!this.registryManager) {
      throw new Error('ToolProtocol: Registry manager not set')
    }

    const toolResource = this.registryManager.registryData
      .findResourceById(toolPath, 'tool')

    if (!toolResource) {
      throw new Error(`Tool '${toolPath}' not found in registry`)
    }

    const toolContent = await this.registryManager
      .loadResourceByProtocol(toolResource.reference)

    this.validateToolContent(toolContent, toolPath)

    return {
      id: toolPath,
      content: toolContent,
      metadata: toolResource,
      source: toolResource.source || 'unknown',
    }
  }

  async loadContent(_resolvedPath: string, _queryParams: QueryParams): Promise<string> {
    throw new Error('ToolProtocol: use resolve() instead')
  }

  validateToolContent(content: string, toolPath: string): void {
    if (!content || typeof content !== 'string') {
      throw new Error(`Tool '${toolPath}': Invalid or empty content`)
    }

    try {
      // 验证 JS 语法
      new Function(content)
    } catch (syntaxError) {
      throw new Error(`Tool '${toolPath}': JavaScript syntax error - ${(syntaxError as Error).message}`)
    }
  }

  getProtocolInfo(): { name: string; description: string; syntax: string; examples: string[]; supportedFileTypes: string[]; usageNote: string } {
    return {
      name: 'tool',
      description: 'Tool资源协议 - 加载可执行的JavaScript工具',
      syntax: 'tool://{tool_id}',
      examples: [
        'tool://calculator',
        'tool://send-email',
        'tool://data-processor',
        'tool://api-client',
      ],
      supportedFileTypes: ['.tool.js'],
      usageNote: '工具文件必须导出符合Perseng Tool Interface的对象',
    }
  }

  shouldCache(_toolPath: string): boolean {
    return true
  }

  getCacheKey(toolPath: string): string {
    return `tool://${toolPath}`
  }
}

export = ToolProtocol