/**
 * IDE环境检测服务 - 新架构
 * 专注于IDE环境变量检测和配置建议
 * 项目路径管理已移交ProjectManager和ProjectPathResolver
 */

import * as logger from '@promptx/logger'

// DirectoryLocator 仍在同目录的 .ts (Phase 2 同时迁移)，但因为 DirectoryService 暴露在
// @promptx/core 边界，CLI 的 tsc 沿 import 链追到此 .ts 也会再追到 .ts 触发 TS6059。
// 用 const+require (同 Phase 1 rolex 策略) 阻断 tsc 对同目录 .ts 的进一步追踪。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DirectoryLocatorFactory } = require('./DirectoryLocator') as {
  DirectoryLocatorFactory: {
    createPersengWorkspaceLocator(options: DirectoryServiceOptions): unknown
  }
}

export interface DirectoryServiceOptions {
  strategies?: string[]
  projectMarkers?: string[]
  avoidUserHome?: boolean
}

export interface IDEDetectionInfo {
  detectedIDE?: string
  availableEnvVars?: Record<string, string>
  cwd?: string
  args?: string[]
}

export interface DebugInfo {
  platform: string
  ideDetection: {
    detectedIDE?: string
    availableEnvVars?: Record<string, string>
    cwd: string
    args: string[]
  }
  environment: Record<string, string | undefined>
  recommendations: Recommendation[]
}

export interface Recommendation {
  type: string
  message: string
  suggestions: string[]
}

interface WorkspaceLocator {
  getDetectionInfo(): IDEDetectionInfo
  clearCache(): void
}

export class DirectoryService {
  private workspaceLocator: WorkspaceLocator | null = null
  private initialized = false

  /**
   * 初始化服务
   */
  async initialize(options: DirectoryServiceOptions = {}): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      this.workspaceLocator =
        DirectoryLocatorFactory.createPersengWorkspaceLocator(options) as unknown as WorkspaceLocator
      this.initialized = true

      logger.debug('[DirectoryService] 初始化完成')
    } catch (error) {
      logger.error('[DirectoryService] 初始化失败:', error as Error)
      throw error
    }
  }

  /**
   * 获取IDE环境检测调试信息
   */
  async getDebugInfo(_context: Record<string, unknown> = {}): Promise<DebugInfo> {
    await this.ensureInitialized()

    // 获取IDE检测信息
    const ideDetectionInfo = this.workspaceLocator?.getDetectionInfo() || {}

    return {
      platform: process.platform,
      ideDetection: {
        detectedIDE: ideDetectionInfo.detectedIDE,
        availableEnvVars: ideDetectionInfo.availableEnvVars,
        cwd: process.cwd(),
        args: process.argv.slice(2),
      },
      environment: {
        // 主要IDE环境变量
        WORKSPACE_FOLDER_PATHS: process.env.WORKSPACE_FOLDER_PATHS,
        VSCODE_WORKSPACE_FOLDER: process.env.VSCODE_WORKSPACE_FOLDER,
        PROJECT_ROOT: process.env.PROJECT_ROOT,
        SUBLIME_PROJECT_PATH: process.env.SUBLIME_PROJECT_PATH,
        // Perseng专用
        PERSENG_WORKSPACE: process.env.PERSENG_WORKSPACE,
        // 系统环境
        PWD: process.env.PWD,
        NODE_ENV: process.env.NODE_ENV,
      },
      recommendations: this.getPathRecommendations(ideDetectionInfo),
    }
  }

  /**
   * 获取路径配置建议
   */
  private getPathRecommendations(ideDetectionInfo: IDEDetectionInfo = {}): Recommendation[] {
    const recommendations: Recommendation[] = []

    if (!ideDetectionInfo.detectedIDE || ideDetectionInfo.detectedIDE === 'Unknown') {
      recommendations.push({
        type: 'env_var',
        message: '未检测到IDE环境变量，建议设置项目路径环境变量',
        suggestions: [
          'export PERSENG_WORKSPACE="/path/to/your/project"',
          'export PROJECT_ROOT="/path/to/your/project"',
          'export WORKSPACE_ROOT="/path/to/your/project"',
        ],
      })
    }

    if (
      !ideDetectionInfo.availableEnvVars ||
      Object.keys(ideDetectionInfo.availableEnvVars).length === 0
    ) {
      recommendations.push({
        type: 'manual_config',
        message: '建议在IDE中配置MCP工作目录',
        suggestions: [
          'VSCode: 在settings.json中设置workspace.folders',
          'IntelliJ: 在Run Configuration中设置Working directory',
          'Claude IDE: 确保workspace路径正确传递',
        ],
      })
    }

    return recommendations
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    if (this.workspaceLocator) {
      this.workspaceLocator.clearCache()
    }
    logger.debug('[DirectoryService] 缓存已清除')
  }

  /**
   * 确保服务已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * 重新加载配置
   */
  async reload(options: DirectoryServiceOptions = {}): Promise<void> {
    this.initialized = false
    this.clearCache()
    await this.initialize(options)
  }
}

// 创建全局单例
const globalDirectoryService = new DirectoryService()

/**
 * 获取全局目录服务实例
 */
export function getDirectoryService(): DirectoryService {
  return globalDirectoryService
}
