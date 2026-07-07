/**
 * workspace:* + system:checkGit IPC handlers (10 channels).
 *
 * Extracted from PersengDesktopApp.setupWorkspaceIPC (P0 step 2.1c). The
 * workspace domain wraps a singleton service for folder/file CRUD and a
 * native folder-picker dialog. `system:checkGit` is a Windows-only probe for
 * git presence that historically lived in the same method; it stays here to
 * keep the registration order intact. Channel names preserved.
 */

import { ipcMain, dialog } from 'electron'
import { workspaceService } from '~/main/services/WorkspaceService'

export function registerWorkspaceIpc(): void {
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