/**
 * PackageInstaller - 基于 Arborist 的完整依赖管理器
 *
 * 使用 npm 官方的 @npmcli/arborist，提供与 npm install 完全一致的行为。
 * 自动处理所有传递依赖、版本冲突、循环依赖等复杂场景。
 * 修复 issue #332：传递依赖未自动安装的问题。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import logger from '@promptx/logger'

type DependencyValue = string | undefined
type DependencyInput = Record<string, DependencyValue> | string[] | string | null | undefined

interface PackageJsonManifest {
  name: string
  version: string
  description?: string
  private?: boolean
  dependencies?: Record<string, string>
  [k: string]: unknown
}

interface InstallOptions {
  workingDir: string
  dependencies: DependencyInput
  timeout?: number
}

interface InstallResult {
  success: boolean
  elapsed: string
  manifest: PackageJsonManifest
  environment: string
  installedPackages: string[]
  results: Record<string, { name: string; version: string; path: string }>
}

class PackageInstaller {
  /**
   * 获取最优的 npm registry
   */
  static async getOptimalRegistry(): Promise<string> {
    try {
      // 1. 环境变量配置
      const userRegistry = process.env.NPM_REGISTRY || process.env.npm_config_registry
      if (userRegistry) {
        logger.info(`[PackageInstaller] Using user configured registry: ${userRegistry}`)
        return userRegistry
      }

      // 2. 检测中国地区
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const isChina =
        (timezone && (timezone.includes('Shanghai') ||
          timezone.includes('Hong_Kong') ||
          timezone.includes('Beijing') ||
          timezone.includes('Chongqing'))) ||
        false

      if (isChina) {
        const chinaRegistry = 'https://registry.npmmirror.com'
        logger.info(`[PackageInstaller] Detected China timezone (${timezone}), using mirror: ${chinaRegistry}`)
        return chinaRegistry
      }

      // 3. 默认官方源
      const defaultRegistry = 'https://registry.npmjs.org/'
      logger.debug(`[PackageInstaller] Using default registry: ${defaultRegistry}`)
      return defaultRegistry
    } catch (error) {
      logger.warn(`[PackageInstaller] Failed to detect optimal registry: ${(error as Error).message}`)
      return 'https://registry.npmjs.org/'
    }
  }

  /**
   * 统一的包安装入口
   */
  static async install({ workingDir, dependencies }: InstallOptions): Promise<InstallResult> {
    const startTime = Date.now()

    const depsList = PackageInstaller.buildDependenciesList(dependencies)
    logger.info(`[PackageInstaller] Starting installation via Arborist: [${depsList}]`)
    logger.debug(`[PackageInstaller] Working directory: ${workingDir}`)

    try {
      // 确保工作目录存在
      await fs.mkdir(workingDir, { recursive: true })

      // 读取或创建 package.json
      const packageJsonPath = path.join(workingDir, 'package.json')
      let manifest: PackageJsonManifest

      try {
        const content = await fs.readFile(packageJsonPath, 'utf8')
        manifest = JSON.parse(content) as PackageJsonManifest
        logger.debug(`[PackageInstaller] Found existing package.json`)
      } catch {
        // package.json 不存在，创建默认的
        manifest = {
          name: `toolbox-${path.basename(workingDir)}`,
          version: '1.0.0',
          description: `Tool dependencies for ${path.basename(workingDir)}`,
          private: true,
          dependencies: {},
        }
        logger.debug(`[PackageInstaller] Creating new package.json`)
      }

      const normalizedDeps = PackageInstaller.normalizeDependencies(dependencies)
      manifest.dependencies = { ...manifest.dependencies, ...normalizedDeps }
      await fs.writeFile(packageJsonPath, JSON.stringify(manifest, null, 2))

      logger.debug(`[PackageInstaller] Installing ${Object.keys(normalizedDeps).length} dependencies using Arborist`)

      // 使用 Arborist 安装
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ArboristModule = require('@npmcli/arborist')
      const Arborist = (ArboristModule as { Arborist?: unknown; default?: unknown }).Arborist ||
        (ArboristModule as { default?: unknown }).default ||
        ArboristModule

      const registry = await PackageInstaller.getOptimalRegistry()

      // KNUTH-NOTE: Arborist 类型定义复杂，使用 unknown + 鸭子类型
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arb = new (Arborist as any)({
        path: workingDir,
        registry,
        cache: path.join(os.homedir(), '.npm', '_cacache'),
        save: false,
        omit: [],
        force: false,
        fund: false,
        audit: false,
        legacyPeerDeps: true,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (arb as any).reify({
        add: Object.entries(normalizedDeps).map(([name, version]) => `${name}@${version}`),
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tree = await (arb as any).loadActual()
      const installedPackages: string[] = []
      const installResults: Record<string, { name: string; version: string; path: string }> = {}

      for (const [name, node] of (tree as { children: Map<string, { package?: { name: string; version: string }; path: string }> }).children) {
        if (node && node.package) {
          installedPackages.push(name)
          installResults[name] = {
            name: node.package.name,
            version: node.package.version,
            path: node.path,
          }
          logger.debug(`[PackageInstaller] ✓ ${name}@${node.package.version} installed`)
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      logger.info(`[PackageInstaller] Installation completed successfully in ${elapsed}s`)
      logger.info(`[PackageInstaller] Installed ${installedPackages.length} packages with all transitive dependencies`)

      return {
        success: true,
        elapsed,
        manifest,
        environment: 'arborist',
        installedPackages,
        results: installResults,
      }
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      logger.error(`[PackageInstaller] Installation failed after ${elapsed}s: ${(error as Error).message}`)
      throw new Error(`Arborist installation failed: ${(error as Error).message}`)
    }
  }

  /**
   * 构建依赖列表字符串用于日志
   */
  static buildDependenciesList(dependencies: DependencyInput): string {
    if (!dependencies) return ''
    if (typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      return Object.keys(dependencies)
        .map((name) => `${name}@${dependencies[name]}`)
        .join(', ')
    }
    if (Array.isArray(dependencies)) {
      return dependencies.join(', ')
    }
    return String(dependencies)
  }

  /**
   * 规范化依赖格式为对象
   */
  static normalizeDependencies(dependencies: DependencyInput): Record<string, string> {
    if (!dependencies) return {}
    if (typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      const result: Record<string, string> = {}
      for (const [name, version] of Object.entries(dependencies)) {
        result[name] = String(version ?? 'latest')
      }
      return result
    }
    if (Array.isArray(dependencies)) {
      const normalized: Record<string, string> = {}
      for (const dep of dependencies) {
        if (dep.includes('@')) {
          const lastAtIndex = dep.lastIndexOf('@')
          if (lastAtIndex > 0) {
            const name = dep.substring(0, lastAtIndex)
            const version = dep.substring(lastAtIndex + 1)
            normalized[name] = version
          } else {
            normalized[dep] = 'latest'
          }
        } else {
          normalized[dep] = 'latest'
        }
      }
      return normalized
    }
    return {}
  }

  /**
   * 创建 package.json 文件
   */
  static async createPackageJson(
    workingDir: string,
    toolId: string,
    dependencies: DependencyInput,
  ): Promise<void> {
    const packageJsonPath = path.join(workingDir, 'package.json')

    const packageJson: PackageJsonManifest = {
      name: `toolbox-${toolId}`,
      version: '1.0.0',
      description: `Sandbox for tool: ${toolId}`,
      private: true,
      dependencies: PackageInstaller.normalizeDependencies(dependencies),
    }

    logger.debug(`[PackageInstaller] Creating package.json: ${packageJsonPath}`)
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2))
  }

  /**
   * 检查包是否已安装
   */
  static async isPackageInstalled(workingDir: string, packageName: string): Promise<boolean> {
    try {
      const packagePath = packageName.startsWith('@')
        ? path.join(workingDir, 'node_modules', ...packageName.split('/'))
        : path.join(workingDir, 'node_modules', packageName)

      const packageJsonPath = path.join(packagePath, 'package.json')
      await fs.access(packageJsonPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取已安装包的信息
   */
  static async getPackageInfo(workingDir: string, packageName: string): Promise<unknown> {
    try {
      const packagePath = packageName.startsWith('@')
        ? path.join(workingDir, 'node_modules', ...packageName.split('/'))
        : path.join(workingDir, 'node_modules', packageName)

      const packageJsonPath = path.join(packagePath, 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }
}

export = PackageInstaller
