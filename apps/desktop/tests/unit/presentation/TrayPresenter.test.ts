import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app, BrowserWindow, clipboard } from 'electron'
import { TrayPresenter } from '../../../src/main/tray/TrayPresenter.js'
import { ServerStatus } from '../../../src/main/domain/valueObjects/ServerStatus.js'
import { ResultUtil } from '../../../src/shared/Result.js'
import type { StartServerUseCase } from '../../../src/main/application/useCases/StartServerUseCase.js'
import type { StopServerUseCase } from '../../../src/main/application/useCases/StopServerUseCase.js'
import type { IServerPort } from '../../../src/main/domain/ports/IServerPort.js'

vi.mock('electron', () => {
  class MockTray {
    setContextMenu = vi.fn()
    setToolTip = vi.fn()
    setImage = vi.fn()
    destroy = vi.fn()
    isDestroyed = vi.fn(() => false)
  }
  const trayFactory = vi.fn(MockTray)

  class MockBrowserWindow {
    loadURL = vi.fn()
    loadFile = vi.fn()
    on = vi.fn()
    close = vi.fn()
    destroy = vi.fn()
    focus = vi.fn()
    isDestroyed = vi.fn(() => false)
    webContents = { send: vi.fn() }
  }
  const browserWindowFactory: any = vi.fn(MockBrowserWindow)
  browserWindowFactory.getAllWindows = vi.fn(() => [])

  return {
    app: {
      getPath: vi.fn(() => '/mock/path'),
      getVersion: vi.fn(() => '0.1.0'),
      getLocale: vi.fn(() => 'en-US'),
      isReady: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
      quit: vi.fn(),
    },
    Tray: trayFactory,
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        setTemplateImage: vi.fn(),
      })),
    },
    clipboard: {
      writeText: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
    },
    dialog: {
      showMessageBox: vi.fn(),
    },
    nativeTheme: {
      on: vi.fn(),
      shouldUseDarkColors: false,
    },
    BrowserWindow: browserWindowFactory,
  }
})

vi.mock('@promptx/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../../src/main/i18n/index.js', () => ({
  t: (key: string) => {
    const translations: Record<string, string> = {
      'tray.tooltip': 'Perseng',
      'tray.status.running': 'Running',
      'tray.status.stopped': 'Stopped',
      'tray.status.starting': 'Starting',
      'tray.status.stopping': 'Stopping',
      'tray.status.error': 'Error',
      'tray.status.unknown': 'Unknown',
      'tray.menu.startServer': 'Start Server',
      'tray.menu.stopServer': 'Stop Server',
      'tray.menu.starting': 'Starting...',
      'tray.menu.stopping': 'Stopping...',
      'tray.menu.toggleServer': 'Toggle Server',
      'tray.menu.copyAddress': 'Copy Server Address',
      'tray.menu.openMainWindow': 'Open Main Window',
      'tray.menu.update.idle': 'Check for updates',
      'tray.menu.about': 'About Perseng',
      'tray.menu.quit': 'Quit Perseng',
    }
    return translations[key] ?? key
  },
}))

vi.mock('~/main/ResourceManager', () => ({
  ResourceManager: class MockResourceManager {
    destroy = vi.fn()
  },
}))

vi.mock('~/main/windows/windowShell', () => ({
  applyFramelessWindowChrome: vi.fn(),
  bindWindowStateSync: vi.fn(() => vi.fn()),
  createFramelessWindowOptions: vi.fn((options: unknown) => options),
}))

