// Import polyfills first, before any other modules
import '~/main/polyfills'

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { TrayPresenter } from '~/main/tray/TrayPresenter'
import { PersengServerAdapter } from '~/main/infrastructure/adapters/PersengServerAdapter'
import { FileConfigAdapter } from '~/main/infrastructure/adapters/FileConfigAdapter'
import { ElectronNotificationAdapter } from '~/main/infrastructure/adapters/ElectronNotificationAdapter'
import { StartServerUseCase } from '~/main/application/useCases/StartServerUseCase'
import { StopServerUseCase } from '~/main/application/useCases/StopServerUseCase'
import { UpdateManager } from '~/main/application/UpdateManager'
import { AutoStartService } from '~/main/application/AutoStartService'
import { ElectronAutoStartAdapter } from '~/main/infrastructure/adapters/ElectronAutoStartAdapter'
import { AutoStartWindow } from '~/main/windows/AutoStartWindow'
import { CognitionWindow } from '~/main/windows/CognitionWindow'
import { agentXService } from '~/main/services/AgentXService'
import { webAccessService } from '~/main/services/WebAccessService'
import { FeishuManager } from '~/main/services/feishu'
import { workspaceService } from '~/main/services/WorkspaceService'
import { getEventLog } from '@promptx/mcp-server/timeline'
import { scanPersengHome, querySqlite } from '~/main/services/DatabaseManager'
import * as logger from '@promptx/logger'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { mainI18n } from '~/main/i18n'
import { ServerConfig } from '~/main/domain/entities/ServerConfig'
import { ServerConfigManager } from '@promptx/config'
import { migratePromptXHomeIfNeeded, getPersengHomeDir } from '~/main/utils/persengPaths'

class PersengDesktopApp {
  private trayPresenter: TrayPresenter | null = null
  private serverPort: PersengServerAdapter | null = null
  private configPort: FileConfigAdapter | null = null
  private notificationPort: ElectronNotificationAdapter | null = null
  private updateManager: UpdateManager | null = null
  private autoStartService: AutoStartService | null = null
  private autoStartWindow: AutoStartWindow | null = null
  private feishuManager: FeishuManager | null = null

  async initialize(): Promise<void> {
    // Capture console output to log file (covers @agentxjs/common runtime logs)
    this.setupConsoleCapture()

    logger.info('Initializing Perseng Desktop...')

    // 首次启动自动迁移 ~/.promptx → ~/.perseng(用户在 Phase 5 接入)
    try {
      const migrationResult = await migratePromptXHomeIfNeeded()
      if (migrationResult.migrated) {
        logger.info(`Perseng data migration: ${migrationResult.oldPath} → ${migrationResult.newPath}` +
          (migrationResult.symlinkCreated ? ' (with legacy symlink)' : ''))
      } else if (migrationResult.reason === 'error') {
        logger.warn(`Perseng data migration failed: ${migrationResult.errorMessage}`)
      } else {
        logger.debug(`Perseng data migration: skipped (${migrationResult.reason})`)
      }
    } catch (e) {
      logger.warn(`Perseng data migration exception: ${e instanceof Error ? e.message : String(e)}`)
    }

    // Setup Node.js environment for ToolSandbox
    this.setupNodeEnvironment()

    // Wait for app to be ready
    await app.whenReady()
    logger.info('Electron app ready')

    // Hide dock icon on macOS
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide()
      logger.info('Dock icon hidden (macOS)')
    }

    // === 先创建 autoStartService ===
    const autoStartAdapter = new ElectronAutoStartAdapter({
      name: 'Perseng Desktop',
      path: process.execPath,
      isHidden: true, // 开机启动时隐藏窗口
      mac: { useLaunchAgent: true }  // macOS: 使用 LaunchAgent 更稳定
    })
    this.autoStartService = new AutoStartService(autoStartAdapter)

    // === 创建 autoStartWindow 来处理 IPC ===
    this.autoStartWindow = new AutoStartWindow(this.autoStartService)

    // === 然后设置其他 IPC ===
    this.setupServerConfigIPC()
    this.setupLanguageIPC()
    this.setupLogsIPC()
    this.setupDialogIPC()
    this.setupShellIPC()
    this.setupAgentXIPC()
    this.setupWebAccessIPC()
    this.setupFeishuIPC()
    this.setupWorkspaceIPC()
    this.setupTimelineIPC()
    this.setupDatabaseManagerIPC()

    // Setup infrastructure
    logger.info('Setting up infrastructure...')
    this.setupInfrastructure()

    // Setup application layer
    logger.info('Setting up application layer...')
    const { startUseCase, stopUseCase } = this.setupApplication()

