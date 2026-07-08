/**
 * AppLifecycle - Electron app 生命周期管理
 *
 * 从 PersengDesktopApp 抽出的 lifecycle 关注点:
 * - setupAppEvents: 注册 window-all-closed / before-quit / activate
 * - performCleanup: 异步清理 (停止 server) + 同步清理 (销毁 tray/autoStartWindow)
 * - cleanup: 同步清理 (tray + autoStartWindow)
 *
 * 设计原则:
 * 1. 单一职责: lifecycle 只管 app event + cleanup, 不知道其他装配细节
 * 2. 依赖注入: 用 getter 拿各 Port, 避免 stale reference (装配阶段 Port 是 null,
 *    before-quit 触发时已实例化)
 * 3. 幂等: 多次调用 cleanup 安全 (getter 返回 null 时跳过)
 *
 * P0 step 2.3: 抽 setupAppEvents/performCleanup/cleanup lifecycle
 */

import { app } from 'electron'
import { TrayPresenter } from '~/main/tray/TrayPresenter'
import { PersengServerAdapter } from '~/main/infrastructure/adapters/PersengServerAdapter'
import { AutoStartWindow } from '~/main/windows/AutoStartWindow'
import * as logger from '@promptx/logger'

/** 装配期 Port 引用 (用 getter 避免 stale reference) */
export interface AppLifecycleDeps {
  getServerPort(): PersengServerAdapter | null
  getTrayPresenter(): TrayPresenter | null
  getAutoStartWindow(): AutoStartWindow | null
}

/**
 * 注册 Electron app 事件:
 * - window-all-closed: 保持运行 (托盘模式)
 * - before-quit: 触发 performCleanup
 * - activate: macOS 唤醒 (no-op)
 */
export function setupAppEvents(deps: AppLifecycleDeps): void {
  // NOTE: second-instance handler 已在 bootstrap.ts 注册, 这里不再重复

  // 关闭所有窗口时不退出 — 托盘常驻
  app.on('window-all-closed', () => {
    // 不调用 app.quit(), 让 app 留在系统托盘
  })

  // 退出前异步清理
  let isQuitting = false
  app.on('before-quit', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      isQuitting = true

      performCleanup(deps)
        .then(() => {
          logger.info('Cleanup completed, exiting...')
          app.exit(0)
        })
        .catch((error) => {
          logger.error('Error during cleanup:', error)
          app.exit(0)
        })
    }
  })

  // macOS 唤醒
  app.on('activate', () => {
    // 暂不做事 (tray presenter 自管)
  })
}

/**
 * 异步清理: 停止 server → 同步 cleanup (销毁 UI 组件).
 * 失败也不抛, 仅 logger.error (避免阻塞 quit 流程).
 */
export async function performCleanup(deps: AppLifecycleDeps): Promise<void> {
  try {
    const serverPort = deps.getServerPort()
    if (serverPort) {
      const statusResult = await serverPort.getStatus()
      if (statusResult.ok && statusResult.value === 'running') {
        logger.info('Stopping server before quit...')
        await serverPort.stop()
      }
    }
  } catch (error) {
    logger.error('Error stopping server:', String(error))
  }

  cleanup(deps)
}

/**
 * 同步清理: 销毁 tray + autoStartWindow.
 * 幂等 — getter 返回 null 时安全跳过.
 */
export function cleanup(deps: AppLifecycleDeps): void {
  // 注: 实际持有 trayPresenter/autoStartWindow 的 PersengDesktopApp
  // 在调用此 cleanup 后, 把对应 field 置 null (因为它自己拥有 reference).
  // AppLifecycle 不知道也不应知道这件事 — getter 是单向 read.
  const tray = deps.getTrayPresenter()
  if (tray) {
    tray.destroy()
  }

  const autoStartWindow = deps.getAutoStartWindow()
  if (autoStartWindow) {
    autoStartWindow.cleanup()
  }
}
