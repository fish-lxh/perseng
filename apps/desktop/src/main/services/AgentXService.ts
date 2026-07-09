import { LoggerFactoryImpl, type AgentX, type Unsubscribe } from 'agentxjs'
import * as logger from '@promptx/logger'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { app, safeStorage, BrowserWindow } from 'electron'
// KNUTH-FIX 2026-07-06: adm-zip 是 CJS 包（"main": "adm-zip.js"），在 ESM 模式下
// import default 拿到的就是 AdmZip class。之前用 require('adm-zip') 在 "type": "module"
// 项目里直接 ReferenceError，导致 skill zip 安装"如同虚设"（错误被 catch 吞掉，UI 弹个
// 不显眼的 toast 用户没看到）。
import AdmZip from 'adm-zip'
// KNUTH-FEAT 2026-07-04: 绕开 agentxjs facade 的 shouldEnqueue 过滤，
// 让 timeline 拿到全量 events（特别是 tool_use_content_block_start /
// tool_result / text_* 这类 source==='environment' 的事件）。
// 见 plan: 方案 A - AgentXService 重写以捕获工具事件。
import { createAgentXRuntime, type AgentXRuntime } from './agentx/createAgentXRuntime'

export interface MCPServerConfig {
  name: string
  // stdio 类型
  command?: string
  args?: string[]
  env?: Record<string, string>
  // http/sse 类型
  type?: "http" | "sse"
  url?: string
  // 通用
  enabled: boolean
  builtin?: boolean  // 内置服务器标记，不可删除
  description?: string  // 服务器描述
  [key: string]: unknown  // 支持其他自定义字段
}

export interface AgentXProfile {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  model: string
}

export interface AgentXConfig {
  apiKey: string
  baseUrl: string
  model: string
  mcpServers?: MCPServerConfig[]
  enabledSkills?: string[]  // 启用的 skills 列表
  profiles?: AgentXProfile[]
  activeProfileId?: string
}

type PersistedAgentXProfile = Omit<AgentXProfile, 'apiKey'> & { apiKey: string }
type PersistedAgentXConfig = Omit<AgentXConfig, 'apiKey' | 'profiles'> & {
  apiKey: string
  profiles?: PersistedAgentXProfile[]
}

const DEFAULT_CONFIG: AgentXConfig = {
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-20250514',
  mcpServers: [],
}

