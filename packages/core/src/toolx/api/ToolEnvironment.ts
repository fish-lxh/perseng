/**
 * ToolEnvironment - 工具环境变量管理器
 *
 * 为每个工具提供独立的环境变量管理。
 * 存储位置：~/.perseng/user/toolbox/{toolId}/.env
 *
 * 特性：
 * - 工具级环境变量隔离
 * - 支持 .env 文件格式
 * - 运行时读写能力
 * - 敏感信息管理（API Keys 等）
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import logger from '@promptx/logger'

type EnvValue = string | number | boolean | null | undefined

class ToolEnvironment {
  public toolId: string
  public envPath: string
  public envCache: Record<string, string> | null

  constructor(toolId: string, toolboxPath: string) {
    this.toolId = toolId
    this.envPath = path.join(toolboxPath, '.env')
    this.envCache = null // 缓存已加载的环境变量
    logger.debug(`[ToolEnvironment] Initialized for tool: ${toolId}, path: ${this.envPath}`)
  }

  /**
   * 获取环境变量值（同步方法）
   */
  get(key: string): string | undefined {
    if (typeof key !== 'string') {
      throw new Error('Environment variable key must be a string')
    }

    const env = this._loadEnvSync()
    return env[key]
  }

  /**
   * 设置环境变量
   */
  async set(key: string, value: EnvValue): Promise<void> {
    if (typeof key !== 'string') {
      throw new Error('Environment variable key must be a string')
    }

    // 环境变量值应该是字符串
    const strValue = value === undefined || value === null ? '' : String(value)

    const env = await this._loadEnv()
    env[key] = strValue
    await this._saveEnv(env)

    // 更新缓存
    this.envCache = env

    logger.debug(`[ToolEnvironment] Set env "${key}" for tool: ${this.toolId}`)
  }

  /**
   * 删除环境变量
   */
  async delete(key: string): Promise<boolean> {
    if (typeof key !== 'string') {
      throw new Error('Environment variable key must be a string')
    }

    const env = await this._loadEnv()
    const exists = key in env

    if (exists) {
      delete env[key]
      await this._saveEnv(env)
      this.envCache = env
      logger.debug(`[ToolEnvironment] Deleted env "${key}" for tool: ${this.toolId}`)
    }

    return exists
  }

  /**
   * 获取所有环境变量（同步方法）
   */
  getAll(): Record<string, string> {
    return this._loadEnvSync()
  }

  /**
   * 检查环境变量是否存在（同步方法）
   */
  has(key: string): boolean {
    if (typeof key !== 'string') {
      throw new Error('Environment variable key must be a string')
    }

    const env = this._loadEnvSync()
    return key in env
  }

  /**
   * 清空所有环境变量
   */
  async clear(): Promise<void> {
    await this._saveEnv({})
    this.envCache = {}
    logger.debug(`[ToolEnvironment] Cleared all env vars for tool: ${this.toolId}`)
  }

  /**
   * 批量设置环境变量
   */
  async setAll(vars: Record<string, EnvValue>): Promise<void> {
    if (!vars || typeof vars !== 'object') {
      throw new Error('Environment variables must be an object')
    }

    const env = await this._loadEnv()

    // 将所有值转换为字符串
    for (const [key, value] of Object.entries(vars)) {
      env[key] = value === undefined || value === null ? '' : String(value)
    }

    await this._saveEnv(env)
    this.envCache = env

    logger.debug(`[ToolEnvironment] Batch set ${Object.keys(vars).length} env vars for tool: ${this.toolId}`)
  }

  /**
   * 内部方法：同步加载 .env 文件
   */
  _loadEnvSync(): Record<string, string> {
    // 如果有缓存，返回缓存
    if (this.envCache !== null) {
      return { ...this.envCache }
    }

    try {
      const content = fs.readFileSync(this.envPath, 'utf8')
      const env = this._parseEnvFile(content)
      this.envCache = env
      return { ...env }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        // 文件不存在，返回空对象
        this.envCache = {}
        return {}
      }
      logger.error(`[ToolEnvironment] Failed to load .env file: ${err.message}`)
      throw new Error(`Failed to load environment variables: ${err.message}`)
    }
  }

  /**
   * 内部方法：异步加载 .env 文件（用于写操作后的重新加载）
   */
  async _loadEnv(): Promise<Record<string, string>> {
    // 如果有缓存，返回缓存
    if (this.envCache !== null) {
      return { ...this.envCache }
    }

    try {
      const content = await fsPromises.readFile(this.envPath, 'utf8')
      const env = this._parseEnvFile(content)
      this.envCache = env
      return { ...env }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') {
        // 文件不存在，返回空对象
        this.envCache = {}
        return {}
      }
      logger.error(`[ToolEnvironment] Failed to load .env file: ${err.message}`)
      throw new Error(`Failed to load environment variables: ${err.message}`)
    }
  }

  /**
   * 内部方法：保存 .env 文件
   */
  async _saveEnv(env: Record<string, string>): Promise<void> {
    try {
      // 确保目录存在
      const dir = path.dirname(this.envPath)
      await fsPromises.mkdir(dir, { recursive: true })

      // 生成 .env 格式的内容
      const content = this._generateEnvFile(env)

      // 写入文件
      await fsPromises.writeFile(this.envPath, content, 'utf8')
    } catch (error) {
      logger.error(`[ToolEnvironment] Failed to save .env file: ${(error as Error).message}`)
      throw new Error(`Failed to save environment variables: ${(error as Error).message}`)
    }
  }

  /**
   * 解析 .env 文件内容
   */
  _parseEnvFile(content: string): Record<string, string> {
    const env: Record<string, string> = {}
    const lines = content.split('\n')

    for (const line of lines) {
      // 跳过空行和注释
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      // 解析 KEY=VALUE 格式
      const index = trimmed.indexOf('=')
      if (index !== -1) {
        const key = trimmed.substring(0, index).trim()
        let value = trimmed.substring(index + 1).trim()

        // 处理引号
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }

        // 处理转义字符
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\\/g, '\\')

        env[key] = value
      }
    }

    return env
  }

  /**
   * 生成 .env 文件内容
   */
  _generateEnvFile(env: Record<string, string>): string {
    const lines: string[] = []

    // 添加文件头注释
    lines.push('# Tool Environment Variables')
    lines.push(`# Tool: ${this.toolId}`)
    lines.push('# Generated by Perseng ToolEnvironment')
    lines.push(`# Last modified: ${new Date().toISOString()}`)
    lines.push('')

    // 添加环境变量
    for (const [key, value] of Object.entries(env)) {
      // 如果值包含特殊字符，使用引号包围
      let formattedValue = String(value)

      // 转义特殊字符
      formattedValue = formattedValue
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')

      // 如果包含空格或特殊字符，用引号包围
      if (
        formattedValue.includes(' ') ||
        formattedValue.includes('#') ||
        formattedValue.includes('=') ||
        formattedValue.includes('\n') ||
        formattedValue.includes('"') ||
        formattedValue.includes("'")
      ) {
        formattedValue = `"${formattedValue.replace(/"/g, '\\"')}"`
      }

      lines.push(`${key}=${formattedValue}`)
    }

    return lines.join('\n') + '\n'
  }

  /**
   * 重新加载环境变量（清除缓存）
   */
  async reload(): Promise<void> {
    this.envCache = null
    await this._loadEnv()
    logger.debug(`[ToolEnvironment] Reloaded env vars for tool: ${this.toolId}`)
  }
}

export = ToolEnvironment
