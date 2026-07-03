import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'

export const WINDOW_STATE_CHANNEL = 'window:state-changed'

export function createFramelessWindowOptions(
  options: BrowserWindowConstructorOptions
): BrowserWindowConstructorOptions {
  return {
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#050a14',
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    ...options,
  }
}

export function applyFramelessWindowChrome(window: BrowserWindow): void {
  if (process.platform !== 'darwin') {
    window.removeMenu()
  }
}

export function bindWindowStateSync(window: BrowserWindow): () => void {
  const emitWindowState = () => {
    if (window.isDestroyed()) return
    window.webContents.send(WINDOW_STATE_CHANNEL, {
      isMaximized: window.isMaximized(),
    })
  }

  window.webContents.on('did-finish-load', emitWindowState)
  window.on('maximize', emitWindowState)
  window.on('unmaximize', emitWindowState)
  window.on('enter-full-screen', emitWindowState)
  window.on('leave-full-screen', emitWindowState)

  return () => {
    if (window.isDestroyed()) return
    window.webContents.removeListener('did-finish-load', emitWindowState)
    window.removeListener('maximize', emitWindowState)
    window.removeListener('unmaximize', emitWindowState)
    window.removeListener('enter-full-screen', emitWindowState)
    window.removeListener('leave-full-screen', emitWindowState)
  }
}
