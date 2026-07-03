/**
 * 数据库管理 - 扫描器
 *
 * 轻量版：递归扫 ~/.perseng/ 下所有 .db 和 .json 文件，
 * 对已知 schema 的 db 做行数 + 时间范围统计。
 *
 * 零破坏性：纯只读扫描，不打开不持有任何 db 连接，
 * 用完即关（避免与 mcp-server 持久的 EventLog 抢锁）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { getPersengHomeDir } from '~/main/utils/persengPaths'

// ---------- 类型 ----------

export type DbSchemaKind = 'timeline' | 'engrams' | 'unknown-sqlite'

export interface DbMetadata {
  rowCount?: number
  // 对带时间戳的表（events / engrams）：最早 / 最晚 ts（ms）
  earliestTs?: number
  latestTs?: number
}

export interface DbItem {
  path: string              // 绝对路径
  name: string              // basename
  relativePath: string      // 相对 ~/.perseng/ 的路径
  type: 'sqlite' | 'json'
  size: number              // bytes
  mtime: number             // ms since epoch
  /** 对已知 schema 的 db：timeline / engrams；否则 undefined */
  schema?: DbSchemaKind
  /** 元信息（rowCount / 时间范围） */
  meta?: DbMetadata
}

export interface ScanTotals {
  totalSize: number
  dbCount: number
  jsonCount: number
  rootDir: string
  scannedAt: number
}

// ---------- 已知 schema 表名 + 时间列 ----------

const TIMELINE_TABLE = 'events'
const TIMELINE_TS_COL = 'ts'

const ENGRAMS_TABLE = 'engrams'
const ENGRAMS_TS_COL = 'timestamp'

// ---------- 扫描 ----------

const MAX_DEPTH = 5  // 防止极深目录
const SCAN_EXT = new Set(['.db', '.json'])

/**
 * 递归扫描 ~/.perseng/，返回所有 .db / .json 文件的元信息列表。
 */
export function scanPersengHome(rootDir: string): DbItem[] {
  if (!fs.existsSync(rootDir)) return []
  const items: DbItem[] = []
  walk(rootDir, rootDir, 0, items)
  // 按目录优先 + name 排序，让 UI 看起来整齐
  items.sort((a, b) => {
    const dirCmp = path.dirname(a.relativePath).localeCompare(path.dirname(b.relativePath))
    return dirCmp !== 0 ? dirCmp : a.name.localeCompare(b.name)
  })
  return items
}

function walk(root: string, current: string, depth: number, out: DbItem[]): void {
  if (depth > MAX_DEPTH) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(current, { withFileTypes: true })
  } catch {
    return  // 权限不足等
  }

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      // 跳过 node_modules / .git / 临时文件目录
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(root, fullPath, depth + 1, out)
      continue
    }
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!SCAN_EXT.has(ext)) continue

    let stat: fs.Stats
    try {
      stat = fs.statSync(fullPath)
    } catch {
      continue
    }

    const item: DbItem = {
      path: fullPath,
      name: entry.name,
      relativePath: path.relative(root, fullPath),
      type: ext === '.db' ? 'sqlite' : 'json',
      size: stat.size,
      mtime: stat.mtimeMs,
    }

    if (item.type === 'sqlite') {
      // 识别 schema + 拉元信息（READ-ONLY 短连接）
      enrichSqlite(item)
    }

    out.push(item)
  }
}

/**
 * 给 sqlite 文件加 schema / meta 信息。
 * 用 IMMEDIATE? 不必 —— 只跑 SELECT，读连接 + read-only flag 已经足够安全。
 * 失败时静默跳过（schema 标 unknown-sqlite，但 size/mtime 仍可用）。
 */
function enrichSqlite(item: DbItem): void {
  let db: Database.Database
  try {
    db = new Database(item.path, { readonly: true, fileMustExist: true })
  } catch {
    item.schema = 'unknown-sqlite'
    return
  }
  try {
    // 判断 schema
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as { name: string }[]
    const tableNames = new Set(tables.map((t) => t.name))

    if (tableNames.has(TIMELINE_TABLE)) {
      item.schema = 'timeline'
      item.meta = queryTsMeta(db, TIMELINE_TABLE, TIMELINE_TS_COL)
    } else if (tableNames.has(ENGRAMS_TABLE)) {
      item.schema = 'engrams'
      item.meta = queryTsMeta(db, ENGRAMS_TABLE, ENGRAMS_TS_COL)
    } else {
      item.schema = 'unknown-sqlite'
    }
  } catch {
    item.schema = 'unknown-sqlite'
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}

function queryTsMeta(
  db: Database.Database,
  table: string,
  tsCol: string,
): DbMetadata {
  try {
    const countRow = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
      | { n: number }
      | undefined
    const tsRow = db
      .prepare(
        `SELECT MIN(${tsCol}) AS earliest, MAX(${tsCol}) AS latest FROM ${table}`,
      )
      .get() as { earliest: number | null; latest: number | null } | undefined
    return {
      rowCount: countRow?.n ?? 0,
      earliestTs: tsRow?.earliest ?? undefined,
      latestTs: tsRow?.latest ?? undefined,
    }
  } catch {
    return {}
  }
}

// ---------- L3 SQL 控制台 ----------

export interface SqlQueryResult {
  columns: string[]              // 列名
  rows: Array<Record<string, unknown>>  // 行（每行是个对象，列名 → 值）
  rowCount: number
  durationMs: number
  truncated: boolean             // 是否被 LIMIT 截断
}

const MAX_ROWS = 1000

/**
 * 只读执行单条 SQL，结果以 Record[] 形式返回（前端表格直接用）。
 *
 * 4 道安全防线：
 *  1. 路径白名单：必须在 ~/.perseng/ 下
 *  2. readonly 连接：写操作直接被 sqlite 拒绝
 *  3. 单语句：prepare() 不支持多语句，多 `;` 抛错
 *  4. LIMIT 守卫：用户没写 LIMIT 时自动追加 MAX_ROWS+1 行上限
 */
export function querySqlite(dbPath: string, sql: string): SqlQueryResult {
  // 1. 路径白名单
  const home = getPersengHomeDir()
  if (!dbPath.startsWith(home)) {
    throw new Error('Path not allowed: must be under ~/.perseng/')
  }

  // 2. readonly + fileMustExist
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const t0 = Date.now()
    // 4. LIMIT 守卫（多语句由 prepare 自身拒绝，无需预判）
    const hasLimit = /\bLIMIT\s+\d+/i.test(sql)
    const effectiveSql = hasLimit
      ? sql
      : sql.replace(/;\s*$/, '') + ` LIMIT ${MAX_ROWS + 1}`
    const stmt = db.prepare(effectiveSql)

    const rawRows = stmt.all() as unknown[]
    const durationMs = Date.now() - t0
    const truncated = rawRows.length > MAX_ROWS
    const rows = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows
    const columns = rows.length > 0 ? Object.keys(rows[0] as object) : []

    return {
      columns,
      rows: rows as Array<Record<string, unknown>>,
      rowCount: rows.length,
      durationMs,
      truncated,
    }
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}