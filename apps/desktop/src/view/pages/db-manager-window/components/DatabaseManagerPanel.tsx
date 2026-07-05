/**
 * 数据库管理面板（轻量版）
 *
 * - 顶部总览：总大小 + db/json 计数 + 扫描时间
 * - 中间按目录分组列出所有 .db 和 .json
 *   - 已知 schema（timeline / engrams）显示 rowCount + 时间范围
 *   - 其他 sqlite / json 只显示 size/mtime
 * - 点击"打开目录" → shell.openPath 调出文件管理器
 *
 * 零破坏性：只读扫描，所有 handler 不修改任何 db。
 */

import { useState, useEffect, useCallback, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  Database,
  FolderOpen,
  RefreshCw,
  HardDrive,
  FileJson,
  Eye,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  Terminal,
} from "@/lib/crisp-icons"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SQLConsole } from "./SQLConsole"

// ---------- 类型 ----------

interface DbItem {
  path: string
  name: string
  relativePath: string
  type: "sqlite" | "json"
  size: number
  mtime: number
  schema?: "timeline" | "engrams" | "unknown-sqlite"
  meta?: {
    rowCount?: number
    earliestTs?: number
    latestTs?: number
  }
}

interface ScanTotals {
  totalSize: number
  dbCount: number
  jsonCount: number
  rootDir: string
  scannedAt: number
}

// ---------- 辅助 ----------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTs(ms: number | undefined): string {
  if (!ms) return "—"
  return new Date(ms).toLocaleString()
}

