/**
 * ActivationAdapter 契约 — KNUTH-FEAT 2026-07-11 G2.2.
 *
 * ResourceService.activateRole() 通过这个接口调用 host 提供的激活实现
 * (例如 Electron 主进程 spawn 子进程, 或 Web host HTTP 调用等)。
 * 让 ResourceService 跟具体激活机制解耦。
 */

export interface ActivationResult {
  success: boolean
  roleId: string
  message: string
  timestamp: Date
}

export interface ActivationAdapter {
  activate(roleId: string): Promise<ActivationResult>
}
