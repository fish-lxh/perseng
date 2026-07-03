/**
 * L3 SQL 控制台（Modal）
 *
 * - 懒加载 monaco-editor（不进首屏 bundle）
 * - 只读执行单条 SQL（4 道安全防线在主进程 querySqlite）
 * - 结果以 Record[] 表格展示，含列名 + 行数 + 耗时
 * - 错误以红色 error 框呈现
 *
 * 约束：不引入新页面、不破坏 dbmanager 单页结构。
 */

import { lazy, Suspense, useState, useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { X, Play, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

// 懒加载 monaco (~2-3MB)，不进首屏 bundle
const Editor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default }))
)

interface Props {
  dbPath: string
  dbName: string
  open: boolean
  onClose: () => void
}

const DEFAULT_SQL =
  "-- 输入 SQL，单语句；只读连接；默认 LIMIT 1000\nSELECT name FROM sqlite_master WHERE type='table';\n"

interface QueryResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  rowCount: number
  durationMs: number
  truncated: boolean
  error?: string
}

export function SQLConsole({ dbPath, dbName, open, onClose }: Props) {
  const { t } = useTranslation()
  const [sql, setSql] = useState(DEFAULT_SQL)
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<QueryResult | null>(null)

  // 每次打开时重置 SQL 提示
  useEffect(() => {
    if (open) {
      setSql(DEFAULT_SQL)
      setResult(null)
    }
  }, [open, dbPath])

  const run = useCallback(async () => {
    if (!sql.trim()) return
    setIsRunning(true)
    try {
      const r = await window.electronAPI?.dbManager?.query(dbPath, sql)
      if (r?.success) {
        setResult({
          columns: r.columns ?? [],
          rows: r.rows ?? [],
          rowCount: r.rowCount ?? 0,
          durationMs: r.durationMs ?? 0,
          truncated: r.truncated ?? false,
          error: undefined,
        })
      } else {
        const errorMsg = r?.error ?? "unknown error"
        setResult({
          columns: [],
          rows: [],
          rowCount: 0,
          durationMs: 0,
          truncated: false,
          error: errorMsg,
        })
        toast.error(t("dbManager.console.errorTitle"))
      }
    } catch (e: any) {
      setResult({
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: 0,
        truncated: false,
        error: e?.message ?? String(e),
      })
    } finally {
      setIsRunning(false)
    }
  }, [dbPath, sql, t])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/95 border border-slate-700 rounded-lg w-full max-w-6xl h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2 text-slate-100 min-w-0">
            <span className="font-mono text-sm truncate">{dbName}</span>
            <span className="text-xs text-slate-400 shrink-0">
              — {t("dbManager.console.title")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-slate-100 inline-flex items-center justify-center shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 编辑器（懒加载） */}
        <div className="h-[40%] border-b border-slate-700 shrink-0">
          <Suspense
            fallback={
              <div className="p-4 text-slate-400 text-sm">Loading editor…</div>
            }
          >
            <Editor
              height="100%"
              defaultLanguage="sql"
              theme="vs-dark"
              value={sql}
              onChange={(v) => setSql(v ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </Suspense>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 shrink-0">
          <Button size="sm" onClick={run} disabled={isRunning || !sql.trim()}>
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1" />
            )}
            {t("dbManager.console.run")}
          </Button>
          <span className="text-xs text-slate-500">
            {t("dbManager.console.help")}
          </span>
        </div>

        {/* 结果区 */}
        <div className="flex-1 overflow-auto p-3 min-h-0">
          {result?.error ? (
            <div className="border border-red-700/50 bg-red-950/30 rounded p-3 text-red-300 text-sm font-mono flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <pre className="whitespace-pre-wrap break-all">
                {result.error}
              </pre>
            </div>
          ) : result ? (
            <>
              <div className="text-xs text-slate-400 mb-2 flex items-center gap-3 flex-wrap">
                <span>
                  {t("dbManager.console.resultCount", {
                    count: result.rowCount,
                    ms: result.durationMs,
                  })}
                </span>
                {result.truncated && (
                  <span className="text-amber-400">⚠ LIMIT 截断</span>
                )}
              </div>
              {result.columns.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono border-collapse">
                    <thead>
                      <tr className="bg-slate-800/60 text-slate-300">
                        {result.columns.map((c) => (
                          <th
                            key={c}
                            className="px-2 py-1.5 text-left border border-slate-700 font-semibold whitespace-nowrap"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-800/40">
                          {result.columns.map((c) => (
                            <td
                              key={c}
                              className="px-2 py-1 border border-slate-800 text-slate-200 whitespace-nowrap"
                            >
                              {String(row[c] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-slate-400 text-center py-8">
                  {t("dbManager.console.noResult")}
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-400 text-center py-8">
              {t("dbManager.console.placeholder")}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
