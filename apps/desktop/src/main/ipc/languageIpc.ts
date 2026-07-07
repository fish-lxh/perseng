/**
 * settings:getLanguage / settings:setLanguage IPC handlers.
 *
 * Extracted from PersengDesktopApp.setupLanguageIPC (P0 step 2.1a). Owns the
 * `~/.{app}/language.json` persistence and triggers the tray menu refresh so
 * localized labels take effect immediately. Channel names preserved.
 */

import { ipcMain, app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as logger from '@promptx/logger'
import { mainI18n } from '~/main/i18n'
import type { TrayPresenter } from '~/main/tray/TrayPresenter'

/**
 * TrayPresenter is a getter because it is created AFTER the IPC handlers are
 * registered (see PersengDesktopApp.initialize ordering). Invocations only
 * happen post-init, when the tray has been wired up.
 */
export interface LanguageIpcDeps {
  getTrayPresenter: () => TrayPresenter | null
}

export function registerLanguageIpc(deps: LanguageIpcDeps): void {
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
      const trayPresenter = deps.getTrayPresenter()
      if (trayPresenter) {
        await trayPresenter.refreshMenu()
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