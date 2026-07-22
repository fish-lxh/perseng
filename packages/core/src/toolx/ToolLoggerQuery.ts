/**
 * ToolLoggerQuery - 工具日志查询器
 *
 * 提供日志查询功能，供系统使用。
 * 与 ToolLogger 分离，专注于读取和分析日志。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import logger from '@promptx/logger'

interface ParsedLogLine {
  timestamp?: string
  level?: string
  toolId?: string
  message?: string
  data?: Record<string, unknown>
  raw: string
}

interface SearchOptions {
  level?: string | null
  limit?: number
  regex?: boolean
}

interface LogStats {
  exists: boolean
  size?: number
  sizeHuman?: string
  lines?: number
  levels?: Record<string, number>
  firstLog?: { timestamp: string; message: string } | null
  lastLog?: { timestamp: string; message: string } | null
  logFile?: string
  error?: string
}

class ToolLoggerQuery {
  public toolId: string
  public sandboxPath: string
  public logPath: string
  public logFile: string

  constructor(toolId: string, sandboxPath: string) {
    this.toolId = toolId
    this.sandboxPath = sandboxPath
    this.logPath = path.join(sandboxPath, 'logs')
    this.logFile = path.join(this.logPath, 'execute.log')
  }

  /**
   * 检查日志文件是否存在
   */
  _fileExists(): boolean {
    return fs.existsSync(this.logFile)
  }

  /**
   * 解析日志行
   * 格式：2025-01-17T12:30:45.123Z [INFO] [tool-id] message {data}
   */
  _parseLine(line: string): ParsedLogLine | null {
    try {
      const match = line.match(/^(\S+)\s+\[(\w+)\]\s+\[([^\]]+)\]\s+(.+)$/)
      if (!match || !match[1] || !match[2] || !match[3] || !match[4]) {
        return { raw: line }
      }
      const timestamp = match[1]
      const level = match[2]
      const toolId = match[3]
      const rest = match[4]

      const dataMatch = rest.match(/^(.+?)\s+(\{.+\})$/)
      let message = rest
      let data: Record<string, unknown> = {}

      if (dataMatch && dataMatch[1]) {
        message = dataMatch[1]
        try {
          // eslint-disable-next-line no-eval
          data = eval(`(${dataMatch[2] || '{}'})`) as Record<string, unknown>
        } catch {
          // 解析失败，保持原样
        }
      }

      return { timestamp, level, toolId, message, data, raw: line }
    } catch {
      return { raw: line }
    }
  }

  /**
   * 获取最近的日志行
   */
  async tail(lines = 50): Promise<ParsedLogLine[]> {
    if (!this._fileExists()) {
      return []
    }

    try {
      const content = await fs.promises.readFile(this.logFile, 'utf8')
      const allLines = content.trim().split('\n').filter(Boolean)
      const selectedLines = allLines.slice(-lines)

      return selectedLines
        .map((line) => this._parseLine(line))
        .filter((line): line is ParsedLogLine => line !== null)
    } catch (error) {
      logger.error(`[ToolLoggerQuery] Failed to tail log: ${(error as Error).message}`)
      return []
    }
  }

  /**
   * 搜索日志
   */
  async search(keyword: string, options: SearchOptions = {}): Promise<ParsedLogLine[]> {
    if (!this._fileExists()) {
      return []
    }

    const level = options.level ?? null
    const limit = options.limit ?? 100
    const regex = options.regex ?? false

    const results: ParsedLogLine[] = []
    const searchPattern = regex ? new RegExp(keyword, 'i') : null

    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: fs.createReadStream(this.logFile),
        crlfDelay: Infinity,
      })

      rl.on('line', (line) => {
        if (results.length >= limit) {
          rl.close()
          return
        }

        const parsed = this._parseLine(line)
        if (!parsed) return

        if (level && parsed.level !== level) return

        const matches = searchPattern
          ? searchPattern.test(line)
          : line.toLowerCase().includes(keyword.toLowerCase())

        if (matches) {
          results.push(parsed)
        }
      })

      rl.on('close', () => {
        resolve(results)
      })

      rl.on('error', (error) => {
        logger.error(`[ToolLoggerQuery] Search error: ${(error as Error).message}`)
        reject(error)
      })
    })
  }

  /**
   * 按时间范围查询
   */
  async getByTimeRange(startTime: Date | string, endTime: Date | string): Promise<ParsedLogLine[]> {
    if (!this._fileExists()) {
      return []
    }

    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()
    const results: ParsedLogLine[] = []

    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: fs.createReadStream(this.logFile),
        crlfDelay: Infinity,
      })

      rl.on('line', (line) => {
        const parsed = this._parseLine(line)
        if (!parsed || !parsed.timestamp) return

        const logTime = new Date(parsed.timestamp).getTime()
        if (logTime >= start && logTime <= end) {
          results.push(parsed)
        }
      })

      rl.on('close', () => {
        resolve(results)
      })

      rl.on('error', (error) => {
        logger.error(`[ToolLoggerQuery] Time range query error: ${(error as Error).message}`)
        reject(error)
      })
    })
  }

  /**
   * 获取日志统计信息
   */
  async getStats(): Promise<LogStats> {
    if (!this._fileExists()) {
      return {
        exists: false,
        size: 0,
        lines: 0,
        levels: {},
        firstLog: null,
        lastLog: null,
      }
    }

    try {
      const stats = await fs.promises.stat(this.logFile)
      const content = await fs.promises.readFile(this.logFile, 'utf8')
      const lines = content.trim().split('\n').filter(Boolean)

      const levels: Record<string, number> = { TRACE: 0, DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 }
      const parsedLines: ParsedLogLine[] = []

      lines.forEach((line) => {
        const parsed = this._parseLine(line)
        if (parsed && parsed.level) {
          levels[parsed.level] = (levels[parsed.level] || 0) + 1
          parsedLines.push(parsed)
        }
      })

      const firstParsed: ParsedLogLine | undefined = parsedLines[0]
      const lastParsed: ParsedLogLine | undefined = parsedLines[parsedLines.length - 1]

      return {
        exists: true,
        size: stats.size,
        sizeHuman: this._formatSize(stats.size),
        lines: lines.length,
        levels,
        firstLog: firstParsed && firstParsed.timestamp && firstParsed.message
          ? { timestamp: firstParsed.timestamp, message: firstParsed.message }
          : null,
        lastLog: lastParsed && lastParsed.timestamp && lastParsed.message
          ? { timestamp: lastParsed.timestamp, message: lastParsed.message }
          : null,
        logFile: this.logFile,
      }
    } catch (error) {
      logger.error(`[ToolLoggerQuery] Failed to get stats: ${(error as Error).message}`)
      return {
        exists: false,
        error: (error as Error).message,
      }
    }
  }

  /**
   * 清空日志文件
   */
  async clear(): Promise<boolean> {
    try {
      await fs.promises.writeFile(this.logFile, '', 'utf8')
      logger.info(`[ToolLoggerQuery] Cleared log file for ${this.toolId}`)
      return true
    } catch (error) {
      logger.error(`[ToolLoggerQuery] Failed to clear log: ${(error as Error).message}`)
      return false
    }
  }

  /**
   * 获取错误日志
   */
  async getErrors(limit = 50): Promise<ParsedLogLine[]> {
    return this.search('', { level: 'ERROR', limit })
  }

  /**
   * 获取警告日志
   */
  async getWarnings(limit = 50): Promise<ParsedLogLine[]> {
    return this.search('', { level: 'WARN', limit })
  }

  /**
   * 获取调试日志
   */
  async getDebugLogs(limit = 50): Promise<ParsedLogLine[]> {
    return this.search('', { level: 'DEBUG', limit })
  }

  /**
   * 格式化文件大小
   */
  _formatSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
  }
}

export = ToolLoggerQuery
