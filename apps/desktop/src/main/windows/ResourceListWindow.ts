import { BrowserWindow, IpcMainInvokeEvent, ipcMain, dialog } from 'electron'
import { ResourceService } from '~/main/application/ResourceService'
import * as path from 'path'
import { t } from '~/main/i18n'
import {
  applyFramelessWindowChrome,
  bindWindowStateSync,
  createFramelessWindowOptions,
} from '~/main/windows/windowShell'

// KNUTH-FEAT 2026-07-04: Import 对话框加头像（V1/V2 都支持）
// 复用 uploadRoleAvatar（行 1208-1215）的"清旧 + copy"模式提到顶层，
// 避免两个 handler 内联重复。
const AVATAR_EXTS = ['png', 'jpg', 'jpeg', 'webp']

/**
 * 清空目标目录下所有 profile.{png,jpg,jpeg,webp}，再把 srcPath 复制为 profile.<ext>。
 * 镜像 uploadRoleAvatar 的语义，保证两边落盘协议一致。
 */
async function clearAndCopyAvatar(
  targetDir: string,
  srcPath: string
): Promise<void> {
  const pathMod = require('path')
  const fs = require('fs-extra')
  for (const ext of AVATAR_EXTS) {
    const existing = pathMod.join(targetDir, `profile.${ext}`)
    if (await fs.pathExists(existing)) await fs.remove(existing)
  }
  const ext = pathMod.extname(srcPath).toLowerCase().slice(1) || 'png'
  await fs.copy(srcPath, pathMod.join(targetDir, `profile.${ext}`), { overwrite: true })
}

function assertSafeResourceId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error('Invalid resource ID')
  }
}

function assertSafeFileName(fileName: string, expectedExt?: string): void {
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
    throw new Error('Invalid file name')
  }
  if (expectedExt && !fileName.endsWith(expectedExt)) {
    throw new Error(`Invalid file extension, expected ${expectedExt}`)
  }
}

function resolveSafeRelativePath(baseDir: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('Invalid relative path')
  }

  const resolvedBase = path.resolve(baseDir)
  const resolvedTarget = path.resolve(resolvedBase, relativePath)
  const relative = path.relative(resolvedBase, resolvedTarget)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes resource directory')
  }

  return resolvedTarget
}

/**
 * Resource List Window - 资源管理窗口
 */
export class ResourceListWindow {
  private window: BrowserWindow | null = null
  private teardownWindowStateSync: (() => void) | null = null
  private static handlersRegistered = false

  constructor(private resourceService: ResourceService) {
    this.setupIpcHandlers()
  }

  /**
   * 验证资源类型是否与压缩包内容匹配
   * @param resourceDir 解压后的资源目录
   * @param expectedType 用户选择的资源类型 ('role' | 'tool')
   * @returns { valid: boolean, message?: string }
   */
  private async validateResourceType(
    resourceDir: string,
    expectedType: 'role' | 'tool'
  ): Promise<{ valid: boolean; message?: string }> {
    const fs = require('fs-extra')

    try {
      const files = await fs.readdir(resourceDir)

      // 检查是否包含角色文件 (.md)
      const hasMdFile = files.some((f: string) => f.endsWith('.md'))
      // 检查是否包含工具文件 (.js)
      const hasJsFile = files.some((f: string) => f.endsWith('.js'))

      // TODO: 用户自定义的识别逻辑放在这里
      // 可以根据实际需求扩展验证规则，例如：
      // - 检查文件内容格式
      // - 检查特定的元数据字段
      // - 检查文件命名规范等

      if (expectedType === 'role') {
        if (!hasMdFile) {
          return {
            valid: false,
            message: t('resources.import.errors.invalidRoleType')
          }
        }
        // 如果同时有 .js 文件但用户选择了 role，可能是选错了类型
        if (hasJsFile && !hasMdFile) {
          return {
            valid: false,
            message: t('resources.import.errors.mismatchRoleExpectedTool')
          }
        }
      } else if (expectedType === 'tool') {
        if (!hasJsFile) {
          return {
            valid: false,
            message: t('resources.import.errors.invalidToolType')
          }
        }
        // 如果同时有 .md 文件但用户选择了 tool，可能是选错了类型
        if (hasMdFile && !hasJsFile) {
          return {
            valid: false,
            message: t('resources.import.errors.mismatchToolExpectedRole')
          }
        }
      }

      return { valid: true }
    } catch (error: any) {
      return {
        valid: false,
        message: t('resources.import.errors.validationFailed')
      }
    }
  }

