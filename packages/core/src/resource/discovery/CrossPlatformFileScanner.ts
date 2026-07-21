/**
 * CrossPlatformFileScanner - 跨平台文件扫描器
 *
 * 替代glob库，使用Node.js原生fs API实现跨平台文件扫描
 * 避免glob在Windows上的兼容性问题
 */
import fs from 'fs-extra'
import path from 'path'
import { warn as logWarn } from '@promptx/logger'

type ResourceType = 'role' | 'execution' | 'thought' | 'knowledge' | 'tool' | string

interface ScanOptions {
  extensions: string[]
  subdirs?: string[] | null
  maxDepth?: number
}

const RESOURCE_CONFIG: Record<string, { extensions: string[]; subdirs: string[] | null }> = {
  role: {
    extensions: ['.role.md'],
    subdirs: null, // 不限制子目录，在所有地方查找role文件
  },
  execution: {
    extensions: ['.execution.md'],
    subdirs: null,
  },
  thought: {
    extensions: ['.thought.md'],
    subdirs: null,
  },
  knowledge: {
    extensions: ['.knowledge.md'],
    subdirs: null,
  },
  tool: {
    extensions: ['.tool.js'],
    subdirs: null,
  },
}

// KNUTH-FIX 2026-07-21: 用 `export =` 让 tsup cjsInterop 不包成 namespace，
// 旧 .js 消费者 (FilePatternDiscovery.js, PackageDiscovery.js) 直接 `require()` 当 class 用。
class CrossPlatformFileScanner {
  /**
   * 递归扫描目录，查找匹配的文件
   */
  async scanFiles(baseDir: string, options: ScanOptions): Promise<string[]> {
    const extensions = options.extensions ?? []
    const subdirs = options.subdirs ?? null
    const maxDepth = options.maxDepth ?? 5

    if (!(await fs.pathExists(baseDir))) {
      return []
    }

    const results: string[] = []
    await this._scanRecursive(baseDir, baseDir, extensions, subdirs, maxDepth, 0, results)
    return results
  }

  /**
   * 扫描特定类型的资源文件
   */
  async scanResourceFiles(baseDir: string, resourceType: ResourceType): Promise<string[]> {
    const config = RESOURCE_CONFIG[resourceType]
    if (!config) {
      throw new Error(`Unsupported resource type: ${resourceType}`)
    }

    return await this.scanFiles(baseDir, config)
  }

  /**
   * 递归扫描目录的内部实现
   */
  private async _scanRecursive(
    currentDir: string,
    baseDir: string,
    extensions: string[],
    subdirs: string[] | null,
    maxDepth: number,
    currentDepth: number,
    results: string[],
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      return
    }

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)

        if (entry.isFile()) {
          // 检查文件扩展名
          if (this._matchesExtensions(entry.name, extensions)) {
            results.push(fullPath)
          }
        } else if (entry.isDirectory()) {
          // 检查是否应该扫描这个子目录
          if (this._shouldScanDirectory(entry.name, subdirs, currentDepth)) {
            await this._scanRecursive(fullPath, baseDir, extensions, subdirs, maxDepth, currentDepth + 1, results)
          }
        }
      }
    } catch (error) {
      // 忽略权限错误或其他文件系统错误
      logWarn(`[CrossPlatformFileScanner] Failed to scan directory ${currentDir}: ${(error as Error).message}`)
    }
  }

  /**
   * 检查文件名是否匹配指定扩展名
   */
  private _matchesExtensions(fileName: string, extensions: string[]): boolean {
    if (!extensions || extensions.length === 0) {
      return true // 如果没有指定扩展名，匹配所有文件
    }

    return extensions.some((ext) => fileName.endsWith(ext))
  }

  /**
   * 检查是否应该扫描指定目录
   */
  private _shouldScanDirectory(dirName: string, subdirs: string[] | null, currentDepth: number): boolean {
    // 跳过隐藏目录和node_modules
    if (dirName.startsWith('.') || dirName === 'node_modules') {
      return false
    }

    // 如果没有指定子目录限制，扫描所有目录
    if (!subdirs || subdirs.length === 0) {
      return true
    }

    // 在根级别，只扫描指定的子目录
    if (currentDepth === 0) {
      return subdirs.includes(dirName)
    }

    // 在更深层级，扫描所有目录
    return true
  }

  /**
   * 规范化路径，确保跨平台兼容性
   */
  normalizePath(filePath: string): string {
    return path.normalize(filePath).replace(/\\/g, '/')
  }

  /**
   * 生成相对路径，确保跨平台兼容性
   */
  getRelativePath(from: string, to: string): string {
    const relativePath = path.relative(from, to)
    return relativePath.replace(/\\/g, '/')
  }
}

export = CrossPlatformFileScanner