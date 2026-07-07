/**
 * webAccess:* IPC handlers (3 channels: getStatus / enable / disable).
 *
 * Extracted from PersengDesktopApp.setupWebAccessIPC (P0 step 2.1c). Both
 * WebAccessService and AgentXService are process-wide singletons; no deps
 * needed. Channel names preserved.
 */

import { ipcMain } from 'electron'
import { webAccessService } from '~/main/services/WebAccessService'
import { agentXService } from '~/main/services/AgentXService'

export function registerWebAccessIpc(): void {
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