  private setupIpcHandlers(): void {
    // 防止重复注册
    if (ResourceListWindow.handlersRegistered) {
      return
    }
    ResourceListWindow.handlersRegistered = true

    // 获取分组资源
    ipcMain.handle('resources:getGrouped', async () => {
      try {
        const grouped = await this.resourceService.getGroupedResources()
        const stats = await this.resourceService.getStatistics()

        return {
          success: true,
          data: {
            grouped,
            statistics: stats
          }
        }
      } catch (error: any) {
        console.error('Failed to get grouped resources:', error)
        return {
          success: false,
          error: error.message
        }
      }
    })

    // 搜索资源
    ipcMain.handle('resources:search', async (_: IpcMainInvokeEvent, query: string) => {
      try {
        const resources = await this.resourceService.searchResources(query)
        return {
          success: true,
          data: resources
        }
      } catch (error: any) {
        console.error('Failed to search resources:', error)
        return {
          success: false,
          error: error.message
        }
      }
    })

    // 激活角色
    ipcMain.handle('resources:activateRole', async (_: IpcMainInvokeEvent, roleId: string) => {
      try {
        const result = await this.resourceService.activateRole(roleId)
        return result
      } catch (error: any) {
        console.error('Failed to activate role:', error)
        return {
          success: false,
          message: error.message
        }
      }
    })


    // 执行工具
    ipcMain.handle('resources:executeTool', async (_: IpcMainInvokeEvent, toolId: string, parameters?: any) => {
      try {
        if (!toolId) {
          return { success: false, message: 'Tool ID is required' }
        }

        // KNUTH-FEAT 2026-07-11: Phase 3 桌面兼容链清理 — 直接走 @promptx/core/pouch 子路径 (Phase 1 暴露)。
        const { cli } = require('@promptx/core/pouch')
        if (!cli || !cli.execute) {
          return { success: false, message: 'CLI not available in @promptx/core' }
        }

        // 构建 CLI 参数: toolx @tool://toolId execute [params]
        const toolRef = toolId.startsWith('@tool://') ? toolId : `@tool://${toolId}`
        const args: string[] = [toolRef, 'execute']
        if (parameters) {
          args.push(typeof parameters === 'string' ? parameters : JSON.stringify(parameters))
        }

        const startTime = Date.now()
        const result = await cli.execute('toolx', args)
        const duration = Date.now() - startTime

        // PouchOutput 包含 toString() 函数和 context 循环引用，无法通过 IPC 序列化
        // 需要提取纯数据
        const serializable = typeof result === 'object' && result !== null
          ? (typeof result.toString === 'function' ? result.toString() : JSON.stringify(result))
          : String(result ?? '')

        return {
          success: true,
          data: serializable,
          duration,
        }
      } catch (error: any) {
        console.error('Failed to execute tool:', error)
        return {
          success: false,
          message: error.message || 'Tool execution failed',
          error: String(error),
        }
      }
    })

    // 获取工具手册/文档
    ipcMain.handle('resources:getToolManual', async (_: IpcMainInvokeEvent, toolId: string) => {
      try {
        if (!toolId) {
          return { success: false, message: 'Tool ID is required' }
        }

        // KNUTH-FEAT 2026-07-11: Phase 3 桌面兼容链清理 — 直接走 @promptx/core/pouch 子路径 (Phase 1 暴露)。
        const { cli } = require('@promptx/core/pouch')
        if (!cli || !cli.execute) {
          return { success: false, message: 'CLI not available in @promptx/core' }
        }

        const toolRef = toolId.startsWith('@tool://') ? toolId : `@tool://${toolId}`
        const result = await cli.execute('toolx', [toolRef, 'manual'])

        // PouchOutput → 纯字符串
        const serializable = typeof result === 'object' && result !== null
          ? (typeof result.toString === 'function' ? result.toString() : JSON.stringify(result))
          : String(result ?? '')

        return { success: true, data: serializable }
      } catch (error: any) {
        console.error('Failed to get tool manual:', error)
        return { success: false, message: error.message || 'Failed to get tool manual' }
      }
    })

    // 获取工具参数 Schema（通过 VM 安全加载工具文件提取 getSchema()）
    ipcMain.handle('resources:getToolSchema', async (_: IpcMainInvokeEvent, payload: { id: string; source?: string }) => {
      try {
        const { id } = payload || {}
        const source = payload?.source ?? 'user'
        if (!id) return { success: false, message: 'Tool ID is required' }

        const fs = require('fs-extra')
        const pathMod = require('path')
        const os = require('os')
        const vm = require('vm')

        // 解析工具目录（复用 listFiles 的路径逻辑）
        let toolDir: string | null = null
        if (source === 'user') {
          toolDir = pathMod.join(os.homedir(), '.perseng', 'resource', 'tool', id)
        } else if (source === 'project') {
          try {
            const { ProjectPathResolver } = require('@promptx/core')
            const resolver = new ProjectPathResolver()
            toolDir = pathMod.join(resolver.getResourceDirectory(), 'tool', id)
          } catch { return { success: false, message: 'Project not initialized' } }
        } else {
          try {
            const resourcePkg = require('@promptx/resource')
            const res = resourcePkg.findResourceById(id)
            if (res?.metadata?.path) {
              toolDir = pathMod.dirname(resourcePkg.getResourcePath(res.metadata.path))
            }
          } catch { /* ignore */ }
        }

        if (!toolDir || !(await fs.pathExists(toolDir))) {
          return { success: false, message: 'Tool directory not found' }
        }

        // 找到主 JS 文件
        const entries = await fs.readdir(toolDir)
        const jsFile = entries.find((f: string) => f.endsWith('.tool.js') || f.endsWith('.js'))
        if (!jsFile) return { success: false, message: 'No JS file found in tool directory' }

        const content = await fs.readFile(pathMod.join(toolDir, jsFile), 'utf-8')

        // 在安全的 VM 沙箱中执行，提取 getSchema()
        const sandbox = {
          module: { exports: {} as any },
          exports: {} as any,
          require: () => ({}),
          console: { log: () => {}, error: () => {}, warn: () => {} },
          process: { env: {} },
        }
        sandbox.exports = sandbox.module.exports

        const context = vm.createContext(sandbox)
        try {
          new vm.Script(content, { timeout: 3000 }).runInContext(context)
        } catch {
          return { success: false, message: 'Failed to parse tool file' }
        }

        const exported = sandbox.module.exports
        if (typeof exported.getSchema === 'function') {
          const schema = exported.getSchema()
          // 确保返回纯 JSON（去掉函数等不可序列化内容）
          return { success: true, schema: JSON.parse(JSON.stringify(schema)) }
        }

        return { success: false, message: 'Tool does not export getSchema()' }
      } catch (error: any) {
        console.error('Failed to get tool schema:', error)
        return { success: false, message: error.message || 'Failed to get tool schema' }
      }
    })

    // 获取资源统计
    ipcMain.handle('resources:getStatistics', async () => {
      try {
        const stats = await this.resourceService.getStatistics()
        return {
          success: true,
          data: stats
        }
      } catch (error: any) {
        console.error('Failed to get statistics:', error)
        return {
          success: false,
          error: error.message
        }
      }
    })

    // 新增：下载资源（分享即下载，导出为 ZIP 压缩包）
    ipcMain.handle('resources:download', async (_evt, payload: { id: string; type: 'role' | 'tool'; source?: string; version?: string }) => {
      try {
        const id = payload?.id
        const type = payload?.type
        const source = payload?.source ?? 'user'
        const version = payload?.version ?? 'v1'
        if (!id || !type) {
          return { success: false, message: t('resources.missingParams') }
        }
        assertSafeResourceId(id)

        const path = require('path')
        const fs = require('fs-extra')
        const os = require('os')
        const { dialog } = require('electron')
        const AdmZip = require('adm-zip')

        // 定位资源目录
        let sourceDir: string | null = null
        if (source === 'user') {
          // V2 角色存储在 ~/.rolex/roles/<id>/，V1 及工具存储在 ~/.perseng/resource/<type>/<id>/
          sourceDir = (type === 'role' && version === 'v2')
            ? path.join(os.homedir(), '.rolex', 'roles', id)
            : path.join(os.homedir(), '.perseng', 'resource', type, id)
        } else if (source === 'project') {
          try {
            const { ProjectPathResolver } = require('@promptx/core')
            const resolver = new ProjectPathResolver()
            const projectResDir = resolver.getResourceDirectory()
            sourceDir = path.join(projectResDir, type, id)
          } catch (e: any) {
            return { success: false, message: t('resources.projectNotInitialized') }
          }
        } else {
          // system/package
          try {
            const resourcePkg = require('@promptx/resource')
            const res = resourcePkg.findResourceById(id)
            if (!res || !res.metadata?.path) {
              return { success: false, message: t('resources.systemResourceNotFound') }
            }
            const absMainFile = resourcePkg.getResourcePath(res.metadata.path)
            sourceDir = path.dirname(absMainFile)
          } catch (e: any) {
            return { success: false, message: t('resources.cannotResolveSystemPath') }
          }
        }

        if (!sourceDir) return { success: false, message: t('resources.cannotLocateResourceDir') }
        const exists = await fs.pathExists(sourceDir)
        if (!exists) return { success: false, message: t('resources.directoryNotExists') + `: ${sourceDir}` }

        // 让用户选择保存 ZIP 文件的位置
        const ret = await dialog.showSaveDialog({
          title: t('resources.selectSaveLocation', { type }),
          defaultPath: `${type}-${id}.zip`,
          filters: [
            { name: 'ZIP Archive', extensions: ['zip'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (ret.canceled || !ret.filePath) {
          return { success: false, message: t('resources.cancelled') }
        }
        const zipFilePath = ret.filePath

        // 创建 ZIP 压缩包（跨平台兼容）
        const zip = new AdmZip()

        // 递归添加目录中的所有文件
        const addDirectoryToZip = async (dirPath: string, zipPath: string = '') => {
          const entries = await fs.readdir(dirPath, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name)
            const zipEntryPath = zipPath ? path.join(zipPath, entry.name) : entry.name

            if (entry.isDirectory()) {
              await addDirectoryToZip(fullPath, zipEntryPath)
            } else {
              zip.addLocalFile(fullPath, zipPath)
            }
          }
        }

        // V2 角色导出时用 roleId 作为 ZIP 内顶层目录，确保导入时能正确还原 ID
        const zipRootPrefix = (type === 'role' && version === 'v2') ? id : ''
        await addDirectoryToZip(sourceDir, zipRootPrefix)

        // 写入 ZIP 文件
        zip.writeZip(zipFilePath)

        return { success: true, path: zipFilePath }
      } catch (error: any) {
        console.error('Failed to download resource:', error)
        return { success: false, message: error?.message || t('resources.downloadFailed') }
      }
    })

    // 新增：删除资源（仅支持删除用户资源）
    ipcMain.handle('resources:delete', async (_evt, payload: { id: string; type: 'role' | 'tool'; source?: string; version?: string }) => {
      try {
        const id = payload?.id
        const type = payload?.type
        const source = payload?.source ?? 'user'
        const version = payload?.version ?? 'v1'

        if (!id || !type) {
          return { success: false, message: t('resources.missingParams') }
        }
        assertSafeResourceId(id)
        if (source !== 'user') {
          return { success: false, message: t('resources.onlyUserDeletable') }
        }

        const fs = require('fs-extra')
        const path = require('path')
        const os = require('os')

        // V2 角色存储在 ~/.rolex/roles/<id>/，V1 及工具存储在 ~/.perseng/resource/<type>/<id>/
        const targetDir = (type === 'role' && version === 'v2')
          ? path.join(os.homedir(), '.rolex', 'roles', id)
          : path.join(os.homedir(), '.perseng', 'resource', type, id)

        const exists = await fs.pathExists(targetDir)
        if (!exists) {
          return { success: false, message: t('resources.directoryNotExists') + `: ${targetDir}` }
        }

        await fs.remove(targetDir)

        // V2 角色：从 ~/.rolex/rolex.json 中移除注册信息
        if (type === 'role' && version === 'v2') {
          const rolexJsonPath = path.join(os.homedir(), '.rolex', 'rolex.json')
          try {
            if (await fs.pathExists(rolexJsonPath)) {
              const rolexData = await fs.readJson(rolexJsonPath)
              if (Array.isArray(rolexData.roles)) {
                rolexData.roles = rolexData.roles.filter((r: string) => r !== id)
              }
              if (rolexData.assignments?.[id]) {
                delete rolexData.assignments[id]
              }
              await fs.writeJson(rolexJsonPath, rolexData, { spaces: 2 })
            }
          } catch (regErr) {
            console.warn('Failed to update rolex.json after delete:', regErr)
          }
        }

        // 清除 Repository 内存缓存，确保下次查询立即反映删除结果
        this.resourceService.invalidateCache()

        // 刷新资源发现，确保UI能看到最新列表
        try {
          // KNUTH-FEAT 2026-07-11: Phase 3 桌面兼容链清理 — 直接走 @promptx/core/pouch 子路径。
          const { DiscoverCommand } = require('@promptx/core/pouch')
          const discover = new DiscoverCommand()
          await discover.refreshAllResources()
        } catch (refreshErr) {
          console.warn('Resource refresh after delete failed:', refreshErr)
        }

        return { success: true }
      } catch (error: any) {
        console.error('Failed to delete resource:', error)
        return { success: false, message: error?.message || t('resources.deleteFailed') }
      }
    })

    // 新增：列出资源文件（仅返回 .md）
    ipcMain.handle('resources:listFiles', async (_evt, payload: { id: string; type: 'role' | 'tool'; source?: string }) => {
      try {
        const id = payload?.id
        const type = payload?.type
        const source = payload?.source ?? 'user'
        if (!id || !type) return { success: false, message: t('resources.missingParams') }
        assertSafeResourceId(id)

        const path = require('path')
        const fs = require('fs-extra')
        const os = require('os')

        // 解析资源根目录
        let sourceDir: string | null = null
        if (source === 'user') {
          sourceDir = path.join(os.homedir(), '.perseng', 'resource', type, id)
        } else if (source === 'project') {
          try {
            const { ProjectPathResolver } = require('@promptx/core')
            const resolver = new ProjectPathResolver()
            const projectResDir = resolver.getResourceDirectory()
            sourceDir = path.join(projectResDir, type, id)
          } catch {
            return { success: false, message: t('resources.projectNotInitialized') }
          }
        } else {
          // system/package
          try {
            const resourcePkg = require('@promptx/resource')
            const res = resourcePkg.findResourceById(id)
            if (!res || !res.metadata?.path) {
              return { success: false, message: t('resources.systemResourceNotFound') }
            }
            const absMainFile = resourcePkg.getResourcePath(res.metadata.path)
            sourceDir = path.dirname(absMainFile)
          } catch {
            return { success: false, message: t('resources.cannotResolveSystemPath') }
          }
        }

        if (!sourceDir || !(await fs.pathExists(sourceDir))) {
          return { success: false, message: t('resources.directoryNotExists') + `: ${sourceDir}` }
        }

        // 递归列出文件，返回相对路径
        const result: string[] = []
        async function walk(dir: string, base: string) {
          const entries = await fs.readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            const rel = path.relative(base, full)
            if (entry.isDirectory()) {
              await walk(full, base)
            } else if (entry.isFile()) {
              // 对于工具，显示所有文件；对于角色，只显示.md文件
              const shouldInclude = type === 'tool' || entry.name.toLowerCase().endsWith('.md')
              if (shouldInclude) {
                // 统一使用正斜杠
                result.push(rel.split(path.sep).join('/'))
              }
            }
          }
        }
        await walk(sourceDir, sourceDir)

        // 特例：若无任何 .md，则尝试返回主目录中可能的 md
        return { success: true, files: result, baseDir: sourceDir }
      } catch (error: any) {
        console.error('Failed to list files:', error)
        return { success: false, message: error?.message || t('resources.listFilesFailed') }
      }
    })

    // 新增：读取资源文件内容
    ipcMain.handle('resources:readFile', async (_evt, payload: { id: string; type: 'role' | 'tool'; source?: string; relativePath: string }) => {
      try {
        const { id, type, relativePath } = payload || {}
        const source = payload?.source ?? 'user'
        if (!id || !type || !relativePath) return { success: false, message: t('resources.missingParams') }
        assertSafeResourceId(id)

        const path = require('path')
        const fs = require('fs-extra')
        const os = require('os')

        let baseDir: string | null = null
        if (source === 'user') {
          baseDir = path.join(os.homedir(), '.perseng', 'resource', type, id)
        } else if (source === 'project') {
          try {
            const { ProjectPathResolver } = require('@promptx/core')
            const resolver = new ProjectPathResolver()
            const projectResDir = resolver.getResourceDirectory()
            baseDir = path.join(projectResDir, type, id)
          } catch {
            return { success: false, message: t('resources.projectNotInitialized') }
          }
        } else {
          try {
            const resourcePkg = require('@promptx/resource')
            const res = resourcePkg.findResourceById(id)
            if (!res || !res.metadata?.path) return { success: false, message: t('resources.systemResourceNotFound') }
            const absMainFile = resourcePkg.getResourcePath(res.metadata.path)
            baseDir = path.dirname(absMainFile)
          } catch {
            return { success: false, message: t('resources.cannotResolveSystemPath') }
          }
        }

        const absPath = resolveSafeRelativePath(baseDir!, relativePath)
        const exists = await fs.pathExists(absPath)
        if (!exists) return { success: false, message: t('resources.fileNotExists') + `: ${relativePath}` }
        const content = await fs.readFile(absPath, 'utf-8')
        return { success: true, content, path: absPath }
      } catch (error: any) {
        console.error('Failed to read file:', error)
        return { success: false, message: error?.message || t('resources.readFileFailed') }
      }
    })

    // 新增：保存资源文件内容（仅允许用户资源）
    ipcMain.handle('resources:saveFile', async (_evt, payload: { id: string; type: 'role' | 'tool'; source?: string; relativePath: string; content: string }) => {
      try {
        const { id, type, relativePath, content } = payload || {}
        const source = payload?.source ?? 'user'
        if (!id || !type || !relativePath) return { success: false, message: t('resources.missingParams') }
        assertSafeResourceId(id)
        if (source !== 'user') return { success: false, message: t('resources.onlyUserEditable') }

        const path = require('path')
        const fs = require('fs-extra')
        const os = require('os')

        const baseDir = path.join(os.homedir(), '.perseng', 'resource', type, id)
        const absPath = resolveSafeRelativePath(baseDir, relativePath)
        const exists = await fs.pathExists(absPath)
        if (!exists) return { success: false, message: t('resources.fileNotExists') + `: ${relativePath}` }

        await fs.writeFile(absPath, content, 'utf-8')
        return { success: true, path: absPath }
      } catch (error: any) {
        console.error('Failed to save file:', error)
        return { success: false, message: error?.message || t('resources.saveFailed') }
      }
    })

    // 新增：更新资源元数据（名称和描述）
    ipcMain.handle('resources:updateMetadata', async (_evt, payload: { id: string; type: 'role' | 'tool'; source?: string; name?: string; description?: string }) => {
      try {
        const { id, type, name, description } = payload || {}
        const source = payload?.source ?? 'user'
        
        if (!id || !type) {
          return { success: false, message: t('resources.missingParams') }
        }
        
        if (source !== 'user') {
          return { success: false, message: t('resources.onlyUserEditable') }
        }

        const updates: { name?: string; description?: string } = {}
        if (name !== undefined) updates.name = name
        if (description !== undefined) updates.description = description

        if (Object.keys(updates).length === 0) {
          return { success: false, message: t('resources.noFieldsToUpdate') }
        }

        const result = await this.resourceService.updateResourceMetadata(id, updates)
        return result
      } catch (error: any) {
        console.error('Failed to update resource metadata:', error)
        return { success: false, message: error?.message || t('resources.updateMetadataFailed') }
      }
    })

    // 新增：导入资源（从压缩包）
    ipcMain.handle('resources:import', async (_evt, payload: {
      filePath: string
      type: 'role' | 'tool'
      customId?: string
      name?: string
      description?: string
      // KNUTH-FEAT 2026-07-04: Import 时可选附加图标（仅角色生效，tool 自然忽略）
      avatarPath?: string
    }) => {
      try {
        const { filePath, type, customId, name, description, avatarPath } = payload || {}

        if (!filePath || !type) {
          return { success: false, message: t('resources.missingParams') }
        }

        const fs = require('fs-extra')
        const path = require('path')
        const os = require('os')
        const AdmZip = require('adm-zip')

        // 验证文件存在
        if (!(await fs.pathExists(filePath))) {
          return { success: false, message: t('resources.fileNotFound') }
        }

        // 创建临时目录
        const tempDir = path.join(os.tmpdir(), `perseng-import-${Date.now()}`)
        await fs.ensureDir(tempDir)

        try {
          // 解压文件
          const zip = new AdmZip(filePath)
          zip.extractAllTo(tempDir, true)

          // 查找资源目录（可能在根目录或一级子目录中）
          let resourceDir: string | null = null
          let resourceId: string | null = null

          const entries = await fs.readdir(tempDir)

          // 检查是否直接在根目录
          const mainFiles = entries.filter((f: string) =>
            f.endsWith('.role.md') || f.endsWith('.tool.js')
          )

          if (mainFiles.length > 0) {
            resourceDir = tempDir
            resourceId = mainFiles[0].replace(/\.(role\.md|tool\.js)$/, '')
          } else if (entries.length === 1) {
            // 检查一级子目录
            const subDir = path.join(tempDir, entries[0])
            const stat = await fs.stat(subDir)
            if (stat.isDirectory()) {
              const subEntries = await fs.readdir(subDir)
              const subMainFiles = subEntries.filter((f: string) =>
                f.endsWith('.role.md') || f.endsWith('.tool.js')
              )
              if (subMainFiles.length > 0) {
                resourceDir = subDir
                resourceId = subMainFiles[0].replace(/\.(role\.md|tool\.js)$/, '')
              }
            }
          }

          if (!resourceDir || !resourceId) {
            await fs.remove(tempDir)
            return { success: false, message: t('resources.invalidResourceStructure') }
          }

          // ==================== 资源类型验证 ====================
          // 验证压缩包内的文件类型是否与用户选择的资源类型匹配
          const validationResult = await this.validateResourceType(resourceDir, type)
          if (!validationResult.valid) {
            await fs.remove(tempDir)
            return { success: false, message: validationResult.message }
          }
          // ======================================================

          // 使用自定义ID或原ID
          const finalId = customId || resourceId
          assertSafeResourceId(finalId)

          // 目标目录
          const userResourceDir = path.join(os.homedir(), '.perseng', 'resource', type, finalId)

          // 检查是否已存在
          if (await fs.pathExists(userResourceDir)) {
            const overwrite = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Cancel', 'Overwrite'],
              defaultId: 0,
              title: t('resources.resourceExists'),
              message: t('resources.resourceExistsMessage', { id: finalId })
            })

            if (overwrite.response === 0) {
              await fs.remove(tempDir)
              return { success: false, message: t('resources.cancelled') }
            }

            await fs.remove(userResourceDir)
          }

          // 复制到用户目录
          await fs.copy(resourceDir, userResourceDir)

          // KNUTH-FEAT 2026-07-04: 头像落盘 → ~/.perseng/resource/<type>/<finalId>/profile.<ext>
          // 仅角色类型 + 用户提供了 avatarPath 才生效；tool 类型自然忽略。
          if (avatarPath && type === 'role' && await fs.pathExists(avatarPath)) {
            await clearAndCopyAvatar(userResourceDir, avatarPath)
          }

          // 如果提供了自定义名称或描述，写入 metadata.json（优先级最高）
          if (name || description) {
            const metadataFile = path.join(userResourceDir, 'metadata.json')
            let existing: Record<string, any> = {}
            if (await fs.pathExists(metadataFile)) {
              try { existing = await fs.readJson(metadataFile) } catch { /* ignore */ }
            }
            await fs.writeJson(metadataFile, {
              ...existing,
              ...(name ? { name } : {}),
              ...(description ? { description } : {}),
              updatedAt: new Date().toISOString(),
            }, { spaces: 2 })
          }

          // 清理临时目录
          await fs.remove(tempDir)

          // 清除 Repository 内存缓存，确保下次查询立即反映导入结果
          this.resourceService.invalidateCache()

          // 刷新资源发现
          try {
            const { DiscoverCommand } = require('@promptx/core/pouch')
            const discover = new DiscoverCommand()
            await discover.refreshAllResources()
          } catch (refreshErr) {
            console.warn('Resource refresh after import failed:', refreshErr)
          }

          return {
            success: true,
            id: finalId,
            message: t('resources.importSuccess', { id: finalId })
          }

        } finally {
          // 确保清理临时目录
          if (await fs.pathExists(tempDir)) {
            await fs.remove(tempDir)
          }
        }

      } catch (error: any) {
        console.error('Failed to import resource:', error)
        return { success: false, message: error?.message || t('resources.importFailed') }
      }
    })

    // 导入 V2 角色（~/.rolex/roles/<id>/identity/）
    ipcMain.handle('resources:importV2Role', async (_evt, payload: {
      filePath: string
      customId?: string
      name?: string
      description?: string
      // KNUTH-FEAT 2026-07-04: V2 import 时可选附加图标
      avatarPath?: string
    }) => {
      try {
        const { filePath, customId, name, description, avatarPath } = payload || {}
        if (!filePath) return { success: false, message: t('resources.missingParams') }

        const fs = require('fs-extra')
        const pathMod = require('path')
        const os = require('os')
        const AdmZip = require('adm-zip')

        if (!(await fs.pathExists(filePath))) {
          return { success: false, message: t('resources.fileNotFound') }
        }

        const tempDir = pathMod.join(os.tmpdir(), `perseng-v2-import-${Date.now()}`)
        await fs.ensureDir(tempDir)

        try {
          const zip = new AdmZip(filePath)
          zip.extractAllTo(tempDir, true)

          // 找到 identity 目录（支持根目录或一级子目录）
          let identityDir: string | null = null
          let roleId: string | null = null

          const tryFindIdentity = async (dir: string): Promise<{ identityDir: string; roleId: string } | null> => {
            const entries: string[] = await fs.readdir(dir)
            if (entries.includes('identity')) {
              const sub = pathMod.join(dir, 'identity')
              const stat = await fs.stat(sub)
              if (stat.isDirectory()) {
                return { identityDir: sub, roleId: pathMod.basename(dir) }
              }
            }
            return null
          }

          const rootResult = await tryFindIdentity(tempDir)
          if (rootResult) {
            identityDir = rootResult.identityDir
            roleId = rootResult.roleId
          } else {
            const entries: string[] = await fs.readdir(tempDir)
            for (const entry of entries) {
              const sub = pathMod.join(tempDir, entry)
              const stat = await fs.stat(sub)
              if (stat.isDirectory()) {
                const result = await tryFindIdentity(sub)
                if (result) { identityDir = result.identityDir; roleId = result.roleId; break }
              }
            }
          }

          if (!identityDir || !roleId) {
            await fs.remove(tempDir)
            return { success: false, message: t('resources.invalidResourceStructure') }
          }

          const finalId = customId || roleId
          assertSafeResourceId(finalId)
          const targetDir = pathMod.join(os.homedir(), '.rolex', 'roles', finalId, 'identity')

          if (await fs.pathExists(targetDir)) {
            const overwrite = await dialog.showMessageBox({
              type: 'question',
              buttons: ['Cancel', 'Overwrite'],
              defaultId: 0,
              title: t('resources.resourceExists'),
              message: t('resources.resourceExistsMessage', { id: finalId })
            })
            if (overwrite.response === 0) {
              await fs.remove(tempDir)
              return { success: false, message: t('resources.cancelled') }
            }
            await fs.remove(targetDir)
          }

          await fs.ensureDir(pathMod.dirname(targetDir))
          await fs.copy(identityDir, targetDir)

          // KNUTH-FEAT 2026-07-04: V2 头像落盘 → ~/.rolex/roles/<id>/profile.<ext>
          // 与 metadata.json 同级（pathMod.dirname(targetDir)），不入 identity/ 子目录，
          // 避免污染 RoleX 的身份定义目录。getRoleAvatar 已搜此路径（第二候选）。
          if (avatarPath && await fs.pathExists(avatarPath)) {
            const roleLevelDir = pathMod.dirname(targetDir)
            await clearAndCopyAvatar(roleLevelDir, avatarPath)
          }

          // 写入自定义 metadata（name/description）
          if (name || description) {
            const metadataFile = pathMod.join(pathMod.dirname(targetDir), 'metadata.json')
            await fs.writeJson(metadataFile, {
              ...(name ? { name } : {}),
              ...(description ? { description } : {}),
              updatedAt: new Date().toISOString(),
            }, { spaces: 2 })
          }

          // 注册到 ~/.rolex/rolex.json
          const rolexJsonPath = pathMod.join(os.homedir(), '.rolex', 'rolex.json')
          try {
            let rolexData: any = { roles: [], organizations: {}, assignments: {} }
            if (await fs.pathExists(rolexJsonPath)) {
              rolexData = await fs.readJson(rolexJsonPath)
            }
            if (!Array.isArray(rolexData.roles)) rolexData.roles = []
            if (!rolexData.roles.includes(finalId)) {
              rolexData.roles.push(finalId)
              await fs.writeJson(rolexJsonPath, rolexData, { spaces: 2 })
            }
          } catch (regErr) {
            console.warn('Failed to register V2 role in rolex.json:', regErr)
          }

          await fs.remove(tempDir)
          return { success: true, id: finalId, message: t('resources.importSuccess', { id: finalId }) }
        } finally {
          if (await fs.pathExists(tempDir)) await fs.remove(tempDir)
        }
      } catch (error: any) {
        console.error('Failed to import V2 role:', error)
        return { success: false, message: error?.message || t('resources.importFailed') }
      }
    })

    // 预览完整提示词（DPML -> Prompt）
    ipcMain.handle('resources:previewPrompt', async (_evt, payload: {
      id: string
      type: 'role' | 'tool'
      source: string
      roleResources?: string
    }) => {
      try {
        const { id, type, roleResources } = payload || {}

        if (!id || !type) {
          return { success: false, message: t('resources.missingParams') }
        }

        // 只支持角色类型的预览
        if (type !== 'role') {
          return { success: false, message: t('resources.preview.onlyRoleSupported') }
        }

        // 使用 CLI 执行 action 命令（与 MCP action 工具相同的方式）
        const core = await import('@promptx/core')
        const coreExports = (core as any).default || core
        const cli = (coreExports as any).cli || (coreExports as any).pouch?.cli

        if (!cli || !cli.execute) {
          return { success: false, message: 'CLI not available in @promptx/core' }
        }

        // 构建参数（与 MCP action tool 一致，roleResources 作为第二个位置参数）
        const args: string[] = [id]
        if (roleResources) {
          args.push(roleResources)
        }

        // 执行 action 命令获取渲染后的提示词
        const result = await cli.execute('action', args)

        // result 包含渲染后的完整提示词
        if (result && typeof result === 'string') {
          return { success: true, prompt: result }
        } else if (result && result.output) {
          return { success: true, prompt: result.output }
        } else if (result && result.content) {
          return { success: true, prompt: result.content }
        } else {
          // 尝试将结果转为字符串
          const promptText = String(result || '')
          return { success: true, prompt: promptText || t('resources.preview.empty') }
        }
      } catch (error: any) {
        console.error('Failed to preview prompt:', error)
        return { success: false, message: error?.message || t('resources.preview.failed') }
      }
    })

    // V2 角色数据（身份、目标、组织）
    ipcMain.handle('resources:getV2RoleData', async (_evt, payload: { roleId: string }) => {
      try {
        assertSafeResourceId(payload.roleId)
        const core = await import('@promptx/core')
        const coreExports = (core as any).default || core
        const { RolexActionDispatcher } = (coreExports as any).rolex
        const dispatcher = new RolexActionDispatcher()

        // 激活角色获取身份文本（同时设置 currentRoleName）
        const identity = await dispatcher.dispatch('activate', { role: payload.roleId })

        // 获取当前目标
        let focus = null
        try {
          focus = await dispatcher.dispatch('focus', { role: payload.roleId })
        } catch { /* no active goals */ }

        // 获取组织目录
        let directory = null
        try {
          directory = await dispatcher.dispatch('directory', { role: payload.roleId })
        } catch { /* no organizations */ }

        return { success: true, identity, focus, directory }
      } catch (error: any) {
        return { success: false, message: error?.message }
      }
    })

    // 获取 RoleX 组织目录
    ipcMain.handle('rolex:directory', async (_evt) => {
      try {
        const core = await import('@promptx/core')
        const coreExports = (core as any).default || core
        const { RolexActionDispatcher } = (coreExports as any).rolex
        const dispatcher = new RolexActionDispatcher()

        // directory() 现在返回结构化的 JSON 数据
        const directory = await dispatcher.dispatch('directory', {})

        return { success: true, data: directory }
      } catch (error: any) {
        console.error('Failed to get directory:', error)
        return { success: false, message: error?.message }
      }
    })

    // V2 角色文件列表（~/.rolex/roles/<id>/identity/）
    ipcMain.handle('resources:listV2RoleFiles', async (_evt, payload: { roleId: string }) => {
      try {
        assertSafeResourceId(payload.roleId)
        const fs = require('fs-extra')
        const os = require('os')
        const identityDir = path.join(os.homedir(), '.rolex', 'roles', payload.roleId, 'identity')
        if (!await fs.pathExists(identityDir)) {
          return { success: false, message: 'Identity directory not found' }
        }
        const entries: string[] = await fs.readdir(identityDir)
        const files = entries.filter((f: string) => f.endsWith('.feature'))
        return { success: true, files, baseDir: identityDir }
      } catch (error: any) {
        return { success: false, message: error?.message }
      }
    })

    // V2 角色文件读取
    ipcMain.handle('resources:readV2RoleFile', async (_evt, payload: { roleId: string; fileName: string }) => {
      try {
        assertSafeResourceId(payload.roleId)
        assertSafeFileName(payload.fileName, '.feature')
        const fs = require('fs-extra')
        const os = require('os')
        const filePath = path.join(os.homedir(), '.rolex', 'roles', payload.roleId, 'identity', payload.fileName)
        if (!await fs.pathExists(filePath)) {
          return { success: false, message: 'File not found' }
        }
        const content = await fs.readFile(filePath, 'utf-8')
        return { success: true, content }
      } catch (error: any) {
        return { success: false, message: error?.message }
      }
    })

    // V2 角色文件保存（仅用户角色）
    ipcMain.handle('resources:saveV2RoleFile', async (_evt, payload: { roleId: string; fileName: string; content: string }) => {
      try {
        assertSafeResourceId(payload.roleId)
        assertSafeFileName(payload.fileName, '.feature')
        const fs = require('fs-extra')
        const os = require('os')
        const filePath = path.join(os.homedir(), '.rolex', 'roles', payload.roleId, 'identity', payload.fileName)
        await fs.writeFile(filePath, payload.content, 'utf-8')
        return { success: true }
      } catch (error: any) {
        return { success: false, message: error?.message }
      }
    })

    // V2 角色身份结构（从数据库读取）
    ipcMain.handle('rolex:getIdentityNodes', async (_evt, payload: { roleId: string }) => {
      try {
        assertSafeResourceId(payload.roleId)
        // KNUTH-FEAT 2026-07-11: Phase 3 桌面兼容链清理 — 直接走 @promptx/core/rolex 子路径。
        const { getRolexBridge } = require('@promptx/core/rolex')
        const bridge = getRolexBridge()
        const identityText = await bridge.identity(payload.roleId)
        console.log('[rolex:getIdentityNodes] roleId:', payload.roleId)
        console.log('[rolex:getIdentityNodes] identityText type:', typeof identityText)

        // Parse the text into structured nodes
        const nodes: any[] = []
        if (typeof identityText === 'string') {
          // Split by ## markers to find top-level nodes
          const sections = identityText.split(/\n## \[/)
          for (let i = 1; i < sections.length; i++) {
            const section = sections[i]
            if (!section) continue
            // Extract node type and id from [type] (id)
            const match = section.match(/^([^\]]+)\]\s*\(([^)]+)\)/)
            if (match) {
              const nodeType = match[1]?.trim() ?? ''
              const nodeId = match[2]?.trim() ?? ''
              // Extract the content (everything after the first line until next ## or end)
              const contentMatch = section.match(/\n([\s\S]*?)(?=\n## \[|$)/)
              const content = contentMatch && contentMatch[1] ? contentMatch[1].trim() : ''

              if (nodeType && nodeId) {
                nodes.push({
                  id: nodeId,
                  name: nodeId,
                  type: nodeType,
                  information: content
                })
              }
            }
          }
        }

        console.log('[rolex:getIdentityNodes] Parsed nodes:', nodes.length)
        return { success: true, data: nodes }
      } catch (error: any) {
        console.error('[rolex:getIdentityNodes] Error:', error)
        return { success: false, message: error?.message }
      }
    })

    // 获取角色头像（profile.png/jpg/jpeg/webp）→ base64 data URL
    ipcMain.handle('resources:getRoleAvatar', async (_evt, payload: { id: string; source?: string }) => {
      try {
        const { id } = payload || {}
        const source = payload?.source ?? 'user'
        if (!id) return { success: true, data: null }
        assertSafeResourceId(id)

        const pathMod = require('path')
        const fs = require('fs-extra')
        const os = require('os')
        const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp']

        const findProfile = async (dir: string): Promise<string | null> => {
          for (const ext of IMAGE_EXTS) {
            const p = pathMod.join(dir, `profile.${ext}`)
            if (await fs.pathExists(p)) return p
          }
          return null
        }

        let avatarPath: string | null = null
        // ============ DEBUG: 临时诊断日志(2026-07-04) 已撤掉，V1/V2 路径修完 ============

        if (source === 'user') {
          // KNUTH-FIX 2026-07-04: V2 角色的物理目录是 ~/.rolex/roles/<id>/identity/，
          // 头像文件可能在 identity/profile.* 或直接在 ~/.rolex/roles/<id>/profile.*。
          // V1 标准路径 ~/.perseng/resource/role/<id>/profile.* 也保留作为兜底。
          const candidates = [
            pathMod.join(os.homedir(), '.perseng', 'resource', 'role', id),
            pathMod.join(os.homedir(), '.rolex', 'roles', id),
            pathMod.join(os.homedir(), '.rolex', 'roles', id, 'identity'),
          ]
          for (const dir of candidates) {
            const found = await findProfile(dir)
            if (found) { avatarPath = found; break }
          }
        } else if (source === 'project') {
          try {
            const { ProjectPathResolver } = require('@promptx/core')
            const resolver = new ProjectPathResolver()
            avatarPath = await findProfile(pathMod.join(resolver.getResourceDirectory(), 'role', id))
          } catch { /* ignore */ }
        } else {
          // system — resolve via @promptx/resource main entry → dist/resources/
          // Works in both dev (workspace) and production (inside app.asar, Electron patches fs)
          try {
            const mainPath = require.resolve('@promptx/resource')
            const distDir = pathMod.dirname(mainPath)
            avatarPath = await findProfile(pathMod.join(distDir, 'resources', 'role', id))
          } catch { /* ignore */ }
        }

        if (!avatarPath) return { success: true, data: null }

        const buf = await fs.readFile(avatarPath)
        const ext = pathMod.extname(avatarPath).toLowerCase().slice(1)
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
        return { success: true, data: `data:${mime};base64,${buf.toString('base64')}` }
      } catch (error: any) {
        console.error('Failed to get role avatar:', error)
        return { success: true, data: null }
      }
    })

    // 上传角色头像（仅用户角色）
    ipcMain.handle('resources:uploadRoleAvatar', async (_evt, payload: { id: string; source?: string; imagePath: string; version?: string }) => {
      try {
        const { id, imagePath } = payload || {}
        const source = payload?.source ?? 'user'
        const version = payload?.version ?? 'v1'
        if (!id || !imagePath) return { success: false, message: 'Missing params' }
        assertSafeResourceId(id)

        const pathMod = require('path')
        const fs = require('fs-extra')
        const os = require('os')

        if (source !== 'user') return { success: false, message: 'Only user roles support avatar upload' }

        // KNUTH-FIX 2026-07-06: V1/V2 物理目录不同
        //   V1 user: ~/.perseng/resource/role/<id>/
        //   V2 user: ~/.rolex/roles/<id>/（与 identity/ 同级，与 getRoleAvatar 读端对齐）
        // 之前写死 V1 路径，导致 V2 角色上传直接走 "Role directory not found" 静默失败
        // （参考 packages/core/src/rolex/RolexBridge.js:160 isV2Role 与 DiscoverCommand.js:270 v2: 前缀）
        const roleDir = version === 'v2'
          ? pathMod.join(os.homedir(), '.rolex', 'roles', id)
          : pathMod.join(os.homedir(), '.perseng', 'resource', 'role', id)
        await fs.ensureDir(roleDir)  // V1 目录不存在时自动创建（兼容 V1 新角色）

        // Remove any existing profile.* files
        for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
          const existing = pathMod.join(roleDir, `profile.${ext}`)
          if (await fs.pathExists(existing)) await fs.remove(existing)
        }

        const ext = pathMod.extname(imagePath).toLowerCase().slice(1) || 'png'
        await fs.copy(imagePath, pathMod.join(roleDir, `profile.${ext}`), { overwrite: true })
        return { success: true }
      } catch (error: any) {
        console.error('Failed to upload role avatar:', error)
        return { success: false, message: error.message || 'Upload failed' }
      }
    })
  }

  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show()
      this.window.focus()
      return
    }

    this.createWindow()
  }

  hide(): void {
    this.window?.hide()
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close()
    }
    this.window = null
  }

  private createWindow(): void {
    const preloadPath = path.join(__dirname, '../preload/preload.cjs')

    this.window = new BrowserWindow(createFramelessWindowOptions({
      width: 900,
      height: 700,
      minWidth: 820,
      minHeight: 620,
      title: t('tray.windows.resources'),
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'user-gesture-required' // 禁用媒体自动播放
      },
      show: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      center: true
    }))

    applyFramelessWindowChrome(this.window)
    this.teardownWindowStateSync = bindWindowStateSync(this.window)

    // 加载资源管理页面
    if (process.env.ELECTRON_RENDERER_URL) {
      this.window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/resources`)
    } else {
      const indexHtmlPath = path.join(__dirname, '../renderer/index.html')
      this.window.loadFile(indexHtmlPath, { hash: '/resources' })
    }

    this.window.once('ready-to-show', () => {
      this.window?.show()
      // 开发模式下自动打开 DevTools
      if (process.env.ELECTRON_RENDERER_URL) {
        this.window?.webContents.openDevTools()
      }
    })

    this.window.on('closed', () => {
      this.teardownWindowStateSync?.()
      this.teardownWindowStateSync = null
      this.window = null
    })
  }
}