function formatTimeAgo(ms: number, lang: string): string {
  const suffix = lang?.startsWith("zh") ? "前" : " ago"
  const diff = Date.now() - ms
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s${suffix}`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m${suffix}`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h${suffix}`
  const day = Math.floor(hr / 24)
  return `${day}d${suffix}`
}

const SCHEMA_COLOR: Record<string, string> = {
  timeline: "bg-amber-100 text-amber-700 border-amber-200",
  engrams: "bg-green-100 text-green-700 border-green-200",
  "unknown-sqlite": "bg-slate-100 text-slate-700 border-slate-200",
}

// ---------- 主组件 ----------

export function DatabaseManagerPanel() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language ?? "en"

  const [items, setItems] = useState<DbItem[]>([])
  const [totals, setTotals] = useState<ScanTotals | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [sqlConsole, setSqlConsole] = useState<{
    open: boolean
    dbPath: string
    dbName: string
  }>({ open: false, dbPath: "", dbName: "" })

  const scan = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await window.electronAPI?.dbManager?.scan()
      if (!result?.success) {
        toast.error(t("dbManager.messages.loadFailed"))
        return
      }
      setItems(result.items ?? [])
      setTotals(result.totals)
      // 默认展开所有目录
      setExpandedDirs(new Set(uniqueDirs(result.items ?? [])))
    } catch (err) {
      console.error("[dbManager] scan failed:", err)
      toast.error(t("dbManager.messages.loadFailed"))
    } finally {
      setIsLoading(false)
    }
  }, [t])

  useEffect(() => {
    scan()
  }, [scan])

  // 按目录分组
  const groups = useMemo(() => groupByDir(items), [items])

  const openDir = async (dirPath: string) => {
    const result = await window.electronAPI?.dbManager?.openDir(dirPath)
    if (!result?.success) {
      toast.error(t("dbManager.messages.openDirFailed"))
    }
  }

  const openFile = async (filePath: string) => {
    const result = await window.electronAPI?.dbManager?.openFile(filePath)
    if (!result?.success) {
      toast.error(t("dbManager.messages.openFileFailed"))
    }
  }

  const toggleDir = (dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col min-h-[600px]">
      <div className="space-y-4 flex flex-col flex-1 overflow-hidden">
        {/* === 标题 === */}
        <div className="shrink-0 mt-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Database className="h-5 w-5" />
            {t("dbManager.title")}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {t("dbManager.subtitle")}
          </p>
        </div>

        {/* === 总览卡片 === */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
          <SummaryCard
            icon={<HardDrive className="h-4 w-4" />}
            label={t("dbManager.summary.totalSize")}
            value={totals ? formatBytes(totals.totalSize) : "—"}
          />
          <SummaryCard
            icon={<Database className="h-4 w-4" />}
            label={t("dbManager.summary.dbCount")}
            value={totals ? `${totals.dbCount}` : "—"}
          />
          <SummaryCard
            icon={<FileJson className="h-4 w-4" />}
            label={t("dbManager.summary.jsonCount")}
            value={totals ? `${totals.jsonCount}` : "—"}
          />
          <SummaryCard
            icon={<Clock className="h-4 w-4" />}
            label={t("dbManager.summary.scannedAt")}
            value={totals ? formatTimeAgo(totals.scannedAt, lang) : "—"}
          />
        </div>

        {/* === 操作栏 === */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={scan}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            {t("dbManager.actions.refresh")}
          </Button>
          {totals?.rootDir && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openDir(totals.rootDir)}
            >
              <FolderOpen className="h-4 w-4 mr-1" />
              {t("dbManager.actions.openRootDir")}
            </Button>
          )}
        </div>

        {/* === 列表 === */}
        <div className="flex flex-col border border-slate-700/50 bg-slate-900/85 backdrop-blur-sm rounded-md flex-1 min-h-0 overflow-hidden">
          <div className="font-semibold text-sm p-3 border-b border-slate-700/50 shrink-0 flex items-center gap-2 text-slate-100">
            <Layers className="h-4 w-4" />
            {t("dbManager.list.title")}
            <span className="text-slate-400 text-xs font-normal">
              ({items.length})
            </span>
          </div>
          <ScrollArea className="flex-1">
            {items.length === 0 && !isLoading && (
              <div className="text-center text-slate-400 py-8">
                {t("dbManager.list.empty")}
              </div>
            )}
            <div className="p-2 space-y-1">
              {groups.map((group) => {
                const expanded = expandedDirs.has(group.dir)
                return (
                  <div key={group.dir}>
                    {/* 目录标题（可点击展开） */}
                    <button
                      onClick={() => toggleDir(group.dir)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800/60 rounded text-left text-slate-200"
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                      )}
                      <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                      <span className="font-mono text-xs flex-1 truncate">
                        {group.dir === "." ? totals?.rootDir : group.dir}
                      </span>
                      <span className="text-xs text-slate-400 shrink-0">
                        {t("dbManager.list.filesInDir", { count: group.items.length })} · {formatBytes(group.totalSize)}
                      </span>
                    </button>

                    {/* 文件列表 */}
                    {expanded && (
                      <div className="ml-5 mt-1 space-y-1 border-l-2 border-slate-700/50 pl-3">
                        {group.items.map((item) => (
                          <DbItemRow
                            key={item.path}
                            item={item}
                            t={t}
                            lang={lang}
                            onOpenFile={() => openFile(item.path)}
                            onOpenDir={() => openDir(group.dir === "." ? totals!.rootDir : group.dir)}
                            onOpenSql={item.type === "sqlite" ? () => setSqlConsole({ open: true, dbPath: item.path, dbName: item.name }) : undefined}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* L3 SQL 控制台（懒加载 monaco） */}
      <SQLConsole
        dbPath={sqlConsole.dbPath}
        dbName={sqlConsole.dbName}
        open={sqlConsole.open}
        onClose={() => setSqlConsole({ open: false, dbPath: "", dbName: "" })}
      />
    </div>
  )
}

// ---------- 子组件 ----------

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="border border-slate-700/50 bg-slate-900/85 backdrop-blur-sm rounded-md p-3">
      <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function DbItemRow({
  item,
  t,
  lang,
  onOpenFile,
  onOpenDir,
  onOpenSql,
}: {
  item: DbItem
  t: (key: string, options?: Record<string, unknown>) => string
  lang: string
  onOpenFile: () => void
  onOpenDir: () => void
  onOpenSql?: () => void
}) {
  const Icon = item.type === "sqlite" ? Database : FileJson
  const hasMeta = item.meta && (item.meta.rowCount !== undefined || item.meta.earliestTs)
  const updatedLabel = lang.startsWith("zh") ? "更新" : "Updated"
  const rowsLabel = lang.startsWith("zh") ? "行" : "rows"
  const updatedPrefix = `${updatedLabel} ${formatTimeAgo(item.mtime, lang)}`

  return (
    <div className="border border-slate-700/50 rounded p-2.5 hover:bg-slate-800/60 transition-colors">
      <div className="flex items-start gap-2">
        <Icon
          className={`h-4 w-4 mt-0.5 shrink-0 ${
            item.type === "sqlite" ? "text-blue-400" : "text-orange-400"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm truncate text-slate-100">{item.name}</span>
            {item.schema && (
              <Badge
                variant="outline"
                className={`text-xs ${SCHEMA_COLOR[item.schema] ?? ""}`}
              >
                {t(`dbManager.schemaLabels.${item.schema}`)}
              </Badge>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-1 font-mono break-all">
            {item.path}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-1.5">
            <span>{formatBytes(item.size)}</span>
            <span>{updatedPrefix}</span>
            {hasMeta && item.meta?.rowCount !== undefined && (
              <span className="text-blue-400 font-medium">
                {item.meta.rowCount.toLocaleString()} {rowsLabel}
              </span>
            )}
          </div>
          {hasMeta && item.meta?.earliestTs && item.meta?.latestTs && (
            <div className="text-xs text-slate-400 mt-1">
              📅 {formatTs(item.meta.earliestTs)} → {formatTs(item.meta.latestTs)}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800/60" onClick={onOpenFile}>
            <Eye className="h-3 w-3 mr-1" />
            {t("dbManager.actions.highlightFile")}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800/60" onClick={onOpenDir}>
            <FolderOpen className="h-3 w-3 mr-1" />
            {t("dbManager.actions.openDir")}
          </Button>
          {onOpenSql && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-emerald-300 hover:text-emerald-100 hover:bg-emerald-900/40"
              onClick={onOpenSql}
            >
              <Terminal className="h-3 w-3 mr-1" />
              {t("dbManager.actions.openSqlConsole")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- 工具函数 ----------

function uniqueDirs(items: DbItem[]): string[] {
  const dirs = new Set<string>()
  for (const it of items) {
    const dir = dirnameOf(it.relativePath)
    dirs.add(dir)
  }
  return Array.from(dirs)
}

function dirnameOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/")
  return idx < 0 ? "." : relativePath.slice(0, idx)
}

interface DirGroup {
  dir: string
  items: DbItem[]
  totalSize: number
}

function groupByDir(items: DbItem[]): DirGroup[] {
  const map = new Map<string, DirGroup>()
  for (const item of items) {
    const dir = dirnameOf(item.relativePath)
    let group = map.get(dir)
    if (!group) {
      group = { dir, items: [], totalSize: 0 }
      map.set(dir, group)
    }
    group.items.push(item)
    group.totalSize += item.size
  }
  return Array.from(map.values()).sort((a, b) => a.dir.localeCompare(b.dir))
}
