/**
 * EventLog - 活动事件流时间线持久化
 *
 * ## 设计理念
 *
 * 纯旁路模块，订阅 SystemBus 事件并写入独立 SQLite db。
 * 未来可平滑加 `event_embeddings` 虚拟表做向量检索（零迁移）。
 *
 * ## Schema 演进
 *
 * - v1（当前）：events 表 + 5 个二级索引
 * - v2（未来）：加 `event_embeddings USING vec0(embedding float[1536])` 独立表，FK 关联
 *
 * @class EventLog
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createLogger } from '@promptx/logger'

const logger = createLogger()

export type EventRole =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'system'
  | 'unknown'

export interface TimelineEventRow {
  id: number
  ts: number
  sessionId: string | null
  containerId: string | null
  agentId: string | null
  imageId: string | null
  type: string
  role: EventRole
  payload: string // JSON-stringified SystemEvent.data
  createdAt: number
}

export interface TimelineQueryFilter {
  sessionId?: string
  agentId?: string
  imageId?: string
  types?: string[]
  roles?: EventRole[]
  sinceTs?: number
  untilTs?: number
  cursor?: number
  order?: 'asc' | 'desc'
  limit?: number
}

export type ClearScope = 'all' | 'session' | 'agent' | 'image'

export interface ClearFilter {
  scope?: ClearScope
  targetId?: string
}

/** SystemEvent 的最小契约（兼容 Runtime 内部事件） */
export interface MinimalSystemEvent {
  type: string
  timestamp: number
  data?: unknown
  context?: {
    agentId?: string
    imageId?: string
    containerId?: string
    sessionId?: string
  } | null
}

/**
 * 把 SystemEvent.type 归一化为角色。
 * 写入时计算一次，查询走索引，便宜。
 */
function inferRole(type: string): EventRole {
  if (type === 'user_message') return 'user'
  if (type === 'tool_use_content_block_start') return 'tool_call'
  if (type === 'tool_result') return 'tool_result'
  if (type === 'message_stop' || type.startsWith('text_')) return 'assistant'
  return 'system'
}

/**
 * 安全的 JSON.stringify，失败回退到占位字符串。
 * 防止循环引用 / BigInt / Function 撑爆 IO。
 */
function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data ?? null)
  } catch {
    return '"[unserializable]"'
  }
}

export class EventLog {
  private db: Database.Database
  private dbPath: string
  private stmts!: {
    insert: Database.Statement
    queryAllDesc: Database.Statement
    queryAllAsc: Database.Statement
    countAllTotal: Database.Statement
    clearAll: Database.Statement
    clearBySession: Database.Statement
    clearByAgent: Database.Statement
    clearByImage: Database.Statement
    countAll: Database.Statement
  }

