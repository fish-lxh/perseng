import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
 * 通过调用 @promptx/cli 激活角色(CLI bin 名仍为 promptx,因 npm 包名未改)
 */
export class PersengActivationAdapter implements ActivationAdapter {
  async activate(roleId: string): Promise<ActivationResult> {
    try {
      // 调用 @promptx/cli 的 action 子命令激活角色(CLI bin 名 promptx,npm 包名不动)
      const { stdout } = await execAsync(`promptx action ${roleId}`, { windowsHide: true })

      // 检查输出判断是否成功
      const success =
        stdout.includes('角色已激活') ||
        stdout.includes('role activated') ||
        stdout.includes('角色激活完成')

      return {
        success,
        roleId,
        message: success ? `Successfully activated ${roleId}` : 'Activation failed',
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
