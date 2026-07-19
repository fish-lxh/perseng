/**
 * SchedulesConfig.tsx — 调度管理 tab (Phase 2 / Commit 6)
 *
 * KNUTH-FEAT 2026-07-18 (Phase 2)
 *
 * 功能：
 *  - 列出所有 schedules（含已删除 = state=deleted 时显示带删除线）
 *  - 新建 / 编辑（Dialog）
 *  - 暂停 / 恢复 / 立即执行 / 删除
 *  - 查看历史（Dialog）
 *  - sonner toast 反馈
 *
 * 设计参考：
 *  - MCPConfig.tsx（Card + Dialog + 列表 + sonner）
 *  - SkillConfig.tsx（Switch toggle）
 *
 * IPC：window.electronAPI.schedule.*（preload 已暴露）
 */

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { Plus, Trash2, Pencil, Play, History as HistoryIcon, Sparkles, Clock, Loader2, AlertTriangle, Circle } from "@/lib/crisp-icons"

// ============================================================================
// Types
// ============================================================================

interface Schedule {
  id: string
  name: string
  description: string | null
  cronExpr: string
  timezone: string
  toolName: string
  toolArgs: Record<string, unknown>
  state: "pending" | "active" | "paused" | "deleted"
  maxRetries: number
  timeoutMs: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  createdBy: string | null
  createdAt: number
  updatedAt: number
  approvedAt: number | null
  lastRunAt: number | null
  nextRunAt: number | null
  lastStatus: "running" | "success" | "failed" | "skipped" | "vetoed" | null
  lastError: string | null
  failCount: number
}

interface ScheduleRun {
  id: number
  scheduleId: string
  scheduledAt: number
  startedAt: number | null
  finishedAt: number | null
  status: "running" | "success" | "failed" | "skipped" | "vetoed"
  attempt: number
  error: string | null
  output: string | null
  durationMs: number | null
}

// KNUTH-FEAT 2026-07-18 (Phase 2 / Commit 6): 与 preload 返回值对齐
//   IPC 返回 `{ success: boolean; data?: unknown; text?: string; error?: string }`
//   success 用 boolean（不字面化为 true/false）便于 unknown 收敛
interface IpcResp {
  success: boolean
  data?: unknown
  text?: string
  error?: string
}

const DEFAULT_TZ = "Asia/Shanghai"

// ============================================================================
// 组件
// ============================================================================