    // Setup UpdateManager BEFORE presentation layer
    logger.info('Setting up update manager...')
    this.updateManager = new UpdateManager()
    logger.info('Update manager initialized')

    // Setup update IPC handlers
    this.setupUpdateIPC()

    // Setup presentation layer
    logger.info('Setting up presentation layer...')
    this.setupPresentation(startUseCase, stopUseCase)

    // Setup CognitionWindow for memory/cognition IPC
    new CognitionWindow()

    // Handle app events
    logger.info('Setting up app events...')
    this.setupAppEvents()

    logger.info('Perseng Desktop initialized successfully')

    // Auto-start server on app launch
    logger.info('Auto-starting Perseng server...')
    try {
      await startUseCase.execute()
      logger.info('Perseng server started automatically')
    } catch (error) {
      const err = String(error);
      logger.error('Failed to auto-start server:', err)
    }

    // Auto-start AgentX service
    logger.info('Auto-starting AgentX service...')
    try {
      await agentXService.start()
      logger.info('AgentX service started automatically')
    } catch (error) {
      const err = String(error);
      logger.error('Failed to auto-start AgentX service:', err)
    }

    // Register global callback for second-instance to open main window
    // This is used by bootstrap.ts when user clicks shortcut while app is running
    ;(global as any).__persengOpenMainWindow = () => {
      this.trayPresenter?.openMainWindow()
    }

    // Auto open main window on startup for better UX
    logger.info('Opening main window...')
    this.trayPresenter?.openMainWindow()