export class AgentXService {
  private agentx: AgentX | null = null
  // KNUTH-FEAT 2026-07-04: 持有底层 runtime / wsServer / eventQueue 引用，
  // 便于 start() 阶段 attach timeline-onAny，便于 stop() 阶段显式释放。
  private runtime: AgentXRuntime | null = null
  private wsServer: import('@agentxjs/network').WebSocketServer | null = null
  private eventQueue: import('@agentxjs/queue').EventQueue | null = null
  private port: number = 5200
  private isRunning: boolean = false
  private config: AgentXConfig = { ...DEFAULT_CONFIG }
  private configPath: string
  private agentxDir: string
  private imageCreateUnsubscribe: Unsubscribe | null = null
  private externalAccess: boolean = false
  private detachTimeline: (() => void) | null = null

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'agentx-config.json')
    this.agentxDir = path.join(app.getPath('userData'), '.agentx')
    this.loadConfig()
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8')
        const saved = this.deserializeConfig(JSON.parse(data) as PersistedAgentXConfig)
        this.config = { ...DEFAULT_CONFIG, ...saved }

        // Migrate: if no profiles but has apiKey, create a default profile
        if (!this.config.profiles?.length && this.config.apiKey) {
          const defaultProfile: AgentXProfile = {
            id: crypto.randomUUID(),
            name: 'Default',
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
            model: this.config.model,
          }
          this.config.profiles = [defaultProfile]
          this.config.activeProfileId = defaultProfile.id
          this.saveConfig()
        }

        // KNUTH-FIX 2026-07-08: loadConfig 也需要把 active profile 同步到顶层
        // apiKey/baseUrl/model —— 否则多 profile 模式下用户重启后顶层 apiKey 为空,
        // 触发 start() 误判 "API Key not configured"。updateConfig 已经做了同步,
        // loadConfig 之前漏了。
        this.syncActiveProfileToTopLevel()
      }
    } catch (error) {
      logger.error('Failed to load AgentX config:', String(error))
    }
  }

  /**
   * KNUTH-FIX 2026-07-08: 把 active profile 的 apiKey/baseUrl/model 同步到顶层字段。
   *
   * 顶层字段（apiKey/baseUrl/model）由 Claude SDK 配置直接消费。多 profile 架构下
   * 真实值存在 profiles[activeProfileId] 里，必须显式同步。loadConfig 和
   * updateConfig 都需要在末尾调用一次。
   */
  private syncActiveProfileToTopLevel(): void {
    if (this.config.profiles?.length && this.config.activeProfileId) {
      const active = this.config.profiles.find(
        (p) => p.id === this.config.activeProfileId
      )
      if (active) {
        // KNUTH-FIX 2026-07-08: 当 active profile 的 apiKey 为空时, 不要把
        // 顶层 apiKey 也覆盖成空 —— 用户可能因为误操作 (handleActivate 没
        // 校验空 key) 切换到了一个未配置 profile, 这会把上一轮的非空 key
        // 静默清掉, 之后所有 start()/getConfig() 拿到的都是空。
        // 只在 active.apiKey 非空时才向下覆盖, 否则保留当前顶层值。
        if (active.apiKey) {
          this.config.apiKey = active.apiKey
          this.config.baseUrl = active.baseUrl
          this.config.model = active.model
        } else {
          logger.warn(
            `[AgentX] active profile "${active.name}" (${this.config.activeProfileId}) has empty apiKey; keeping top-level values. ` +
            `Please set API Key in Settings → AgentX Profiles.`
          )
        }
      }
    }
  }

  private saveConfig(): void {
    try {
      const persisted = this.serializeConfig(this.config)
      fs.writeFileSync(this.configPath, JSON.stringify(persisted, null, 2))
    } catch (error) {
      logger.error('Failed to save AgentX config:', String(error))
    }
  }

  private serializeConfig(config: AgentXConfig): PersistedAgentXConfig {
    return {
      ...config,
      apiKey: this.encryptSecret(config.apiKey),
      profiles: config.profiles?.map(profile => ({
        ...profile,
        apiKey: this.encryptSecret(profile.apiKey),
      })),
    }
  }

  private deserializeConfig(config: PersistedAgentXConfig): AgentXConfig {
    return {
      ...config,
      apiKey: this.decryptSecret(config.apiKey),
      profiles: config.profiles?.map(profile => ({
        ...profile,
        apiKey: this.decryptSecret(profile.apiKey),
      })),
    }
  }

  private encryptSecret(value: string): string {
    if (!value) {
      return value
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return value
    }
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }

  private decryptSecret(value: string): string {
    if (!value) {
      return value
    }
    if (!value.startsWith('enc:')) {
      return value
    }
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        // KNUTH-FIX 2026-07-08: safeStorage 不可用时不要直接返回 '' (会丢 key)。
        // 兜底方案: 尝试把 base64 当成 raw utf-8 解码 (兼容历史上非加密存储的 value)。
        // 解不出来再返回 '' —— 至少不再静默丢数据。
        logger.warn(
          'safeStorage unavailable while decrypting AgentX secret; falling back to raw base64'
        )
        try {
          return Buffer.from(value.slice(4), 'base64').toString('utf-8')
        } catch (fallbackError) {
          logger.warn('Raw base64 fallback also failed:', String(fallbackError))
          return ''
        }
      }
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch (error) {
      logger.warn('Failed to decrypt AgentX secret:', String(error))
      return ''
    }
  }

  getConfig(): AgentXConfig {
    return { ...this.config }
  }

  async updateConfig(newConfig: Partial<AgentXConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig }

    // Sync active profile's fields to top-level apiKey/baseUrl/model
    this.syncActiveProfileToTopLevel()

    this.saveConfig()

    // KNUTH-FEAT 2026-07-08: 广播 config 变更给所有 window。
    // 之前 settings 改完配置, AgentX 窗口的 useEffect ([] deps) 不重跑,
    // 一直停在 "未配置" 占位, 必须关重开窗口才能恢复。
    this.broadcastConfigChanged()

    // 如果服务正在运行，重启以应用新配置
    if (this.isRunning) {
      await this.stop()
      await this.start()
    }
  }

  /**
   * 广播 config 变更给所有 BrowserWindow 的 webContents。
   * 渲染端 AgentX 窗口会监听此事件并重新检查配置 + 重试启动。
   */
  private broadcastConfigChanged(): void {
    const payload = { config: this.getConfig() }
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send('agentx:configChanged', payload)
      } catch (err) {
        // 单个 window 失败不影响其他 window
        logger.debug('Failed to broadcast agentx:configChanged to a window:', String(err))
      }
    }
  }

  async testConnection(config: Partial<AgentXConfig>): Promise<{ success: boolean; error?: string }> {
    const testConfig = { ...this.config, ...config }

    if (!testConfig.apiKey) {
      return { success: false, error: 'API Key is required' }
    }

    try {
      // 使用 fetch 直接测试 Anthropic API
      const response = await fetch(`${testConfig.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': testConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: testConfig.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })

      if (response.ok) {
        return { success: true }
      }

      const errorData = await response.json().catch(() => ({}))
      const errorMessage = (errorData as any)?.error?.message || `HTTP ${response.status}`
      return { success: false, error: errorMessage }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  async start(): Promise<void> {
    LoggerFactoryImpl.configure({ defaultLevel: 'warn' })

    if (this.isRunning) {
      logger.info('AgentX service is already running')
      return
    }

    if (!this.config.apiKey) {
      // KNUTH-FIX 2026-07-08: 之前静默 return,导致 IPC 端 agentx:start 返回
      // { success: true }（虚假成功），用户看到的"未配置"提示无具体错误。
      // 改为 throw,让 IPC 端把 error message 透传到 UI。
      throw new Error('API Key not configured. Please set it in Settings → AgentX Profiles.')
    }

    try {
      logger.info('Starting AgentX service...')

      // Get the path to mcp-office server
      const mcpOfficePath = this.getMcpOfficePath()
      logger.info(`MCP Office path: ${mcpOfficePath}`)

      // Build MCP servers config
      const mcpServers: Record<string, any> = {}

      // Add built-in Perseng MCP server
      const persengUrl = this.getPersengMcpUrl()
      mcpServers['promptx'] = {
        type: 'http',
        url: persengUrl,
      }
      logger.info(`Perseng MCP URL: ${persengUrl}`)

      // Add built-in mcp-office server
      // Use Electron's built-in Node.js (ELECTRON_RUN_AS_NODE=1) so it works
      // even if the user doesn't have Node.js installed on their system.
      // On macOS, prefer the Helper binary to avoid Dock icon flicker.
      if (mcpOfficePath) {
        const mcpCommand = process.env.PERSENG_MAC_HELPER_PATH || process.execPath
        mcpServers['mcp-office'] = {
          command: mcpCommand,
          args: [mcpOfficePath],
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
          },
        }
      }

      // Add built-in mcp-workspace server (stdio)
      const mcpWorkspacePath = this.getMcpWorkspacePath()
      if (mcpWorkspacePath) {
        const mcpCommand = process.env.PERSENG_MAC_HELPER_PATH || process.execPath
        mcpServers['mcp-workspace'] = {
          command: mcpCommand,
          args: [mcpWorkspacePath, '--transport', 'stdio'],
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
          },
        }
      }

      // Add user-configured MCP servers
      if (this.config.mcpServers) {
        for (const server of this.config.mcpServers) {
          if (server.enabled && server.name) {
            const { name, enabled, builtin, description, ...config } = server
            // 支持 stdio (command) 或 http/sse (type + url)
            if (config.command || config.url) {
              mcpServers[server.name] = config
            }
          }
        }
      }

      const built = await createAgentXRuntime({
        agentxDir: this.agentxDir,
        llm: {
          apiKey: this.config.apiKey,
          baseUrl: this.config.baseUrl,
          model: this.config.model,
        },
        claudeCodePath: this.getClaudeAgentSdkCliPath(),
        defaultAgent: {
          name: 'Perseng Agent',
          mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
        },
      })
      this.agentx = built.facade
      this.runtime = built.runtime
      this.wsServer = built.wsServer
      this.eventQueue = built.eventQueue

      // Subscribe to image_create_response to setup .claude settings for new conversations
      this.imageCreateUnsubscribe = this.agentx.onCommand('image_create_response', (event: any) => {
        if (event.data.record?.imageId) {
          this.setupClaudeSettings(event.data.record.imageId)
        }
      })

      await this.agentx.listen(this.port, this.externalAccess ? '0.0.0.0' : '127.0.0.1')
      this.isRunning = true

      // 旁路挂载时间线捕获：直接绑到 runtime.onAny，拿到 SystemBus 全量事件
      // （包含 source==='environment' 的 tool_*/text_* 流式事件，facade 过滤掉的那些）。
      // KNUTH-FEAT 2026-07-04: 见 plan 方案 A。
      try {
        const { getEventLog, attachEventLogger } = await import('@promptx/mcp-server/timeline')
        // KNUTH-FIX 2026-07-05: attachEventLogger 的 EventSource/EventLog 类型 vs TimelineAttacher 的
        // 局部 TimelineLogLike 接口结构不严格对齐（前者 log 字段更多），用 cast 兜底；
        // 运行时合法（attachEventLogger 实际接受任何带 onAny/on 的 bus）。
        this.detachTimeline = built.attachTimeline(attachEventLogger as any, getEventLog())
        logger.info('Timeline event capture attached (onAny mode)')
      } catch (err) {
        logger.warn('Failed to attach timeline capture (non-fatal):', String(err))
      }

      logger.info(`AgentX service started on ws://${this.externalAccess ? '0.0.0.0' : 'localhost'}:${this.port}`)
    } catch (error) {
      logger.error('Failed to start AgentX service:', String(error))
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.agentx) {
      logger.info('AgentX service is not running')
      return
    }

    try {
      logger.info('Stopping AgentX service...')

      // Unsubscribe from image_create_response
      if (this.imageCreateUnsubscribe) {
        this.imageCreateUnsubscribe()
        this.imageCreateUnsubscribe = null
      }

      // Detach timeline capture (best effort)
      if (this.detachTimeline) {
        try {
          this.detachTimeline()
        } catch (err) {
          logger.warn('Failed to detach timeline capture:', String(err))
        }
        this.detachTimeline = null
      }

      // KNUTH-FEAT 2026-07-04: 显式按 facade.dispose 的顺序释放
      // wsServer → runtime → eventQueue（参见 createAgentXRuntime.facade.dispose）。
      // 直接走子引用，让调用栈上释放步骤可见，便于排查 stop 阶段异常。
      try {
        await this.wsServer?.dispose()
      } catch (err) {
        logger.warn('Failed to dispose wsServer:', String(err))
      }
      try {
        await this.runtime?.dispose()
      } catch (err) {
        logger.warn('Failed to dispose runtime:', String(err))
      }
      try {
        await this.eventQueue?.close()
      } catch (err) {
        logger.warn('Failed to close eventQueue:', String(err))
      }
      this.agentx = null
      this.runtime = null
      this.wsServer = null
      this.eventQueue = null
      this.isRunning = false
      logger.info('AgentX service stopped')
    } catch (error) {
      logger.error('Failed to stop AgentX service:', String(error))
      throw error
    }
  }

  /**
   * Setup .claude/settings.json in the workdir for a conversation
   */
  private setupClaudeSettings(imageId: string): void {
    try {
      // The workdir path pattern: {agentxDir}/containers/perseng-desktop/workdirs/{imageId}
      const workdirPath = path.join(this.agentxDir, 'containers', 'perseng-desktop', 'workdirs', imageId)
      const claudeDir = path.join(workdirPath, '.claude')
      const settingsPath = path.join(claudeDir, 'settings.json')

      // Create .claude directory if it doesn't exist
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true })
      }

      // Write settings.json
      const settings = {
        skipWebFetchPreflight: true
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

      // Link ~/.claude/skills/ into workdir via junction (Windows) or symlink (Unix)
      // This avoids file duplication while making skills available without loading
      // the full user settings (which may contain conflicting permissions/config).
      this.linkSkillsToWorkdir(claudeDir)

      logger.info(`Created .claude/settings.json for image: ${imageId}`)
    } catch (error) {
      logger.error(`Failed to setup .claude settings for image ${imageId}:`, String(error))
    }
  }

  /**
   * Create a junction/symlink from workdir's .claude/skills/ → {userData}/skills/
   * so Claude Code can discover skills without loading the full user settings file.
   * Windows: junction (no admin required); Unix/macOS: symlink
   */
  private linkSkillsToWorkdir(claudeDir: string): void {
    try {
      const skillsSourceDir = this.getSkillsDir()
      const localSkillsLink = path.join(claudeDir, 'skills')

      // Ensure the skills source dir exists
      if (!fs.existsSync(skillsSourceDir)) {
        fs.mkdirSync(skillsSourceDir, { recursive: true })
      }

      // Remove existing link/dir if present (lstatSync detects broken symlinks too)
      try {
        const stat = fs.lstatSync(localSkillsLink)
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          fs.rmSync(localSkillsLink, { recursive: true, force: true })
        }
      } catch {
        // Path doesn't exist, nothing to remove
      }

      // Windows: junction (no admin required); Unix/macOS: regular symlink
      if (process.platform === 'win32') {
        fs.symlinkSync(skillsSourceDir, localSkillsLink, 'junction')
      } else {
        fs.symlinkSync(skillsSourceDir, localSkillsLink)
      }
      logger.info(`Linked skills into workdir: ${localSkillsLink} → ${skillsSourceDir}`)
    } catch (error) {
      logger.warn(`Failed to link skills into workdir: ${String(error)}`)
    }
  }

  /**
   * Get the path to @anthropic-ai/claude-agent-sdk cli.js
   * In packaged app, it lives in app.asar.unpacked (not inside app.asar)
   */
  private getClaudeAgentSdkCliPath(): string | undefined {
    // Packaged: app.asar.unpacked takes priority
    const unpackedPath = path.join(
      process.resourcesPath || '',
      'app.asar.unpacked',
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
      'cli.js'
    )
    if (fs.existsSync(unpackedPath)) {
      logger.info(`Claude Agent SDK cli.js found at: ${unpackedPath}`)
      return unpackedPath
    }
    // Development: resolve from node_modules
    try {
      const resolved = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
      logger.info(`Claude Agent SDK cli.js resolved: ${resolved}`)
      return resolved
    } catch {
      logger.warn('Claude Agent SDK cli.js not found, using SDK default')
      return undefined
    }
  }

  /**
   * Get the path to mcp-office server
   */
  private getMcpOfficePath(): string {
    // In development, use the workspace package
    // In production, it will be bundled with the app
    const devPath = path.join(__dirname, '../../../../packages/mcp-office/dist/index.js')
    const prodPath = path.join(process.resourcesPath || '', 'mcp-office/index.js')

    if (fs.existsSync(devPath)) {
      return devPath
    }
    if (fs.existsSync(prodPath)) {
      return prodPath
    }

    // Fallback: try to find in node_modules
    const nodeModulesPath = path.join(__dirname, '../../../node_modules/@promptx/mcp-office/dist/index.js')
    if (fs.existsSync(nodeModulesPath)) {
      return nodeModulesPath
    }

    // Last resort: use require.resolve
    try {
      return require.resolve('@promptx/mcp-office')
    } catch {
      logger.warn('MCP Office server not found, Office document reading will not be available')
      return ''
    }
  }

  /**
   * Get the path to mcp-workspace server (mcp-server.js entry)
   */
  private getMcpWorkspacePath(): string {
    const devPath = path.join(__dirname, '../../../../packages/mcp-workspace/dist/mcp-server.js')
    const prodPath = path.join(process.resourcesPath || '', 'mcp-workspace/mcp-server.js')

    if (fs.existsSync(devPath)) {
      return devPath
    }
    if (fs.existsSync(prodPath)) {
      return prodPath
    }

    const nodeModulesPath = path.join(__dirname, '../../../node_modules/@promptx/mcp-workspace/dist/mcp-server.js')
    if (fs.existsSync(nodeModulesPath)) {
      return nodeModulesPath
    }

    try {
      return require.resolve('@promptx/mcp-workspace/mcp-server')
    } catch {
      logger.warn('MCP Workspace server not found, workspace file access will not be available')
      return ''
    }
  }

  getPort(): number {
    return this.port
  }

  async setExternalAccess(enabled: boolean): Promise<void> {
    this.externalAccess = enabled
    if (this.isRunning) {
      await this.stop()
      await this.start()
    }
  }

  getExternalAccess(): boolean {
    return this.externalAccess
  }

  getStatus(): boolean {
    return this.isRunning
  }

  getServerUrl(): string {
    return `ws://localhost:${this.port}`
  }

  /**
   * 获取所有 MCP 服务器配置（包括内置的）
   */
  getMcpServers(): MCPServerConfig[] {
    const servers: MCPServerConfig[] = []

    // 添加内置的 Perseng MCP 服务器（从系统配置获取地址）
    const persengUrl = this.getPersengMcpUrl()
    servers.push({
      name: 'promptx',
      type: 'http',
      url: persengUrl,
      enabled: true,
      builtin: true,
      description: 'Perseng MCP Server (Roles, Tools, Memory)',
    })

    // 添加内置的 mcp-office 服务器
    const mcpOfficePath = this.getMcpOfficePath()
    if (mcpOfficePath) {
      servers.push({
        name: 'mcp-office',
        command: 'node',
        args: [mcpOfficePath],
        enabled: true,
        builtin: true,
        description: 'Office document reader (Word, Excel, PDF)',
      })
    }

    // 添加内置的 mcp-workspace 服务器
    const mcpWorkspacePath = this.getMcpWorkspacePath()
    if (mcpWorkspacePath) {
      servers.push({
        name: 'mcp-workspace',
        command: 'node',
        args: [mcpWorkspacePath, '--transport', 'stdio'],
        enabled: true,
        builtin: true,
        description: 'Workspace file explorer (Browse, read, write local files)',
      })
    }

    // 添加用户配置的服务器
    if (this.config.mcpServers) {
      servers.push(...this.config.mcpServers)
    }

    return servers
  }

  /**
   * 获取 Perseng MCP 服务器 URL（从系统配置读取）
   */
  private getPersengMcpUrl(): string {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json')
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8')
        const config = JSON.parse(data)
        const host = config.host || '127.0.0.1'
        const port = config.port || 5203
        return `http://${host}:${port}/mcp`
      }
    } catch (error) {
      logger.error('Failed to read Perseng server config:', String(error))
    }
    // 默认地址
    return 'http://127.0.0.1:5203/mcp'
  }

  /**
   * 获取 skills 目录路径
   */
  getSkillsDir(): string {
    return path.join(app.getPath('userData'), 'skills')
  }

  /**
   * 从 SKILL.md 中提取描述信息（取第一行非空非标题行，或第一个标题）
   */
  private extractDescriptionFromSkillMd(content: string): string {
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // 如果是标题行，去掉 # 前缀作为描述
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/^#+\s*/, '')
      }
      return trimmed
    }
    return ''
  }

  /**
   * 获取所有可用的 Skills（从 skills 目录获取）
   * 支持 skill.json 和 SKILL.md 两种格式
   */
  async getAvailableSkills(): Promise<{ name: string; description: string; version?: string }[]> {
    try {
      const skillsDir = this.getSkillsDir()
      if (!fs.existsSync(skillsDir)) {
        return []
      }

      const skills: { name: string; description: string; version?: string }[] = []
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillJsonPath = path.join(skillsDir, entry.name, 'skill.json')
          const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')

          if (fs.existsSync(skillJsonPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(skillJsonPath, 'utf-8'))
              skills.push({
                name: entry.name,
                description: data.description || '',
                version: data.version || '1.0.0',
              })
            } catch {
              // 忽略解析失败的 skill
            }
          } else if (fs.existsSync(skillMdPath)) {
            try {
              const content = fs.readFileSync(skillMdPath, 'utf-8')
              skills.push({
                name: entry.name,
                description: this.extractDescriptionFromSkillMd(content),
              })
            } catch {
              // 忽略读取失败的 skill
            }
          }
        }
      }

      return skills
    } catch (error) {
      logger.error('Failed to get available skills:', String(error))
      return []
    }
  }

  /**
   * 获取已启用的 Skills 列表
   */
  getEnabledSkills(): string[] {
    return this.config.enabledSkills || []
  }

  /**
   * 更新启用的 Skills 列表
   */
  async updateEnabledSkills(skills: string[]): Promise<void> {
    await this.updateConfig({ enabledSkills: skills })
  }

  /**
   * 导入 Skill（从 zip 压缩包）
   * zip 内应包含一个文件夹，文件夹内有 SKILL.md 文件
   */
  async importSkill(zipPath: string): Promise<{ success: boolean; skillName?: string; error?: string }> {
    try {
      if (!fs.existsSync(zipPath)) {
        return { success: false, error: 'File not found' }
      }

      // 创建临时目录
      const tempDir = path.join(os.tmpdir(), `perseng-skill-import-${Date.now()}`)
      fs.mkdirSync(tempDir, { recursive: true })

      try {
        // 解压
        const zip = new AdmZip(zipPath)
        zip.extractAllTo(tempDir, true)

        // 查找包含 SKILL.md 的目录
        let skillDir: string | null = null
        let skillName: string | null = null

        const entries = fs.readdirSync(tempDir)

        // 情况1: 根目录直接有 SKILL.md
        if (entries.includes('SKILL.md')) {
          skillDir = tempDir
          // 用 zip 文件名作为 skill 名称
          skillName = path.basename(zipPath, '.zip')
        } else {
          // 情况2: 一级子目录中有 SKILL.md
          for (const entry of entries) {
            const subDir = path.join(tempDir, entry)
            if (fs.statSync(subDir).isDirectory()) {
              const subEntries = fs.readdirSync(subDir)
              if (subEntries.includes('SKILL.md')) {
                skillDir = subDir
                skillName = entry
                break
              }
            }
          }
        }

        if (!skillDir || !skillName) {
          return { success: false, error: 'Invalid skill structure: SKILL.md not found' }
        }

        // 确保 skills 目录存在
        const skillsDir = this.getSkillsDir()
        fs.mkdirSync(skillsDir, { recursive: true })

        // 目标目录
        const targetDir = path.join(skillsDir, skillName)

        // 如果已存在则覆盖
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }

        // 复制文件
        this.copyDirSync(skillDir, targetDir)

        return { success: true, skillName }
      } finally {
        // 清理临时目录
        try {
          fs.rmSync(tempDir, { recursive: true, force: true })
        } catch {
          // ignore cleanup errors
        }
      }
    } catch (error) {
      logger.error('Failed to import skill:', String(error))
      return { success: false, error: String(error) }
    }
  }

  /**
   * 递归复制目录
   */
  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true })
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  /**
   * 删除 Skill
   */
  async deleteSkill(skillName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const skillDir = path.join(this.getSkillsDir(), skillName)
      if (!fs.existsSync(skillDir)) {
        return { success: false, error: 'Skill not found' }
      }

      fs.rmSync(skillDir, { recursive: true, force: true })

      // 从已启用列表中移除
      const enabled = this.getEnabledSkills()
      if (enabled.includes(skillName)) {
        await this.updateEnabledSkills(enabled.filter(s => s !== skillName))
      }

      return { success: true }
    } catch (error) {
      logger.error('Failed to delete skill:', String(error))
      return { success: false, error: String(error) }
    }
  }

  /**
   * 更新用户配置的 MCP 服务器（不包括内置的）
   */
  async updateMcpServers(servers: MCPServerConfig[]): Promise<void> {
    // 过滤掉内置服务器，只保存用户配置的
    const userServers = servers.filter(s => !s.builtin)
    await this.updateConfig({ mcpServers: userServers })
  }
}

export const agentXService = new AgentXService()