export function SchedulesConfig() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [historyFor, setHistoryFor] = useState<Schedule | null>(null)
  const [historyRuns, setHistoryRuns] = useState<ScheduleRun[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // --------------------------------------------------------------------------
  // Load
  // --------------------------------------------------------------------------

  const loadSchedules = useCallback(async () => {
    setIsLoading(true)
    try {
      const res: IpcResp = await window.electronAPI?.schedule.list()
      if (!res || !res.success) {
        toast.error(`加载失败: ${res?.error ?? "unknown"}`)
        return
      }
      // text 字段是 MCP 工具渲染输出（含时间/token footer），需要从 data 拿原始
      const data = res.data as { schedules?: Schedule[] } | undefined
      setSchedules(data?.schedules ?? [])
    } catch (e) {
      console.error("[SchedulesConfig] load failed", e)
      toast.error(`加载失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSchedules()
  }, [loadSchedules])

  // KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 9): 订阅 schedule.* 事件 → toast 告警
  useEffect(() => {
    const off = window.electronAPI?.schedule.onEvent?.((env) => {
      const type = env?.type ?? ""
      const payload = (env?.payload ?? {}) as {
        schedule_id?: string
        operation?: string
        id?: string
        name?: string
        consecutive_failures?: number
        suggest_action?: string
        error_message?: string | null
        reason?: string
      }
      const sid = payload.schedule_id ?? payload.id ?? ""
      const name = payload.name ?? sid

      switch (type) {
        case "schedule.failed":
          toast.error(`调度失败：${name}`, {
            description: payload.error_message ?? undefined,
          })
          break
        case "schedule.paused":
          toast.warning(`调度已暂停：${name}`, {
            description:
              payload.reason === "auto"
                ? `连续失败 ${(payload as Record<string, unknown>)["fail_count"] ?? "?"} 次，自动暂停`
                : undefined,
          })
          break
        case "schedule.failure_pattern_detected":
          toast.warning(`检测到失败模式：${name}`, {
            description: `连续失败 ${payload.consecutive_failures ?? "?"} 次，建议：${payload.suggest_action ?? "review"}`,
            duration: 8000,
          })
          // 重新拉一次列表（failCount / lastStatus 可能已更新）
          loadSchedules()
          break
        case "schedule.succeeded":
          // 默认不弹（避免噪音），由 schedule.notifyOnSuccess 控制
          break
        case "schedule.retry_now":
          toast.info(`手动重试：${name}`)
          loadSchedules()
          break
        case "schedule.dry_run_failed":
          toast.error(`dry_run 校验失败：${payload.reason ?? "unknown"}`)
          break
        case "schedule.parse_natural_language_failed":
          toast.error(`自然语言解析失败：needsLLM=true`, { duration: 6000 })
          break
        default:
          // 其它事件（triggered / retried / dry_run_passed 等）静默
          break
      }
    })
    return () => {
      off?.()
    }
  }, [loadSchedules])

  // --------------------------------------------------------------------------
  // 操作
  // --------------------------------------------------------------------------

  const handlePause = async (s: Schedule) => {
    setBusyId(s.id)
    try {
      const res: IpcResp = await window.electronAPI?.schedule.pause(s.id)
      if (res?.success) {
        toast.success(`已暂停：${s.name}`)
        await loadSchedules()
      } else {
        toast.error(`暂停失败: ${res?.error ?? "unknown"}`)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleResume = async (s: Schedule) => {
    setBusyId(s.id)
    try {
      const res: IpcResp = await window.electronAPI?.schedule.resume(s.id)
      if (res?.success) {
        toast.success(`已激活：${s.name}`)
        await loadSchedules()
      } else {
        toast.error(`激活失败: ${res?.error ?? "unknown"}`)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleRunNow = async (s: Schedule) => {
    setBusyId(s.id)
    try {
      const res: IpcResp = await window.electronAPI?.schedule.runNow(s.id)
      if (res?.success) {
        toast.success(`已触发：${s.name}`)
        await loadSchedules()
      } else {
        toast.error(`触发失败: ${res?.error ?? "unknown"}`)
      }
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (s: Schedule) => {
    setBusyId(s.id)
    try {
      const res: IpcResp = await window.electronAPI?.schedule.delete(s.id)
      if (res?.success) {
        toast.success(`已删除：${s.name}`)
        await loadSchedules()
      } else {
        toast.error(`删除失败: ${res?.error ?? "unknown"}`)
      }
    } finally {
      setBusyId(null)
      setPendingDelete(null)
    }
  }

  const handleSave = async (s: Schedule) => {
    setBusyId(s.id || "_new_")
    try {
      const res: IpcResp = await window.electronAPI?.schedule.create(s as unknown as Parameters<NonNullable<typeof window.electronAPI>['schedule']['create']>[0])
      if (res?.success) {
        toast.success(`已创建：${s.name}`)
        setCreatingNew(false)
        setEditing(null)
        await loadSchedules()
      } else {
        toast.error(`创建失败: ${res?.error ?? "unknown"}`)
      }
    } finally {
      setBusyId(null)
    }
  }

  const openHistory = async (s: Schedule) => {
    setHistoryFor(s)
    setHistoryRuns([])
    setHistoryLoading(true)
    try {
      const res: IpcResp = await window.electronAPI?.schedule.history(s.id, 50)
      if (res?.success) {
        const data = res.data as { runs?: ScheduleRun[] } | undefined
        setHistoryRuns(data?.runs ?? [])
      } else {
        toast.error(`加载历史失败: ${res?.error ?? "unknown"}`)
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                调度任务
              </CardTitle>
              <CardDescription>
                按 cron 时间表自动调用 MCP 工具；可暂停/恢复/立即触发
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setCreatingNew(true)}
              data-testid="schedule-new-button"
            >
              <Plus className="w-4 h-4 mr-1" />
              新建
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              加载中…
            </div>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-sm text-muted-foreground">
              <Clock className="w-8 h-8 mb-2 opacity-40" />
              暂无调度任务
              <p className="mt-1">点右上角"新建"创建第一个 cron 调度</p>
            </div>
          ) : (
            <div className="space-y-2">
              {schedules.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  busy={busyId === s.id}
                  onPause={() => handlePause(s)}
                  onResume={() => handleResume(s)}
                  onRunNow={() => handleRunNow(s)}
                  onDelete={() => setPendingDelete(s)}
                  onHistory={() => openHistory(s)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑 / 新建 dialog */}
      <ScheduleEditorDialog
        open={creatingNew || editing !== null}
        schedule={editing}
        onClose={() => {
          setCreatingNew(false)
          setEditing(null)
        }}
        onSave={handleSave}
      />

      {/* 历史 dialog */}
      <Dialog
        open={historyFor !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null)
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="w-4 h-4" />
              执行历史 — {historyFor?.name ?? ""}
            </DialogTitle>
            <DialogDescription>
              最近 50 条运行记录（按 startedAt 倒序）
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              加载中…
            </div>
          ) : historyRuns.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              暂无执行记录
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-2 text-sm">
              {historyRuns.map((r) => (
                <div
                  key={r.id}
                  className="border rounded p-3 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-muted-foreground">
                        #{r.id} · attempt {r.attempt}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.startedAt
                        ? new Date(r.startedAt).toLocaleString()
                        : "未开始"}{" "}
                      ·{" "}
                      {r.durationMs != null ? `${r.durationMs}ms` : "—"}
                    </div>
                    {r.error && (
                      <div className="mt-1 text-xs text-red-600 dark:text-red-400 truncate">
                        {r.error}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              删除 schedule？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将软删除 "{pendingDelete?.name}"（state=deleted，DB 行保留可恢复）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && handleDelete(pendingDelete)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ============================================================================
// ScheduleRow — 单条 schedule 的渲染
// ============================================================================

function ScheduleRow(props: {
  schedule: Schedule
  busy: boolean
  onPause: () => void
  onResume: () => void
  onRunNow: () => void
  onDelete: () => void
  onHistory: () => void
}) {
  const { schedule: s, busy } = props
  const nextRun = s.nextRunAt
    ? new Date(s.nextRunAt).toLocaleString()
    : "—"
  const isActive = s.state === "active"
  const isPaused = s.state === "paused"
  const isPending = s.state === "pending"

  return (
    <div className="border rounded-lg p-3 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{s.name}</span>
          <StateBadge state={s.state} />
          {s.lastStatus && <StatusBadge status={s.lastStatus} small />}
          {s.failCount >= 3 && (
            <span
              title={`连续失败 ${s.failCount} 次，建议暂停或检查`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-500/20 text-orange-700 dark:text-orange-300"
            >
              ⚠ 失败模式
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground space-x-3">
          <span>
            <code className="bg-muted px-1 rounded">{s.cronExpr}</code> ({s.timezone})
          </span>
          <span>工具: {s.toolName}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          下次: {nextRun}
          {s.failCount > 0 && (
            <span className="ml-3 text-orange-600 dark:text-orange-400">
              失败 {s.failCount} 次
            </span>
          )}
        </div>
        {s.lastError && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400 truncate">
            {s.lastError}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isActive && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={props.onRunNow}
              title="立即执行"
            >
              <Sparkles className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={props.onPause}
              title="暂停"
            >
              <Circle className="w-4 h-4" />
            </Button>
          </>
        )}
        {(isPaused || isPending) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={props.onResume}
            title="激活"
          >
            <Play className="w-4 h-4" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={props.onHistory}
          title="执行历史"
        >
          <HistoryIcon className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={props.onDelete}
          title="删除"
        >
          <Trash2 className="w-4 h-4 text-red-500" />
        </Button>
      </div>
    </div>
  )
}

// ============================================================================
// ScheduleEditorDialog — 新建 / 编辑表单
// ============================================================================

function ScheduleEditorDialog(props: {
  open: boolean
  schedule: Schedule | null
  onClose: () => void
  onSave: (s: Schedule) => void
}) {
  const { open, schedule, onClose, onSave } = props
  const isEdit = schedule !== null
  const [name, setName] = useState(schedule?.name ?? "")
  const [cronExpr, setCronExpr] = useState(schedule?.cronExpr ?? "0 9 * * 1-5")
  const [timezone, setTimezone] = useState(schedule?.timezone ?? DEFAULT_TZ)
  const [toolName, setToolName] = useState(schedule?.toolName ?? "remember")
  const [toolArgsText, setToolArgsText] = useState(
    JSON.stringify(schedule?.toolArgs ?? { content: "hello" }, null, 2),
  )
  const [timeoutMs, setTimeoutMs] = useState(schedule?.timeoutMs ?? 60000)
  const [notifyOnFailure, setNotifyOnFailure] = useState(
    schedule?.notifyOnFailure ?? true,
  )

  // 重置表单当 schedule 变
  useEffect(() => {
    if (open) {
      setName(schedule?.name ?? "")
      setCronExpr(schedule?.cronExpr ?? "0 9 * * 1-5")
      setTimezone(schedule?.timezone ?? DEFAULT_TZ)
      setToolName(schedule?.toolName ?? "remember")
      setToolArgsText(
        JSON.stringify(schedule?.toolArgs ?? { content: "hello" }, null, 2),
      )
      setTimeoutMs(schedule?.timeoutMs ?? 60000)
      setNotifyOnFailure(schedule?.notifyOnFailure ?? true)
    }
  }, [open, schedule])

  const toolArgsParseError = (() => {
    if (!toolArgsText.trim()) return null
    try {
      const parsed = JSON.parse(toolArgsText)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "toolArgs 必须是 JSON 对象"
      }
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  })()

  const handleSubmit = () => {
    if (!name.trim() || !cronExpr.trim() || !toolName.trim()) {
      toast.error("name / cronExpr / toolName 不能为空")
      return
    }
    if (toolArgsParseError) {
      toast.error(`toolArgs JSON 解析失败: ${toolArgsParseError}`)
      return
    }
    onSave({
      ...(schedule ?? ({} as Schedule)),
      id: schedule?.id ?? "",
      name: name.trim(),
      description: null,
      cronExpr: cronExpr.trim(),
      timezone: timezone.trim() || DEFAULT_TZ,
      toolName: toolName.trim(),
      toolArgs: JSON.parse(toolArgsText),
      state: schedule?.state ?? "pending",
      maxRetries: schedule?.maxRetries ?? 0,
      timeoutMs,
      notifyOnSuccess: schedule?.notifyOnSuccess ?? false,
      notifyOnFailure,
      createdBy: schedule?.createdBy ?? null,
      createdAt: schedule?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      approvedAt: schedule?.approvedAt ?? null,
      lastRunAt: schedule?.lastRunAt ?? null,
      nextRunAt: schedule?.nextRunAt ?? null,
      lastStatus: schedule?.lastStatus ?? null,
      lastError: schedule?.lastError ?? null,
      failCount: schedule?.failCount ?? 0,
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑 schedule" : "新建 schedule"}</DialogTitle>
          <DialogDescription>
            配置一个 cron 调度，自动调用指定 MCP 工具
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sched-name">名称</Label>
            <Input
              id="sched-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="morning-prep"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sched-cron">Cron 表达式</Label>
              <Input
                id="sched-cron"
                value={cronExpr}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * 1-5"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sched-tz">时区 (IANA)</Label>
              <Input
                id="sched-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder={DEFAULT_TZ}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sched-tool">目标工具</Label>
            <Input
              id="sched-tool"
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              placeholder="remember / action / recall / ..."
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sched-args">toolArgs (JSON 对象)</Label>
            <Textarea
              id="sched-args"
              value={toolArgsText}
              onChange={(e) => setToolArgsText(e.target.value)}
              rows={5}
              className="font-mono text-xs"
            />
            {toolArgsParseError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                {toolArgsParseError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              支持模板占位符：{`${"${now.date}"}`}, {`${"${today.date}"}`}, {`${"${schedule.id}"}`}, {`${"${schedule.name}"}`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sched-timeout">超时 (ms)</Label>
              <Input
                id="sched-timeout"
                type="number"
                min={1000}
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 60000)}
              />
            </div>
            <div className="flex items-end pb-2">
              <div className="flex items-center space-x-2">
                <Switch
                  id="sched-notify-fail"
                  checked={notifyOnFailure}
                  onCheckedChange={setNotifyOnFailure}
                />
                <Label htmlFor="sched-notify-fail">失败时通知</Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!!toolArgsParseError}>
            <Pencil className="w-4 h-4 mr-1" />
            {isEdit ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Badge helpers
// ============================================================================

function StateBadge({ state }: { state: Schedule["state"] }) {
  const styles: Record<Schedule["state"], string> = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    paused: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
    pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    deleted: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  }
  const labels: Record<Schedule["state"], string> = {
    active: "运行中",
    paused: "已暂停",
    pending: "待激活",
    deleted: "已删除",
  }
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[state]}`}>
      {labels[state]}
    </span>
  )
}

function StatusBadge({
  status,
  small,
}: {
  status: ScheduleRun["status"]
  small?: boolean
}) {
  const styles: Record<ScheduleRun["status"], string> = {
    success: "bg-green-500/20 text-green-700 dark:text-green-300",
    failed: "bg-red-500/20 text-red-700 dark:text-red-300",
    running: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
    skipped: "bg-gray-500/20 text-gray-700 dark:text-gray-300",
    vetoed: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  }
  const icons: Record<ScheduleRun["status"], string> = {
    success: "✓",
    failed: "✗",
    running: "⟳",
    skipped: "—",
    vetoed: "⛔",
  }
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded text-[10px] font-medium ${styles[status]} ${small ? "px-1" : "px-1.5 py-0.5"}`}
    >
      {icons[status]} {status}
    </span>
  )
}