    // Auto check and download updates on startup (non-blocking)
    logger.info('Scheduling automatic update check and download...')
    setTimeout(() => {
      this.updateManager?.autoCheckAndDownload()
    }, 5000) // Delay 5 seconds to let app fully initialize
  }

  private setupConsoleCapture(): void {
    // Forward console output to @promptx/logger (note: package name kept for npm compatibility) so runtime logs are persisted to file.
    // @agentxjs/common uses console.* internally, so this captures SDK/runtime logs.
    let _capturing = false

    const capture = (level: 'info' | 'error' | 'warn' | 'debug', args: unknown[]) => {
      if (_capturing) return
      _capturing = true
      try {
        const msg = args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
        logger[level]('[runtime] ' + msg)
      } catch { /* ignore */ }
      finally { _capturing = false }
    }

    const _log = console.log.bind(console)
    const _error = console.error.bind(console)
    const _warn = console.warn.bind(console)
    const _info = console.info.bind(console)
    const _debug = console.debug.bind(console)

    console.log = (...args) => { _log(...args); capture('info', args) }
    console.error = (...args) => { _error(...args); capture('error', args) }
    console.warn = (...args) => { _warn(...args); capture('warn', args) }
    console.info = (...args) => { _info(...args); capture('info', args) }
    console.debug = (...args) => { _debug(...args); capture('debug', args) }
  }

  private setupNodeEnvironment(): void {
    // Set Node.js executable path for Perseng ToolSandbox
    // In Electron, use the Electron executable which contains Node.js
    process.env.PERSENG_NODE_EXECUTABLE = process.execPath

    // NOTE: ELECTRON_RUN_AS_NODE is NOT set globally anymore
    // It will be set locally only when spawning Node.js processes in ToolSandbox
    // This prevents Chromium internal services from receiving incorrect parameters

    logger.info(`Node.js environment configured for ToolSandbox: ${process.execPath}`)
    logger.info(`ELECTRON_RUN_AS_NODE will be set locally per subprocess to avoid conflicts`)

    // Also set ELECTRON_NODE_PATH for compatibility
    process.env.ELECTRON_NODE_PATH = process.execPath

    // Pass utilityProcess to ToolSandbox via global object
    try {
      const { utilityProcess } = require('electron')
      if (utilityProcess && typeof utilityProcess.fork === 'function') {
        ; (global as any).PERSENG_UTILITY_PROCESS = utilityProcess
        process.env.PERSENG_UTILITY_PROCESS_AVAILABLE = 'true'
        logger.info('UtilityProcess configured for ToolSandbox')
      } else {
        logger.warn('UtilityProcess not available - will fallback to system pnpm')
        process.env.PERSENG_UTILITY_PROCESS_AVAILABLE = 'false'
      }
    } catch (error) {
      logger.error(`Failed to configure UtilityProcess: ${error}`)
      process.env.PERSENG_UTILITY_PROCESS_AVAILABLE = 'false'
    }

    // Update PATH to include Electron directory for child processes
    const electronDir = path.dirname(process.execPath)
    const currentPath = process.env.PATH || ''
    if (!currentPath.includes(electronDir)) {
      process.env.PATH = electronDir + path.delimiter + currentPath
      logger.debug(`Updated PATH with Electron directory: ${electronDir}`)
    }

    // On Windows: ensure node.exe is in PATH for Claude Code subprocess
    // In packaged Electron apps, system PATH may not include these
    if (process.platform === 'win32') {
      this.ensureWindowsToolsInPath()
    }

    // On macOS: detect Electron Helper binary to avoid Dock icon flicker
    // The Helper binary has LSUIElement=true in its Info.plist, so macOS won't
    // show a Dock icon when it's spawned as a child process.
    if (process.platform === 'darwin') {
      this.detectMacHelperBinary()
    }
  }

  private detectMacHelperBinary(): void {
    const appName = path.basename(process.execPath)
    const helperPath = path.join(
      path.dirname(process.execPath),
      '..', 'Frameworks',
      `${appName} Helper.app`,
      'Contents', 'MacOS',
      `${appName} Helper`
    )
    if (fs.existsSync(helperPath)) {
      process.env.PERSENG_MAC_HELPER_PATH = helperPath
      logger.info(`macOS Helper binary detected: ${helperPath}`)
    } else {
      logger.info('macOS Helper binary not found, using main binary for subprocesses')
    }
  }

  private ensureWindowsToolsInPath(): void {
    const { execSync } = require('child_process')
    const { app } = require('electron')

    // --- Ensure node.exe is in PATH ---
    const hasNode = (process.env.PATH || '').split(path.delimiter).some(dir => {
      try { return fs.existsSync(path.join(dir, 'node.exe')) } catch { return false }
    })

    if (!hasNode) {
      let nodeDir: string | null = null
      try {
        const out = execSync('where node 2>nul', { encoding: 'utf8', timeout: 3000 }).trim()
        const first = out.split('\n')[0]?.trim()
        if (first && fs.existsSync(first)) nodeDir = path.dirname(first)
      } catch { /* ignore */ }

      if (!nodeDir) {
        const candidates = [
          'C:\\Program Files\\nodejs',
          'C:\\Program Files (x86)\\nodejs',
          path.join(process.env.LOCALAPPDATA || '', 'Programs\\nodejs'),
          path.join(process.env.APPDATA || '', 'nvm\\current'),
        ]
        nodeDir = candidates.find(p => { try { return fs.existsSync(path.join(p, 'node.exe')) } catch { return false } }) ?? null
      }

      if (nodeDir) {
        process.env.PATH = nodeDir + path.delimiter + (process.env.PATH || '')
        logger.info(`Added node to PATH: ${nodeDir}`)
      } else {
        // Last resort: create a node.cmd wrapper using Electron's built-in Node.js
        try {
          const binDir = path.join(app.getPath('userData'), 'bin')
          if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true })
          const nodeCmdPath = path.join(binDir, 'node.cmd')
          fs.writeFileSync(nodeCmdPath, `@echo off\nset ELECTRON_RUN_AS_NODE=1\n"${process.execPath}" %*\n`)
          process.env.PATH = binDir + path.delimiter + (process.env.PATH || '')
          logger.info(`Created node.cmd wrapper (Electron as Node): ${nodeCmdPath}`)
        } catch (e) {
          logger.warn(`node.exe not found and fallback failed: ${e}`)
        }
      }
    }
  }

  private setupServerConfigIPC(): void {
    ipcMain.handle('server-config:get', async () => {
      if (!this.configPort) {
        return ServerConfig.default().toJSON()
      }
      const res = await this.configPort.load()
      if (res.ok) {
        return res.value.toJSON()
      }
      // 加载失败则返回默认
      return ServerConfig.default().toJSON()
    })

    ipcMain.handle('server-config:update', async (_event, payload: { host: string; port: number; debug?: boolean; enableV2?: boolean }) => {
      const base = ServerConfig.default().toJSON()
      const created = ServerConfig.create({
        ...base,
        host: payload.host,
        port: payload.port,
        debug: payload.debug ?? base.debug,
        enableV2: payload.enableV2 ?? base.enableV2
      })
      if (!created.ok) {
        throw new Error(created.error.message)
      }
      const cfg = created.value
      // 持久化
      if (this.configPort) {
        const saveRes = await this.configPort.save(cfg)
        if (!saveRes.ok) {
          throw new Error(saveRes.error.message)
        }
      }
      // 同步 enableV2 到 ServerConfigManager（供 MCP server 读取）
      const scm = new ServerConfigManager()
      scm.setEnableV2(cfg.enableV2)
      // 应用配置（重启服务）
      if (this.serverPort) {
        const restartRes = await this.serverPort.restart(cfg)
        if (!restartRes.ok) {
          throw new Error(restartRes.error.message)
        }
      }
      return cfg.toJSON()
    })

    ipcMain.handle('server-config:reset', async () => {
      const cfg = ServerConfig.default()
      // 重置持久化文件
      if (this.configPort) {
        const resetRes = await this.configPort.reset()
        if (!resetRes.ok) {
          // 如果 reset 不可用或失败，则直接 save 默认
          const saveRes = await this.configPort.save(cfg)
          if (!saveRes.ok) {
            throw new Error(saveRes.error.message)
          }
        }
      }
      // 应用默认配置
      if (this.serverPort) {
        const restartRes = await this.serverPort.restart(cfg)
        if (!restartRes.ok) {
          throw new Error(restartRes.error.message)
        }
      }
      return cfg.toJSON()
    })
  }

  private setupLanguageIPC(): void {
    // 获取当前语言设置
    ipcMain.handle('settings:getLanguage', async () => {
      try {
        const configPath = path.join(app.getPath('userData'), 'language.json')
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
          return config.language || 'en'
        }
        return 'en' // 默认英文
      } catch (error) {
        logger.error('Failed to get language setting:', String(error))
        return 'en'
      }
    })

    // 设置语言
    ipcMain.handle('settings:setLanguage', async (_event, language: string) => {
      try {
        const configPath = path.join(app.getPath('userData'), 'language.json')
        const config = { language }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        
        // 更新主进程的i18n语言设置
        mainI18n.setLocale(language)
        
        // 如果托盘已经初始化，重新构建菜单以应用新语言
        if (this.trayPresenter) {
          await this.trayPresenter.refreshMenu()
          logger.info(`Tray menu refreshed with new language: ${language}`)
        }
        
        logger.info(`Language set to: ${language}`)
        return { success: true }
      } catch (error) {
        logger.error('Failed to set language:', String(error))
        throw new Error('Failed to save language setting')
      }
    })
  }

  private setupLogsIPC(): void {
    // 用户数据目录已迁移到 ~/.perseng;getPersengHomeDir() 内部优先读新路径,旧路径作为兜底兼容
    const logsDir = path.join(getPersengHomeDir(), 'logs')

    // 获取日志文件列表
    ipcMain.handle('logs:list', async () => {
      try {
        if (!fs.existsSync(logsDir)) {
          return { success: true, logs: [] }
        }

        const files = fs.readdirSync(logsDir)
        const logs = files
          .filter(file => file.startsWith('perseng-') && file.endsWith('.log'))
          .map(file => {
            const filePath = path.join(logsDir, file)
            try {
              const stats = fs.statSync(filePath)
              const isError = file.includes('error')

              return {
                name: file,
                path: filePath,
                size: stats.size,
                modified: stats.mtime,
                type: isError ? 'error' : 'normal'
              }
            } catch {
              // 文件可能在读取期间被删除或锁定，跳过
              return null
            }
          })
          .filter((log): log is NonNullable<typeof log> => log !== null)
          .sort((a, b) => b.modified.getTime() - a.modified.getTime())

        return { success: true, logs }
      } catch (error) {
        logger.error('Failed to list logs:', String(error))
        return { success: false, error: String(error) }
      }
    })

    // 读取日志文件内容
    ipcMain.handle('logs:read', async (_event, filename: string) => {
      try {
        const filePath = path.join(logsDir, filename)

        if (!fs.existsSync(filePath)) {
          return { success: false, error: 'Log file not found' }
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        return { success: true, content }
      } catch (error) {
        logger.error('Failed to read log:', String(error))
        return { success: false, error: String(error) }
      }
    })

    // 删除日志文件
    ipcMain.handle('logs:delete', async (_event, filename: string) => {
      try {
        const filePath = path.join(logsDir, filename)

        if (!fs.existsSync(filePath)) {
          return { success: false, error: 'Log file not found' }
        }

        fs.unlinkSync(filePath)
        logger.info(`Log file deleted: ${filename}`)
        return { success: true }
      } catch (error) {
        logger.error('Failed to delete log:', String(error))
        return { success: false, error: String(error) }
      }
    })

    // 清空所有日志
    ipcMain.handle('logs:clear', async () => {
      try {
        if (!fs.existsSync(logsDir)) {
          return { success: true, deleted: 0 }
        }

        const files = fs.readdirSync(logsDir)
        let deleted = 0
        let skipped = 0

        for (const file of files) {
          if (file.startsWith('perseng-') && file.endsWith('.log')) {
            const filePath = path.join(logsDir, file)
            try {
              fs.unlinkSync(filePath)
              deleted++
            } catch {
              // 文件可能被锁定（如当前正在写入的日志），跳过
              skipped++
            }
          }
        }

        if (deleted > 0 || skipped === 0) {
          logger.info(`Cleared ${deleted} log files${skipped > 0 ? `, ${skipped} skipped (in use)` : ''}`)
        }
        return { success: true, deleted }
      } catch (error) {
        logger.error('Failed to clear logs:', String(error))
        return { success: false, error: String(error) }
      }
    })
  }

  /**
   * 活动事件流时间线 IPC 桥接
   * 旁路订阅 SystemBus → 写入 ~/.perseng/timeline/events.db
   * 主进程直接 import @promptx/mcp-server/timeline（共享单例）
   */
  private setupTimelineIPC(): void {
    // 防止重复注册
    if ((this as any)._timelineIpcRegistered) return
    ;(this as any)._timelineIpcRegistered = true

    ipcMain.handle('timeline:query', async (_event, filter: any = {}) => {
      try {
        const log = getEventLog()
        const limit = filter.limit ?? 50
        const rows = await log.query(filter)
        const total = await log.count({
          sessionId: filter.sessionId,
          agentId: filter.agentId,
          imageId: filter.imageId,
          types: filter.types,
          roles: filter.roles,
          sinceTs: filter.sinceTs,
          untilTs: filter.untilTs,
        })
        const nextCursor =
          rows.length === limit && rows.length > 0 ? rows[rows.length - 1].id : null
        return { success: true, events: rows, total, nextCursor }
      } catch (error) {
        logger.error('Failed to query timeline:', String(error))
        return { success: false, error: String(error), events: [], total: 0, nextCursor: null }
      }
    })

    ipcMain.handle('timeline:clear', async (_event, filter: { scope?: 'all' | 'session' | 'agent' | 'image'; targetId?: string } = {}) => {
      try {
        const log = getEventLog()
        const result = await log.clear(filter)
        logger.info(`[timeline:clear] deleted ${result.deleted} events (scope=${filter.scope ?? 'all'})`)
        return { success: true, ...result }
      } catch (error) {
        logger.error('Failed to clear timeline:', String(error))
        return { success: false, error: String(error), deleted: 0 }
      }
    })

    ipcMain.handle('timeline:statistics', async () => {
      try {
        const log = getEventLog()
        return await log.getStatistics()
      } catch (error) {
        logger.error('Failed to get timeline statistics:', String(error))
        return { totalEvents: 0, dbPath: '' }
      }
    })
  }

  /**
   * 数据库管理 IPC 桥接
   * 轻量版：递归扫 ~/.perseng/ 下所有 .db 和 .json 文件，
   * 对已知 schema 的 db（timeline / engrams）做行数和时间范围统计，
   * 其他 db / json 只列文件信息。零破坏性：所有操作只读，不修改任何 db。
   */
  private setupDatabaseManagerIPC(): void {
    if ((this as any)._dbManagerIpcRegistered) return
    ;(this as any)._dbManagerIpcRegistered = true

    ipcMain.handle('dbManager:scan', async () => {
      try {
        const root = getPersengHomeDir()
        const items = scanPersengHome(root)
        const totals = {
          totalSize: items.reduce((s, i) => s + i.size, 0),
          dbCount: items.filter((i) => i.type === 'sqlite').length,
          jsonCount: items.filter((i) => i.type === 'json').length,
          rootDir: root,
          scannedAt: Date.now(),
        }
        return { success: true, items, totals }
      } catch (error) {
        logger.error('Failed to scan perseng home:', String(error))
        return { success: false, error: String(error), items: [], totals: null }
      }
    })

    ipcMain.handle('dbManager:openDir', async (_event, dirPath: string) => {
      try {
        if (!dirPath || !fs.existsSync(dirPath)) {
          return { success: false, error: 'Path not found' }
        }
        const { shell } = await import('electron')
        await shell.openPath(dirPath)
        return { success: true }
      } catch (error) {
        logger.error('Failed to open dir:', String(error))
        return { success: false, error: String(error) }
      }
    })

    ipcMain.handle('dbManager:openFile', async (_event, filePath: string) => {
      try {
        if (!filePath || !fs.existsSync(filePath)) {
          return { success: false, error: 'File not found' }
        }
        const { shell: sh } = await import('electron')
        // showItemInFolder 在文件管理器中高亮文件
        sh.showItemInFolder(filePath)
        return { success: true }
      } catch (error) {
        logger.error('Failed to open file:', String(error))
        return { success: false, error: String(error) }
      }
    })

    // L3 SQL 控制台：只读执行单条 SQL
    ipcMain.handle('dbManager:query', async (_event, dbPath: string, sql: string) => {
      try {
        if (!dbPath || !sql?.trim()) {
          return { success: false, error: 'dbPath or sql is empty' }
        }
        const result = querySqlite(dbPath, sql)
        return { success: true, ...result }
      } catch (error: any) {
        logger.error('SQL query failed:', error?.message ?? String(error))
        return { success: false, error: error?.message ?? String(error) }
      }
    })
  }

  private setupDialogIPC(): void {
    // 打开文件选择对话框
    ipcMain.handle('dialog:openFile', async (_event, options?: any) => {
      try {
        const result = await dialog.showOpenDialog(options || {})
        return result
      } catch (error) {
        logger.error('Failed to open file dialog:', String(error))
        return { canceled: true, filePaths: [] }
      }
    })

    // 读取文件内容（返回 base64）
    ipcMain.handle('dialog:readFile', async (_event, filePath: string) => {
      try {
        const fs = await import('fs/promises')
        const path = await import('path')
        const buffer = await fs.readFile(filePath)
        const fileName = path.basename(filePath)
        // 简单的 MIME 类型检测
        const ext = path.extname(filePath).toLowerCase()
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.pdf': 'application/pdf',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.ppt': 'application/vnd.ms-powerpoint',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.txt': 'text/plain',
          '.json': 'application/json',
          '.xml': 'application/xml',
          '.zip': 'application/zip',
        }
        const mimeType = mimeTypes[ext] || 'application/octet-stream'
        return {
          success: true,
          data: buffer.toString('base64'),
          fileName,
          mimeType,
          size: buffer.length,
        }
      } catch (error) {
        logger.error('Failed to read file:', String(error))
        return { success: false, error: String(error) }
      }
    })
  }

  private setupShellIPC(): void {
    // 打开外部链接 - 在新的 Electron 窗口中打开
    ipcMain.handle('shell:openExternal', async (_event, url: string) => {
      try {
        const { BrowserWindow } = await import('electron')

        // 创建新的浏览器窗口
        const browserWindow = new BrowserWindow({
          width: 1200,
          height: 800,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
          title: 'Browser',
        })

        // 加载 URL
        await browserWindow.loadURL(url)

        logger.info('Opened URL in Electron browser window:', url)
      } catch (error) {
        logger.error('Failed to open URL in browser window:', String(error))
        throw error
      }
    })

    ipcMain.handle('window:minimize', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      window?.minimize()
    })

    ipcMain.handle('window:maximize-toggle', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) {
        return { isMaximized: false }
      }

      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }

      return { isMaximized: window.isMaximized() }
    })

    ipcMain.handle('window:close', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      window?.close()
    })

    ipcMain.handle('window:is-maximized', (event) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      return window?.isMaximized() ?? false
    })
  }

  private setupAgentXIPC(): void {
    // 获取 AgentX 服务器 URL
    ipcMain.handle('agentx:getServerUrl', () => {
      return agentXService.getServerUrl()
    })

    // 获取 AgentX 服务状态
    ipcMain.handle('agentx:getStatus', () => {
      return agentXService.getStatus()
    })

    // 启动 AgentX 服务
    ipcMain.handle('agentx:start', async () => {
      try {
        await agentXService.start()
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // 停止 AgentX 服务
    ipcMain.handle('agentx:stop', async () => {
      try {
        await agentXService.stop()
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // 获取 AgentX 配置
    ipcMain.handle('agentx:getConfig', () => {
      return agentXService.getConfig()
    })

    // 更新 AgentX 配置
    ipcMain.handle('agentx:updateConfig', async (_event, config) => {
      try {
        await agentXService.updateConfig(config)
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // 测试 AgentX 连接
    ipcMain.handle('agentx:testConnection', async (_event, config) => {
      return await agentXService.testConnection(config)
    })

    // 获取 MCP 服务器配置
    ipcMain.handle('agentx:getMcpServers', () => {
      return agentXService.getMcpServers()
    })

    // 更新 MCP 服务器配置
    ipcMain.handle('agentx:updateMcpServers', async (_event, mcpServers) => {
      try {
        await agentXService.updateMcpServers(mcpServers)
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // 获取可用 Skills 列表
    ipcMain.handle('agentx:getAvailableSkills', async () => {
      return await agentXService.getAvailableSkills()
    })

    // 获取已启用的 Skills
    ipcMain.handle('agentx:getEnabledSkills', () => {
      return agentXService.getEnabledSkills()
    })

    // 更新已启用的 Skills
    ipcMain.handle('agentx:updateEnabledSkills', async (_event, skills: string[]) => {
      try {
        await agentXService.updateEnabledSkills(skills)
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    // 导入 Skill（zip 压缩包）
    ipcMain.handle('agentx:importSkill', async (_event, zipPath: string) => {
      return await agentXService.importSkill(zipPath)
    })

    // 删除 Skill
    ipcMain.handle('agentx:deleteSkill', async (_event, skillName: string) => {
      return await agentXService.deleteSkill(skillName)
    })
  }

  private setupFeishuIPC(): void {
    const dataDir = app.getPath('userData')
    this.feishuManager = new FeishuManager(dataDir, agentXService.getPort())

    ipcMain.handle('feishu:getConfig', async () => {
      const saved = this.feishuManager!.loadConfig()
      if (saved?.feishu) {
        return saved.feishu
      }
      return null
    })

    ipcMain.handle('feishu:saveConfig', async (_, config: any) => {
      try {
        this.feishuManager!.saveConfig(config, { name: 'Perseng' })
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('feishu:start', async (_, feishuConfig: any, roleConfig?: any) => {
      try {
        const role = roleConfig || { name: 'Perseng' }
        await this.feishuManager!.start(feishuConfig, role)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('feishu:stop', async () => {
      try {
        await this.feishuManager!.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('feishu:status', async () => {
      return this.feishuManager!.getStatus()
    })

    ipcMain.handle('feishu:remove', async () => {
      try {
        await this.feishuManager!.remove()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 尝试恢复已保存的飞书连接
    this.feishuManager.restore().catch(() => {})
  }

  private setupWebAccessIPC(): void {
    ipcMain.handle('webAccess:getStatus', () => {
      const last = webAccessService.getLastStatus()
      return {
        enabled: webAccessService.isEnabled(),
        externalAccess: agentXService.getExternalAccess(),
        ...(last ?? {}),
      }
    })

    ipcMain.handle('webAccess:enable', async (_event, port?: number) => {
      try {
        if (port) webAccessService.setPort(port)
        await agentXService.setExternalAccess(true)
        const status = await webAccessService.enable(agentXService.getPort(), 'perseng-desktop')
        return { success: true, ...status }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    ipcMain.handle('webAccess:disable', async () => {
      try {
        await webAccessService.disable()
        await agentXService.setExternalAccess(false)
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })
  }

  private setupWorkspaceIPC(): void {
    ipcMain.handle('workspace:getFolders', async () => workspaceService.getFolders())

    ipcMain.handle('workspace:addFolder', async (_, folderPath: string, name: string) =>
      workspaceService.addFolder(folderPath, name))

    ipcMain.handle('workspace:removeFolder', async (_, id: string) =>
      workspaceService.removeFolder(id))

    ipcMain.handle('workspace:pickFolder', async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return null
      const folderPath = result.filePaths[0]
      const name = folderPath.split(/[/\\]/).filter(Boolean).pop() || 'workspace'
      return { path: folderPath, name }
    })

    ipcMain.handle('workspace:listDir', async (_, dirPath: string) =>
      workspaceService.listDir(dirPath))

    ipcMain.handle('workspace:readFile', async (_, filePath: string) =>
      workspaceService.readFile(filePath))

    ipcMain.handle('workspace:readFileBase64', async (_, filePath: string) =>
      workspaceService.readFileBase64(filePath))

    ipcMain.handle('workspace:writeFile', async (_, filePath: string, content: string) =>
      workspaceService.writeFile(filePath, content))

    ipcMain.handle('workspace:createDir', async (_, dirPath: string) =>
      workspaceService.createDir(dirPath))

    ipcMain.handle('workspace:deleteItem', async (_, itemPath: string) =>
      workspaceService.deleteItem(itemPath))

    ipcMain.handle('system:checkGit', async () => {
      if (process.platform !== 'win32') return { installed: true }
      try {
        const { execSync } = await import('node:child_process')
        try {
          execSync('git --version', { encoding: 'utf-8', timeout: 3000 })
          return { installed: true }
        } catch {
          // Try common Git installation paths on Windows
          const commonPaths = [
            'C:\\Program Files\\Git\\cmd\\git.exe',
            'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
          ]
          for (const gitPath of commonPaths) {
            try {
              execSync(`"${gitPath}" --version`, { encoding: 'utf-8', timeout: 3000 })
              return { installed: true }
            } catch {
              // continue
            }
          }
          return { installed: false }
        }
      } catch {
        return { installed: false }
      }
    })
  }

  private setupUpdateIPC(): void {
    // 检查更新
    ipcMain.handle('check-for-updates', async () => {
      if (!this.updateManager) {
        throw new Error('Update manager not initialized')
      }
      await this.updateManager.checkForUpdatesManual()
      return { success: true }
    })

    // 重启应用
    ipcMain.handle('app:relaunch', () => {
      app.relaunch()
      // 先隐藏所有窗口，避免白屏闪烁
      BrowserWindow.getAllWindows().forEach(w => w.hide())
      app.exit(0)
    })
  }

  private setupInfrastructure(): void {
    // Create adapters
    this.serverPort = new PersengServerAdapter()
    this.configPort = new FileConfigAdapter(
      path.join(app.getPath('userData'), 'config.json')
    )
    this.notificationPort = new ElectronNotificationAdapter()
  }

  private setupApplication(): {
    startUseCase: StartServerUseCase
    stopUseCase: StopServerUseCase
  } {
    if (!this.serverPort || !this.configPort || !this.notificationPort) {
      throw new Error('Infrastructure not initialized')
    }

    const startUseCase = new StartServerUseCase(
      this.serverPort,
      this.configPort,
      this.notificationPort
    )

    const stopUseCase = new StopServerUseCase(
      this.serverPort,
      this.notificationPort
    )

    return { startUseCase, stopUseCase }
  }

  private setupPresentation(
    startUseCase: StartServerUseCase,
    stopUseCase: StopServerUseCase
  ): void {
    if (!this.serverPort || !this.updateManager) {
      throw new Error('Infrastructure not fully initialized')
    }

    this.trayPresenter = new TrayPresenter(
      startUseCase,
      stopUseCase,
      this.serverPort,
      this.updateManager
    )
  }

  private setupAppEvents(): void {
    // NOTE: second-instance handler is set up in bootstrap.ts
    // to ensure it's registered before app initialization completes

    // Prevent app from quitting when all windows are closed
    app.on('window-all-closed', () => {
      // Keep app running in system tray on all platforms
      // Do nothing - app stays in system tray
      // User can quit from tray menu
    })

    // Handle app quit - use synchronous cleanup
    let isQuitting = false
    app.on('before-quit', (event) => {
      if (!isQuitting) {
        event.preventDefault()
        isQuitting = true

        // Perform cleanup
        this.performCleanup().then(() => {
          logger.info('Cleanup completed, exiting...')
          app.exit(0)
        }).catch((error) => {
          logger.error('Error during cleanup:', error)
          app.exit(0)
        })
      }
    })

    // Handle activation (macOS)
    app.on('activate', () => {
      // Show tray menu if needed
    })
  }

  private async performCleanup(): Promise<void> {
    try {
      // Stop server if running
      if (this.serverPort) {
        const statusResult = await this.serverPort.getStatus()
        if (statusResult.ok && statusResult.value === 'running') {
          logger.info('Stopping server before quit...')
          await this.serverPort.stop()
        }
      }
    } catch (error) {
      const err = String(error)
      logger.error('Error stopping server:', err)
    }

    // Cleanup UI components
    this.cleanup()
  }

  private cleanup(): void {
    if (this.trayPresenter) {
      this.trayPresenter.destroy()
      this.trayPresenter = null
    }

    if (this.autoStartWindow) {
      this.autoStartWindow.cleanup()
      this.autoStartWindow = null
    }
  }
}

// Global error handlers for uncaught exceptions and rejections
process.on('uncaughtException', (error: Error) => {
  // Ignore EPIPE errors globally
  if (error.message && error.message.includes('EPIPE')) {
    logger.debug('Ignoring EPIPE error:', error.message)
    return
  }

  // Log other errors but don't crash
  logger.error('Uncaught exception:', error)

  // For critical errors, show dialog
  if (!error.message?.includes('write') && !error.message?.includes('stream')) {
    dialog.showErrorBox('Unexpected Error', error.message)
    app.quit()
  }
})

process.on('unhandledRejection', (reason: any, _promise: Promise<any>) => {
  // Ignore EPIPE errors
  if (reason?.message && reason.message.includes('EPIPE')) {
    logger.debug('Ignoring unhandled EPIPE rejection:', reason.message)
    return
  }

  logger.error('Unhandled promise rejection:', reason)
})

// Handle write stream errors specifically
process.stdout.on('error', (error: any) => {
  if (error.code === 'EPIPE') {
    // Ignore EPIPE on stdout
    return
  }
  logger.error('stdout error:', error)
})

process.stderr.on('error', (error: any) => {
  if (error.code === 'EPIPE') {
    // Ignore EPIPE on stderr
    return
  }
  logger.error('stderr error:', error)
})

// Application entry point
// Single instance lock is already checked in bootstrap.ts
const application = new PersengDesktopApp()

application.initialize().catch((error) => {
  logger.error('Failed to initialize application:', error)
  app.quit()
})