describe('TrayPresenter', () => {
  let presenter: TrayPresenter
  let startServerUseCase: StartServerUseCase
  let stopServerUseCase: StopServerUseCase
  let serverPort: IServerPort
  let updateManager: any
  let mockTray: any

  beforeEach(async () => {
    startServerUseCase = {
      execute: vi.fn(),
      executeWithCustomConfig: vi.fn(),
    } as any

    stopServerUseCase = {
      execute: vi.fn(),
    } as any

    serverPort = {
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      getStatus: vi.fn().mockResolvedValue(ResultUtil.ok(ServerStatus.STOPPED)),
      getAddress: vi.fn().mockResolvedValue(ResultUtil.ok('http://localhost:3000/mcp')),
      getMetrics: vi.fn(),
      updateConfig: vi.fn(),
      onStatusChange: vi.fn(),
      removeStatusListener: vi.fn(),
    }

    updateManager = {
      onUpdateAvailable: vi.fn(),
      getUpdateState: vi.fn(() => 'idle'),
      getUpdateInfo: vi.fn(() => null),
      getProgress: vi.fn(() => null),
      checkForUpdatesManual: vi.fn(),
      downloadUpdate: vi.fn(),
      updater: {
        on: vi.fn(),
      },
    }

    presenter = new TrayPresenter(
      startServerUseCase,
      stopServerUseCase,
      serverPort,
      updateManager
    )

    await Promise.resolve()
    mockTray = (presenter as any).tray
  })

  afterEach(() => {
    presenter?.destroy()
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should create tray and register listeners', () => {
      expect(mockTray).toBeDefined()
      expect(mockTray.setToolTip).toHaveBeenCalledWith('Perseng Desktop')
      expect(serverPort.onStatusChange).toHaveBeenCalled()
      expect(updateManager.onUpdateAvailable).toHaveBeenCalled()
      expect(updateManager.updater.on).toHaveBeenCalledTimes(2)
    })

    it('should build initial menu', () => {
      expect(mockTray.setContextMenu).toHaveBeenCalled()
    })
  })

  describe('menu actions', () => {
    it('should start server when status is stopped', async () => {
      vi.mocked(serverPort.getStatus).mockResolvedValue(ResultUtil.ok(ServerStatus.STOPPED))
      vi.mocked(startServerUseCase.execute).mockResolvedValue(ResultUtil.ok(undefined))

      await presenter.handleToggleServer()

      expect(startServerUseCase.execute).toHaveBeenCalled()
    })

    it('should stop server when status is running', async () => {
      vi.mocked(serverPort.getStatus).mockResolvedValue(ResultUtil.ok(ServerStatus.RUNNING))
      vi.mocked(stopServerUseCase.execute).mockResolvedValue(ResultUtil.ok(undefined))

      await presenter.handleToggleServer()

      expect(stopServerUseCase.execute).toHaveBeenCalled()
    })

    it('should copy server address to clipboard', async () => {
      await presenter.handleCopyAddress()

      expect(clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/mcp')
    })

    it('should open main window', () => {
      presenter.openMainWindow()

      expect(BrowserWindow).toHaveBeenCalled()
    })

    it('should quit application', () => {
      presenter.handleQuit()

      expect(app.quit).toHaveBeenCalled()
    })
  })

  describe('status updates', () => {
    it('should update icon and tooltip when running', () => {
      presenter.updateStatus(ServerStatus.RUNNING)

      expect(mockTray.setImage).toHaveBeenCalled()
      expect(mockTray.setToolTip).toHaveBeenLastCalledWith('Perseng - Running')
    })

    it('should rebuild menu when status changes', async () => {
      const initializeMenuSpy = vi.spyOn(presenter as any, 'initializeMenu')

      presenter.updateStatus(ServerStatus.ERROR)
      await Promise.resolve()

      expect(initializeMenuSpy).toHaveBeenCalled()
    })
  })

  describe('menu structure', () => {
    it('should show start action when stopped', async () => {
      vi.mocked(serverPort.getStatus).mockResolvedValue(ResultUtil.ok(ServerStatus.STOPPED))

      const menu = await presenter.buildMenu()
      const toggleItem = menu.find(item => item.id === 'toggle')

      expect(toggleItem?.label).toBe('Start Server')
      expect(toggleItem?.enabled).toBe(true)
    })

    it('should show stop action and address when running', async () => {
      vi.mocked(serverPort.getStatus).mockResolvedValue(ResultUtil.ok(ServerStatus.RUNNING))

      const menu = await presenter.buildMenu()
      const toggleItem = menu.find(item => item.id === 'toggle')
      const addressItem = menu.find(item => item.id === 'address')

      expect(toggleItem?.label).toBe('Stop Server')
      expect(addressItem?.label).toBe('http://localhost:3000/mcp')
    })

    it('should disable toggle when starting', async () => {
      vi.mocked(serverPort.getStatus).mockResolvedValue(ResultUtil.ok(ServerStatus.STARTING))

      const menu = await presenter.buildMenu()
      const toggleItem = menu.find(item => item.id === 'toggle')

      expect(toggleItem?.enabled).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('should remove status listener and destroy tray', () => {
      presenter.destroy()

      expect(serverPort.removeStatusListener).toHaveBeenCalled()
      expect(mockTray.destroy).toHaveBeenCalled()
    })
  })
})
