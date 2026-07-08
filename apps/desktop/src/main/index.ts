// Import polyfills first, before any other modules
import '~/main/polyfills'

import { app, dialog } from 'electron'
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
import { registerAgentXIpc } from '~/main/ipc/agentxIpc'
import { registerFeishuIpc } from '~/main/ipc/feishuIpc'
import { registerWebAccessIpc } from '~/main/ipc/webAccessIpc'
import { registerWorkspaceIpc } from '~/main/ipc/workspaceIpc'
import { registerUpdateIpc } from '~/main/ipc/updateIpc'
import { setupAppEvents, type AppLifecycleDeps } from '~/main/lifecycle/AppLifecycle'

class PersengDesktopApp {
  private trayPresenter: TrayPresenter | null = null
  private serverPort: PersengServerAdapter | null = null
  private configPort: FileConfigAdapter | null = null
  private notificationPort: ElectronNotificationAdapter | null = null
  private updateManager: UpdateManager | null = null
  private autoStartService: AutoStartService | null = null
  private autoStartWindow: AutoStartWindow | null = null

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
    registerAgentXIpc()
    registerWebAccessIpc()
    registerFeishuIpc()
    registerWorkspaceIpc()
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
    registerUpdateIpc({ getUpdateManager: () => this.updateManager })

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
    // P0 step 2.3: 委托给 AppLifecycle 模块, 装配层只传 getter
    const lifecycleDeps: AppLifecycleDeps = {
      getServerPort: () => this.serverPort,
      getTrayPresenter: () => this.trayPresenter,
      getAutoStartWindow: () => this.autoStartWindow,
    }
    setupAppEvents(lifecycleDeps)
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
