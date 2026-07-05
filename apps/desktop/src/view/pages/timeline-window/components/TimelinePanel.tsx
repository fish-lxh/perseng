/**
 * 活动事件流时间线面板
 *
 * 用户从 UI 视角查询 / 清空时间线。
 * 数据来源：~/.perseng/timeline/events.db（与 MCP 工具共享同一份 db）。
 *
 * 布局：
 * - 顶部过滤栏（scope / role / 时间窗 / 清空按钮）
 * - 主区左：事件列表（时间倒序，cursor 翻页）
 * - 主区右：事件详情（payload JSON）
 * - AlertDialog 二次确认清空
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  Trash2,
  History,
  User,
  Bot,
  Wrench,
  ListChecks,
  Settings2,
  RefreshCw,
  ChevronRight,
} from "@/lib/crisp-icons"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { Badge } from "@/components/ui/badge"

// ---------- 类型（与 EventLog.ts 对齐） ----------

type EventRole = "user" | "assistant" | "tool_call" | "tool_result" | "system" | "unknown"

interface TimelineEvent {
  id: number
  ts: number
  sessionId: string | null
  containerId: string | null
  agentId: string | null
  imageId: string | null
  type: string
  role: EventRole
  payload: string // JSON.stringify(SystemEvent.data)
  createdAt: number
}

type ScopeFilter = "all" | "session" | "agent" | "image"
type RoleFilter = "all" | EventRole

// ---------- 辅助 ----------

const ROLE_ICONS: Record<EventRole, React.ElementType> = {
  user: User,
  assistant: Bot,
  tool_call: Wrench,
  tool_result: ListChecks,
  system: Settings2,
  unknown: History,
}

const ROLE_COLOR: Record<EventRole, string> = {
  user: "bg-blue-100 text-blue-700 border-blue-200",
  assistant: "bg-green-100 text-green-700 border-green-200",
  tool_call: "bg-amber-100 text-amber-700 border-amber-200",
  tool_result: "bg-purple-100 text-purple-700 border-purple-200",
  system: "bg-gray-100 text-gray-700 border-gray-200",
  unknown: "bg-slate-700 text-slate-200 border-slate-600",
}

function formatTs(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString()
}

function formatTimeOnly(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString()
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// ---------- 主组件 ----------

export function TimelinePanel() {
  const { t } = useTranslation()

  // 过滤状态
// 注：时间窗（sinceTs / untilTs）暂未在 UI 暴露 DatePicker 入口，
// 后续要加时在顶部过滤栏放一对 DatePicker，把 sinceTs/untilTs state 接上即可。
const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all")
const [scopeId, setScopeId] = useState("")
const [roleFilter, setRoleFilter] = useState<RoleFilter>("all")

  // 数据状态
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null)

  // 清空对话框
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearScope, setClearScope] = useState<ScopeFilter>("all")
  const [clearTargetId, setClearTargetId] = useState("")

  // ----- 查询 -----

  const buildFilter = useCallback(
    (useCursor: number | null) => {
      const filter: Record<string, unknown> = {
        limit: 50,
        order: "desc",
      }
      if (scopeFilter === "session" && scopeId.trim()) filter.sessionId = scopeId.trim()
      if (scopeFilter === "agent" && scopeId.trim()) filter.agentId = scopeId.trim()
      if (scopeFilter === "image" && scopeId.trim()) filter.imageId = scopeId.trim()
      if (roleFilter !== "all") filter.roles = [roleFilter]
      if (useCursor) filter.cursor = useCursor
      return filter
    },
    [scopeFilter, scopeId, roleFilter],
  )

  const loadEvents = useCallback(
    async (append = false) => {
      setIsLoading(true)
      try {
        const result = await window.electronAPI?.timeline?.query(
          buildFilter(append ? cursor : null),
        )
        if (!result || !result.success) {
          toast.error(t("timeline.messages.loadFailed"))
          return
        }
        const newEvents = result.events as TimelineEvent[]
        setEvents(append ? (prev) => [...prev, ...newEvents] : newEvents)
        setTotal(result.total)
        setCursor(result.nextCursor)
        // 选了 scope 但 id 改变时清掉选中
        if (!append) setSelectedEvent(null)
      } catch (err) {
        console.error("[timeline] load failed:", err)
        toast.error(t("timeline.messages.loadFailed"))
      } finally {
        setIsLoading(false)
      }
    },
    [buildFilter, cursor, t],
  )

  // 过滤条件变化时重置 + 重新加载
  useEffect(() => {
    setCursor(null)
    setSelectedEvent(null)
    loadEvents(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeFilter, scopeId, roleFilter])

  // ----- 清空 -----

  const openClearDialog = () => {
    setClearScope(scopeFilter === "all" ? "all" : scopeFilter)
    setClearTargetId(scopeFilter === "all" ? "" : scopeId)
    setClearDialogOpen(true)
  }

  const handleClear = async () => {
    setClearDialogOpen(false)
    if (clearScope !== "all" && !clearTargetId.trim()) {
      toast.error(t("timeline.messages.scopeIdRequired"))
      return
    }
    try {
      const result = await window.electronAPI?.timeline?.clear({
        scope: clearScope,
        ...(clearScope !== "all" ? { targetId: clearTargetId.trim() } : {}),
      })
      if (result?.success) {
        toast.success(t("timeline.messages.clearSuccess", { count: result.deleted }))
        setEvents([])
        setCursor(null)
        setTotal(0)
        setSelectedEvent(null)
      } else {
        toast.error(t("timeline.messages.clearFailed"))
      }
    } catch (err) {
      console.error("[timeline] clear failed:", err)
      toast.error(t("timeline.messages.clearFailed"))
    }
  }

  // ----- 渲染 -----

  return (
    <div className="h-full flex flex-col min-h-[600px]">
      <div className="space-y-4 flex flex-col flex-1 overflow-hidden">
        {/* === 顶部过滤栏 === */}
        <div className="flex flex-wrap gap-2 shrink-0 mt-4">
          {/* scope 选择 */}
          <div className="flex gap-1 flex-wrap">
            <Button
              variant={scopeFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setScopeFilter("all")}
            >
              {t("timeline.scope.all")}
            </Button>
            <Button
              variant={scopeFilter === "session" ? "default" : "outline"}
              size="sm"
              onClick={() => setScopeFilter("session")}
            >
              {t("timeline.scope.session")}
            </Button>
            <Button
              variant={scopeFilter === "agent" ? "default" : "outline"}
              size="sm"
              onClick={() => setScopeFilter("agent")}
            >
              {t("timeline.scope.agent")}
            </Button>
          </div>

          {/* scope id 输入 */}
          {scopeFilter !== "all" && (
            <Input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder={t("timeline.scope.scopeIdPlaceholder")}
              className="w-64 h-9"
            />
          )}

          {/* role 过滤 */}
          <div className="flex gap-1 flex-wrap">
            <Button
              variant={roleFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setRoleFilter("all")}
            >
              {t("timeline.filters.all")}
            </Button>
            <Button
              variant={roleFilter === "user" ? "default" : "outline"}
              size="sm"
              onClick={() => setRoleFilter("user")}
            >
              <User className="h-3.5 w-3.5 mr-1" />
              {t("timeline.filters.user")}
            </Button>
            <Button
              variant={roleFilter === "assistant" ? "default" : "outline"}
              size="sm"
              onClick={() => setRoleFilter("assistant")}
            >
              <Bot className="h-3.5 w-3.5 mr-1" />
              {t("timeline.filters.assistant")}
            </Button>
            <Button
              variant={roleFilter === "tool_call" ? "default" : "outline"}
              size="sm"
              onClick={() => setRoleFilter("tool_call")}
            >
              <Wrench className="h-3.5 w-3.5 mr-1" />
              {t("timeline.filters.toolCall")}
            </Button>
            <Button
              variant={roleFilter === "tool_result" ? "default" : "outline"}
              size="sm"
              onClick={() => setRoleFilter("tool_result")}
            >
              <ListChecks className="h-3.5 w-3.5 mr-1" />
              {t("timeline.filters.toolResult")}
            </Button>
          </div>

          {/* 刷新 + 清空 */}
          <div className="flex items-center gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadEvents(false)}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              {t("timeline.actions.refresh")}
            </Button>
            <Button variant="destructive" size="sm" onClick={openClearDialog}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t("timeline.actions.clear")}
            </Button>
          </div>
        </div>

        {/* === 主区：列表 + 详情 === */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
          {/* 左：列表 */}
          <div className="flex flex-col border border-slate-700/50 rounded-md p-3 bg-slate-900/85 backdrop-blur-sm min-h-0">
            <div className="font-semibold text-sm mb-2 shrink-0 text-slate-100">
              {t("timeline.list.count", { count: total })}
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-1.5 pr-3">
                {events.length === 0 && !isLoading && (
                  <div className="text-center text-slate-400 py-8">
                    {t("timeline.list.empty")}
                  </div>
                )}
                {events.map((ev) => {
                  const Icon = ROLE_ICONS[ev.role] ?? History
                  const color = ROLE_COLOR[ev.role] ?? ROLE_COLOR.unknown
                  const isSelected = selectedEvent?.id === ev.id
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setSelectedEvent(ev)}
                      className={`p-2.5 border rounded cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-blue-500/30 border-blue-400/60"
                          : "hover:bg-slate-800/60 border-slate-700/50"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className={`shrink-0 ${color}`}>
                          <Icon className="h-3 w-3 mr-1" />
                          {ev.role}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs truncate text-slate-100">
                            {ev.type}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {formatTimeOnly(ev.ts)}
                            {ev.sessionId ? ` · ${ev.sessionId.slice(0, 8)}` : ""}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                      </div>
                    </div>
                  )
                })}
                {cursor !== null && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
                    onClick={() => loadEvents(true)}
                    disabled={isLoading}
                  >
                    {t("timeline.list.loadMore")}
                  </Button>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* 右：详情 */}
          <div className="flex flex-col border border-slate-700/50 rounded-md p-3 bg-slate-900/85 backdrop-blur-sm min-h-0 overflow-hidden">
            {selectedEvent ? (
              <EventDetail event={selectedEvent} />
            ) : (
              <div className="text-center text-slate-400 py-8">
                {t("timeline.detail.selectPrompt")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === 清空二次确认 === */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("timeline.clearDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("timeline.clearDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm shrink-0 w-24">
                {t("timeline.clearDialog.scopeLabel")}
              </span>
              <div className="flex gap-1 flex-wrap">
                <Button
                  variant={clearScope === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setClearScope("all")}
                >
                  {t("timeline.scope.all")}
                </Button>
                <Button
                  variant={clearScope === "session" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setClearScope("session")}
                >
                  {t("timeline.scope.session")}
                </Button>
                <Button
                  variant={clearScope === "agent" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setClearScope("agent")}
                >
                  {t("timeline.scope.agent")}
                </Button>
              </div>
            </div>
            {clearScope !== "all" && (
              <div className="flex items-center gap-2">
                <span className="text-sm shrink-0 w-24">
                  {t("timeline.clearDialog.targetIdLabel")}
                </span>
                <Input
                  value={clearTargetId}
                  onChange={(e) => setClearTargetId(e.target.value)}
                  placeholder={t("timeline.scope.scopeIdPlaceholder")}
                  className="flex-1"
                />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("timeline.clearDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              className="bg-red-600 hover:bg-red-700"
            >
              {t("timeline.clearDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- 详情子组件 ----------

function EventDetail({ event }: { event: TimelineEvent }) {
  const { t } = useTranslation()
  const Icon = ROLE_ICONS[event.role] ?? History
  const color = ROLE_COLOR[event.role] ?? ROLE_COLOR.unknown
  const parsed = safeJsonParse(event.payload)

  return (
    <>
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <Badge variant="outline" className={color}>
          <Icon className="h-3 w-3 mr-1" />
          {event.role}
        </Badge>
        <span className="font-mono text-xs">{event.type}</span>
      </div>

      <div className="text-xs space-y-1.5 mb-3 shrink-0">
        <Row label={t("timeline.detail.time")} value={formatTs(event.ts)} mono />
        {event.sessionId && (
          <Row label={t("timeline.detail.sessionId")} value={event.sessionId} mono />
        )}
        {event.agentId && (
          <Row label={t("timeline.detail.agentId")} value={event.agentId} mono />
        )}
        {event.imageId && (
          <Row label={t("timeline.detail.imageId")} value={event.imageId} mono />
        )}
      </div>

      <div className="font-semibold text-xs mb-1 shrink-0 text-slate-200">
        {t("timeline.detail.payload")}
      </div>
      <ScrollArea className="flex-1 border border-slate-700/50 rounded bg-slate-950/60">
        <pre className="text-xs font-mono whitespace-pre-wrap break-all p-2 text-emerald-300">
          {typeof parsed === "string"
            ? parsed
            : JSON.stringify(parsed, null, 2)}
        </pre>
      </ScrollArea>
    </>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-400 shrink-0 w-24">{label}</span>
      <span className={`flex-1 text-slate-100 ${mono ? "font-mono" : ""} break-all`}>{value}</span>
    </div>
  )
}