  constructor(dbPath: string) {
    this.dbPath = dbPath

    // 确保目录存在；失败降级到 tmp
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    } catch (err) {
      logger.warn(
        `[EventLog] Failed to create db dir, falling back to tmp dbPath=${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
      const fallback = path.join(
        process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp',
        'perseng-timeline',
      )
      fs.mkdirSync(fallback, { recursive: true })
      this.dbPath = path.join(fallback, 'events.db')
    }

    try {
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this._initializeSchema()
      logger.debug(`[EventLog] Initialized dbPath=${this.dbPath}`)
    } catch (err) {
      // 打开失败时尝试重建（处理坏文件）
      logger.warn(
        `[EventLog] Open failed, recreating dbPath=${this.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
      try {
        if (fs.existsSync(this.dbPath)) fs.unlinkSync(this.dbPath)
      } catch {
        /* ignore */
      }
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this._initializeSchema()
    }
  }

  private _initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        sessionId TEXT,
        containerId TEXT,
        agentId TEXT,
        imageId TEXT,
        type TEXT NOT NULL,
        role TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionId, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_agent   ON events(agentId, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_image   ON events(imageId, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type    ON events(type, ts DESC);
    `)
    this._prepareStatements()
  }

  private _prepareStatements(): void {
    this.stmts = {
      // INSERT：7 个字段 + 自增 id
      insert: this.db.prepare(`
        INSERT INTO events (ts, sessionId, containerId, agentId, imageId, type, role, payload, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      // 动态 SQL：根据 filter 字段在调用时拼接 WHERE 子句。
      // 预存常用前缀以获得 prepared statement 缓存优势。
      queryAllDesc: this.db.prepare(`
        SELECT * FROM events
        WHERE 1=1
        ORDER BY ts DESC, id DESC
        LIMIT ?
      `),
      queryAllAsc: this.db.prepare(`
        SELECT * FROM events
        WHERE 1=1
        ORDER BY ts ASC, id ASC
        LIMIT ?
      `),
      countAllTotal: this.db.prepare(`SELECT COUNT(*) AS total FROM events WHERE 1=1`),
      clearAll: this.db.prepare(`DELETE FROM events`),
      clearBySession: this.db.prepare(`DELETE FROM events WHERE sessionId = ?`),
      clearByAgent: this.db.prepare(`DELETE FROM events WHERE agentId = ?`),
      clearByImage: this.db.prepare(`DELETE FROM events WHERE imageId = ?`),
      countAll: this.db.prepare(`SELECT COUNT(*) AS total FROM events`),
    }
  }

  /**
   * 写入一条事件。失败仅 warn，不抛。
   * 调用方负责 fire-and-forget（SystemBus 内部已 try/catch）。
   */
  async append(event: MinimalSystemEvent): Promise<void> {
    try {
      const ctx = event.context ?? null
      this.stmts.insert.run(
        event.timestamp,
        ctx?.sessionId ?? null,
        ctx?.containerId ?? null,
        ctx?.agentId ?? null,
        ctx?.imageId ?? null,
        event.type,
        inferRole(event.type),
        safeStringify(event.data),
        Date.now(),
      )
    } catch (err) {
      logger.warn(
        `[EventLog] append failed type=${event.type}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * 动态构造 WHERE 子句（公共方法，对 query 和 count 都用）。
   * 返回 { where, params }：where 是 `AND ...` 串接的字符串；params 是绑定值数组。
   *
   * 关于 limit 处理：query 时由调用方负责 append LIMIT ?；count 不需要 limit。
   */
  private _buildWhere(
    filter: Omit<TimelineQueryFilter, 'cursor' | 'limit' | 'order'>,
    opts: { cursor?: number; cursorMode: 'gt' | 'lt' },
  ): { where: string; params: unknown[] } {
    const parts: string[] = []
    const params: unknown[] = []
    if (filter.sessionId) {
      parts.push('AND sessionId = ?')
      params.push(filter.sessionId)
    }
    if (filter.agentId) {
      parts.push('AND agentId = ?')
      params.push(filter.agentId)
    }
    if (filter.imageId) {
      parts.push('AND imageId = ?')
      params.push(filter.imageId)
    }
    if (filter.sinceTs !== undefined) {
      parts.push('AND ts >= ?')
      params.push(filter.sinceTs)
    }
    if (filter.untilTs !== undefined) {
      parts.push('AND ts <= ?')
      params.push(filter.untilTs)
    }
    if (filter.types && filter.types.length > 0) {
      parts.push('AND type IN (SELECT value FROM json_each(?))')
      params.push(JSON.stringify(filter.types))
    }
    if (filter.roles && filter.roles.length > 0) {
      parts.push('AND role IN (SELECT value FROM json_each(?))')
      params.push(JSON.stringify(filter.roles))
    }
    if (opts.cursor !== undefined) {
      parts.push(opts.cursorMode === 'gt' ? 'AND id >  ?' : 'AND id <  ?')
      params.push(opts.cursor)
    }
    return { where: parts.join('\n          '), params }
  }

  /**
   * 同步查询（better-sqlite3 同步 API，外面包 async 保持风格一致）
   * keyset 分页：cursor = 上次 nextCursor
   */
  async query(filter: TimelineQueryFilter): Promise<TimelineEventRow[]> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
    const order = filter.order ?? 'desc'
    const cursorMode = order === 'asc' ? 'gt' : 'lt'

    const { where, params } = this._buildWhere(filter, {
      cursor: filter.cursor,
      cursorMode,
    })
    const orderClause = order === 'asc' ? 'ts ASC, id ASC' : 'ts DESC, id DESC'
    const sql = `
      SELECT * FROM events
      WHERE 1=1
        ${where}
      ORDER BY ${orderClause}
      LIMIT ?
    `
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as TimelineEventRow[]
    return rows
  }

  /**
   * 同 filter 下的总数（不含 cursor/limit/order）。
   */
  async count(filter: Omit<TimelineQueryFilter, 'cursor' | 'limit' | 'order'>): Promise<number> {
    const { where, params } = this._buildWhere(filter, { cursorMode: 'lt' })
    const sql = `SELECT COUNT(*) AS total FROM events WHERE 1=1 ${where}`
    const r = this.db.prepare(sql).get(...params) as { total: number }
    return r.total
  }

  /**
   * 按 scope 清空。
   * scope=all 不需要 targetId，其他 scope 必填。
   */
  async clear(filter: ClearFilter = {}): Promise<{ deleted: number }> {
    const scope = filter.scope ?? 'all'
    let info: Database.RunResult
    switch (scope) {
      case 'all':
        info = this.stmts.clearAll.run()
        break
      case 'session':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=session')
        info = this.stmts.clearBySession.run(filter.targetId)
        break
      case 'agent':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=agent')
        info = this.stmts.clearByAgent.run(filter.targetId)
        break
      case 'image':
        if (!filter.targetId) throw new Error('clear: targetId required for scope=image')
        info = this.stmts.clearByImage.run(filter.targetId)
        break
      default:
        throw new Error(`clear: unknown scope ${scope}`)
    }
    logger.info(
      `[EventLog] cleared scope=${scope} targetId=${filter.targetId ?? ''} deleted=${info.changes}`,
    )
    return { deleted: info.changes }
  }

  async getStatistics(): Promise<{ totalEvents: number; dbPath: string }> {
    const r = this.stmts.countAll.get() as { total: number }
    return { totalEvents: r.total, dbPath: this.dbPath }
  }

  async close(): Promise<void> {
    try {
      this.db.close()
    } catch (err) {
      logger.warn(`[EventLog] close failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
