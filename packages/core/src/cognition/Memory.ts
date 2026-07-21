/**
 * Memory - 记忆内容存储
 *
 * ## 设计理念
 *
 * Memory是纯粹的KV存储，负责持久化Engram对象的完整内容。
 * 它不知道角色(role)概念，只提供简单的存储和检索功能。
 *
 * ## 存储格式
 *
 * - Key: `${timestamp}_${randomId}` (确保唯一性)
 * - Value: Engram.toJSON() 的完整对象
 *
 * ## 设计决策
 *
 * Q: 为什么用better-sqlite3而不是LMDB?
 * A: better-sqlite3与Electron高版本兼容，避免V8沙箱问题，且性能优秀
 *
 * Q: 为什么不在Memory中管理role?
 * A: 职责分离，Memory只管存储，role由上层管理
 *
 * @class Memory
 */
import Database from 'better-sqlite3'
import { debug as logDebug, info as logInfo, warn as logWarn, error as logErr } from '@promptx/logger'
import path from 'path'
import fs from 'fs-extra'
import { Engram, EngramJSON } from './Engram'

/**
 * KNUTH-NOTE: 没有引入 @types/better-sqlite3（避免给 packages/core 加 devDep）；
 * 这里只声明实际用到的最小 surface。
 */
interface BetterSqliteStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface BetterSqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): BetterSqliteStatement
  pragma(pragma: string): unknown
  close(): void
  transaction(fn: () => void): () => void
}

interface MemoryStatements {
  insertEngram: BetterSqliteStatement
  deleteCues: BetterSqliteStatement
  insertCue: BetterSqliteStatement
  getEngram: BetterSqliteStatement
  getEngramsByWord: BetterSqliteStatement
  getEngramsByType: BetterSqliteStatement
  getEngramsByTypeAndWord: BetterSqliteStatement
  countEngrams: BetterSqliteStatement
}

interface EngramRow {
  id: string
  content: string
  schema: string
  type: string
  timestamp: number
  strength: number
  metadata: string
}

export interface MemoryStatistics {
  totalEngrams: number
  dbPath: string
  error?: string
}

export interface TypedEngramResult {
  patterns: EngramJSON[]
  links: EngramJSON[]
  atomics: EngramJSON[]
}

export class Memory {
  /** 数据库文件路径（.db 结尾） */
  public readonly dbPath: string

  /** SQLite 实例 */
  public readonly db: BetterSqliteDatabase

  /** 常用 SQL 语句缓存（构造成功后必填，try/catch 两路都确保赋值） */
  public stmts!: MemoryStatements

  constructor(dbPath: string) {
    // 兼容旧路径：engrams → engrams.db；其他 → .db 结尾
    if (dbPath.endsWith('engrams')) {
      this.dbPath = dbPath + '.db'
    } else if (!dbPath.endsWith('.db')) {
      this.dbPath = dbPath.replace('engrams.db', 'engrams') + '.db'
    } else {
      this.dbPath = dbPath
    }

    fs.ensureDirSync(path.dirname(this.dbPath))

    try {
      this.db = new Database(this.dbPath) as unknown as BetterSqliteDatabase
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')

      this._initializeSchema()

      logDebug('[Memory] Initialized with SQLite', { dbPath: this.dbPath })
    } catch (error) {
      logWarn('[Memory] Database open failed, recreating...', {
        dbPath: this.dbPath,
        error: (error as Error).message,
      })

      try {
        if (fs.existsSync(this.dbPath)) {
          fs.removeSync(this.dbPath)
          logInfo('[Memory] Removed incompatible database file')
        }

        this.db = new Database(this.dbPath) as unknown as BetterSqliteDatabase
        this.db.pragma('journal_mode = WAL')
        this.db.pragma('synchronous = NORMAL')
        this._initializeSchema()
        logInfo('[Memory] Successfully recreated SQLite database')
      } catch (recreateError) {
        logErr('[Memory] Failed to recreate database', {
          error: (recreateError as Error).message,
        })
        throw recreateError
      }
    }
  }

