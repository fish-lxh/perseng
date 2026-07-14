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
import { FeishuManager } from '@promptx/feishu-desktop'
import { workspaceService } from '@promptx/mcp-workspace-host'
import * as logger from '@promptx/logger'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { migratePromptXHomeIfNeeded } from '~/main/utils/persengPaths'
import { registerServerConfigIpc } from '~/main/ipc/serverConfigIpc'
import { registerLanguageIpc } from '~/main/ipc/languageIpc'
import { registerLogsIpc } from '~/main/ipc/logsIpc'
import { registerTimelineIpc } from '~/main/ipc/timelineIpc'
import { registerDatabaseManagerIpc } from '~/main/ipc/databaseManagerIpc'
import { registerDialogIpc } from '~/main/ipc/dialogIpc'
import { registerShellIpc } from '~/main/ipc/shellIpc'
import { registerWindowIpc } from '~/main/ipc/windowIpc'

function formatStartServerResultError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown server start error'
  }
  if (typeof error === 'object' && error !== null) {
    const maybeCode = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
    const maybeMessage =
      'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
    return [maybeCode, maybeMessage].filter(Boolean).join(': ') || String(error)
  }
  return String(error)
}

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
    registerServerConfigIpc({ getConfigPort: () => this.configPort, getServerPort: () => this.serverPort })
    registerLanguageIpc({ getTrayPresenter: () => this.trayPresenter })
    registerLogsIpc()
    registerDialogIpc()
    registerShellIpc()
    registerWindowIpc()
    this.setupAgentXIPC()
    this.setupWebAccessIPC()
    this.setupFeishuIPC()
    this.setupWorkspaceIPC()
    registerTimelineIpc()
    registerDatabaseManagerIpc()

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
      const result = await startUseCase.execute()
      if (result.ok) {
        logger.info('Perseng server started automatically')
      } else {
        logger.error(
          'Failed to auto-start server:',
          formatStartServerResultError(result.error),
        )
      }
    } catch (error) {
      logger.error('Failed to auto-start server:', formatStartServerResultError(error))
    }

    // Auto-start AgentX service
    logger.info('Auto-starting AgentX service...')
    try {
      await agentXService.start()
      logger.info('AgentX service started automatically')
    } catch (error) {
      const details =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message ?? error)
            : String(error)
      logger.error('Failed to auto-start AgentX service:', details)
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
