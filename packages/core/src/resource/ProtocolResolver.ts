/**
 * ProtocolResolver - 协议路径解析
 *
 * 支持 @、@!、@? 三种加载语义前缀的 reference 解析
 * 解析 package / project / file 三种协议路径
 */
import path from 'path'
import fs from 'fs'
import { getDirectoryService } from '../utils/DirectoryService'
import { PACKAGE_NAMES } from '../constants'

export interface ParsedReferenceParts {
  loadingSemantic: '' | '!' | '?'
  protocol: string
  resourcePath: string
  fullReference: string
}

export class ProtocolResolver {
  public packageRoot: string | null = null
  // KNUTH-NOTE: 保留 __dirname 字段 —— 旧 .js 用它做 findPackageRoot 的 traverse 起点
  public readonly __dirname: string = __dirname
  // KNUTH-NOTE: DirectoryService 实际未暴露 getProjectRoot，下面 try/catch 调用会 fallback。
  // 类型用窄接口保留运行时行为；调用栈不会真用到这个方法。
  private readonly directoryService: ReturnType<typeof getDirectoryService> & {
    getProjectRoot: (ctx: { startDir: string; platform: NodeJS.Platform; avoidUserHome: boolean }) => Promise<string>
  }

  constructor() {
    this.directoryService = getDirectoryService() as ReturnType<typeof getDirectoryService> & {
      getProjectRoot: (ctx: { startDir: string; platform: NodeJS.Platform; avoidUserHome: boolean }) => Promise<string>
    }
  }

  parseReference(reference: string): ParsedReferenceParts {
    // 支持 @、@!、@? 三种加载语义前缀
    const match = reference.match(/^@([!?]?)(\w+):\/\/(.+)$/)
    if (!match) {
      throw new Error(`Invalid reference format: ${reference}`)
    }

    const loadingSemantic = (match[1] || '') as '' | '!' | '?'
    const protocol = match[2] ?? ''
    const resourcePath = match[3] ?? ''

    return {
      loadingSemantic,
      protocol,
      resourcePath,
      fullReference: reference,
    }
  }

  async resolve(reference: string): Promise<string> {
    const { protocol, resourcePath } = this.parseReference(reference)

    switch (protocol) {
      case 'package':
        return await this.resolvePackage(resourcePath)
      case 'project':
        return await this.resolveProject(resourcePath)
      case 'file':
        return await this.resolveFile(resourcePath)
      default:
        throw new Error(`Unsupported protocol: ${protocol}`)
    }
  }

  async resolvePackage(relativePath: string): Promise<string> {
    if (!this.packageRoot) {
      this.packageRoot = await this.findPackageRoot()
    }
    return path.resolve(this.packageRoot, relativePath)
  }

  async resolveProject(relativePath: string): Promise<string> {
    try {
      const context = {
        startDir: process.cwd(),
        platform: process.platform,
        avoidUserHome: true,
      }
      const projectRoot = await this.directoryService.getProjectRoot(context)
      return path.resolve(projectRoot, relativePath)
    } catch {
      // 回退到原始逻辑
      return path.resolve(process.cwd(), relativePath)
    }
  }

  async resolveFile(filePath: string): Promise<string> {
    if (path.isAbsolute(filePath)) {
      return filePath
    }

    try {
      const context = {
        startDir: process.cwd(),
        platform: process.platform,
        avoidUserHome: true,
      }
      const projectRoot = await this.directoryService.getProjectRoot(context)
      return path.resolve(projectRoot, filePath)
    } catch {
      // 回退到原始逻辑
      return path.resolve(process.cwd(), filePath)
    }
  }

  async findPackageRoot(): Promise<string> {
    let dir: string = this.__dirname
    while (dir !== path.parse(dir).root) {
      const packageJson = path.join(dir, 'package.json')
      // KNUTH-FIX 2026-07-09: 防御 traverse 路径上不存在 package.json 的目录
      // (例如仓库根下的 packages/ 聚合层, 没有独立 package.json).
      // 之前没 try/catch 时 fs.readFileSync 直接 throw ENOENT, 让 AgentX
      // server start 挂掉 (packages/core/dist/index.js:5047)。
      try {
        if (fs.existsSync(packageJson)) {
          const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8')) as { name?: string }
          // 支持配置的包名列表，同时也支持 'promptx' 作为开发版本名称
          const allNames = (PACKAGE_NAMES as { ALL: string[] }).ALL
          if (pkg.name === 'promptx' || allNames.includes(pkg.name ?? '')) {
            return dir
          }
        }
      } catch {
        // 跳过无法读取的 package.json, 继续向上找
      }
      dir = path.dirname(dir)
    }
    throw new Error('Perseng package root not found')
  }
}

export default ProtocolResolver