  /** 初始化表与索引 */
  private _initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS engrams (
        id TEXT PRIMARY KEY,
        content TEXT,
        schema TEXT,
        type TEXT,
        timestamp INTEGER,
        strength REAL,
        metadata TEXT
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cue_index (
        word TEXT,
        engram_id TEXT,
        PRIMARY KEY (word, engram_id),
        FOREIGN KEY (engram_id) REFERENCES engrams(id) ON DELETE CASCADE
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_engrams_type ON engrams(type);
      CREATE INDEX IF NOT EXISTS idx_engrams_timestamp ON engrams(timestamp);
      CREATE INDEX IF NOT EXISTS idx_cue_word ON cue_index(word);
    `)

    this._prepareStatements()
  }

  /** 准备常用 SQL 语句 */
  private _prepareStatements(): void {
    this.stmts = {
      insertEngram: this.db.prepare(`
        INSERT OR REPLACE INTO engrams (id, content, schema, type, timestamp, strength, metadata)
        VALUES (@id, @content, @schema, @type, @timestamp, @strength, @metadata)
      `),
      deleteCues: this.db.prepare('DELETE FROM cue_index WHERE engram_id = ?'),
      insertCue: this.db.prepare(`
        INSERT OR IGNORE INTO cue_index (word, engram_id)
        VALUES (@word, @engram_id)
      `),
      getEngram: this.db.prepare('SELECT * FROM engrams WHERE id = ?'),
      getEngramsByWord: this.db.prepare(`
        SELECT DISTINCT e.* FROM engrams e
        JOIN cue_index c ON e.id = c.engram_id
        WHERE c.word = ?
      `),
      getEngramsByType: this.db.prepare('SELECT * FROM engrams WHERE type = ?'),
      getEngramsByTypeAndWord: this.db.prepare(`
        SELECT DISTINCT e.* FROM engrams e
        JOIN cue_index c ON e.id = c.engram_id
        WHERE e.type = ? AND c.word = ?
      `),
      countEngrams: this.db.prepare('SELECT COUNT(*) as count FROM engrams'),
    }
  }

  /** 存储 Engram */
  async store(engram: Engram): Promise<string> {
    const key = engram.id
    const engramData = engram.toJSON()

    try {
      const transaction = this.db.transaction(() => {
        this.stmts.insertEngram.run({
          id: key,
          content: engramData.content,
          schema: JSON.stringify(engramData.schema || []),
          type: engramData.type || 'ATOMIC',
          timestamp: engramData.timestamp || Date.now(),
          strength: engramData.strength || 0.5,
          metadata: JSON.stringify({
            metadata: engramData.metadata,
            role: engramData.role,
          }),
        })

        this.stmts.deleteCues.run(key)

        if (engramData.schema && Array.isArray(engramData.schema)) {
          for (const word of engramData.schema) {
            this.stmts.insertCue.run({ word, engram_id: key })
          }
        }
      })

      transaction()

      logDebug('[Memory] Stored engram with SQLite', {
        key,
        type: engramData.type || 'ATOMIC',
        preview: engramData.content ? engramData.content.substring(0, 50) + '...' : '',
        strength: engramData.strength || 0.5,
      })

      return key
    } catch (error) {
      logErr('[Memory] Failed to store engram', {
        key,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /** 读取 Engram */
  async get(key: string): Promise<EngramJSON | null> {
    try {
      const row = this.stmts.getEngram.get(key) as EngramRow | undefined
      if (!row) {
        logDebug('[Memory] Engram not found', { key })
        return null
      }

      const data = this._rowToEngram(row)

      logDebug('[Memory] Retrieved engram', {
        key,
        hasContent: !!data.content,
      })

      return data
    } catch (error) {
      logErr('[Memory] Failed to retrieve engram', {
        key,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /** 根据词汇查询 Engram */
  async getByWord(word: string): Promise<EngramJSON[]> {
    try {
      const rows = this.stmts.getEngramsByWord.all(word) as EngramRow[]
      const engrams = rows.map((row) => {
        const engram = this._rowToEngram(row)
        if (!engram.type) {
          engram.type = 'ATOMIC'
        }
        return engram
      })

      logDebug('[Memory] Retrieved engrams by word', {
        word,
        count: engrams.length,
      })

      return engrams
    } catch (error) {
      logErr('[Memory] Failed to retrieve engrams by word', {
        word,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /** 根据类型查询 Engram（可附带词汇过滤） */
  async getByType(type: string, word: string | null = null): Promise<EngramJSON[]> {
    try {
      const rows = word
        ? (this.stmts.getEngramsByTypeAndWord.all(type, word) as EngramRow[])
        : (this.stmts.getEngramsByType.all(type) as EngramRow[])

      const engrams = rows.map((row) => this._rowToEngram(row))

      logDebug('[Memory] Retrieved engrams by type', {
        type,
        word,
        count: engrams.length,
      })

      return engrams
    } catch (error) {
      logErr('[Memory] Failed to retrieve engrams by type', {
        type,
        word,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /** 按 word 分类型查询（pattern / link / atomic 各限条数） */
  async getByWordWithType(word: string): Promise<TypedEngramResult> {
    try {
      const patterns = await this.getByType('PATTERN', word)
      const links = await this.getByType('LINK', word)
      const atomics = await this.getByType('ATOMIC', word)

      logDebug('[Memory] Retrieved typed engrams', {
        word,
        patterns: patterns.length,
        links: links.length,
        atomics: atomics.length,
      })

      return {
        patterns: patterns.sort((a, b) => b.strength - a.strength).slice(0, 5),
        links: links.sort((a, b) => b.strength - a.strength).slice(0, 10),
        atomics: atomics.sort((a, b) => b.timestamp - a.timestamp).slice(0, 15),
      }
    } catch (error) {
      logErr('[Memory] Failed to retrieve typed engrams', {
        word,
        error: (error as Error).message,
      })
      throw error
    }
  }

  /** 关闭数据库 */
  async close(): Promise<void> {
    try {
      this.db.close()
      logDebug('[Memory] SQLite database closed')
    } catch (error) {
      logErr('[Memory] Failed to close database', {
        error: (error as Error).message,
      })
      throw error
    }
  }

  /** 存储统计 */
  async getStatistics(): Promise<MemoryStatistics> {
    try {
      const result = this.stmts.countEngrams.get() as { count: number }
      return {
        totalEngrams: result.count,
        dbPath: this.dbPath,
      }
    } catch (error) {
      logErr('[Memory] Failed to get statistics', {
        error: (error as Error).message,
      })
      return {
        totalEngrams: 0,
        dbPath: this.dbPath,
        error: (error as Error).message,
      }
    }
  }

  /** 数据库行转 EngramJSON */
  private _rowToEngram(row: EngramRow): EngramJSON {
    const metadata = JSON.parse(row.metadata || '{}') as Record<string, unknown>
    const schema = JSON.parse(row.schema || '[]') as string[]

    return {
      id: row.id,
      content: row.content,
      schema,
      type: (row.type || 'ATOMIC') as EngramJSON['type'],
      timestamp: row.timestamp,
      strength: row.strength,
      ...metadata,
    }
  }
}

export default Memory
