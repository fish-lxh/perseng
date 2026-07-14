interface RolexActionDispatcherLike {
  isV2Role(roleId: string): Promise<boolean>
  dispatch(operation: 'activate', args: { role: string }): Promise<unknown>
}

interface CoreCliLike {
  execute(command: 'action', args: [string, string?]): Promise<unknown>
}

/**
 * Activation result returned by a role adapter
 */
export interface ActivationResult {
  success: boolean
  roleId: string
  message: string
  timestamp: Date
}

/**
 * Activation adapter contract — accepts a role id (string) to stay
 * consistent with ResourceService.activateRole(roleId).
 */
export interface ActivationAdapter {
  activate(roleId: string): Promise<ActivationResult>
}

/**
 * Perseng Activation Adapter - 基础设施层实现
 * 统一走进程内 @promptx/core 激活角色，避免 Windows 下 `.cmd` / codepage
 * 导致的中文输出乱码。
 */
export class PersengActivationAdapter implements ActivationAdapter {
  async activate(roleId: string): Promise<ActivationResult> {
    try {
      if (!/^[A-Za-z0-9._-]+$/.test(roleId)) {
        throw new Error('Invalid role ID')
      }

      const { RolexActionDispatcher } = require('@promptx/core/rolex') as {
        RolexActionDispatcher: new () => RolexActionDispatcherLike
      }
      const dispatcher = new RolexActionDispatcher()
      if (await dispatcher.isV2Role(roleId)) {
        await dispatcher.dispatch('activate', { role: roleId })
        return {
          success: true,
          roleId,
          message: `Successfully activated ${roleId}`,
          timestamp: new Date(),
        }
      }

      // V1 激活与 MCP action 工具保持一致：直接走进程内 cli.execute('action')
      // 避免 Windows `.cmd` / stdout/stderr codepage 链路把 UTF-8 中文打坏。
      const core = await import('@promptx/core')
      const coreExports = (core as any).default || core
      const cli = (coreExports as { cli?: CoreCliLike; pouch?: { cli?: CoreCliLike } }).cli
        || (coreExports as { pouch?: { cli?: CoreCliLike } }).pouch?.cli

      if (!cli || typeof cli.execute !== 'function') {
        throw new Error('CLI not available in @promptx/core')
      }

      await cli.execute('action', [roleId])

      return {
        success: true,
        roleId,
        message: `Successfully activated ${roleId}`,
        timestamp: new Date(),
      }
    } catch (error) {
      return {
        success: false,
        roleId,
        message: `Failed to activate: ${(error as Error).message}`,
        timestamp: new Date(),
      }
    }
  }
}
