/**
 * schedule:* IPC handlers — settings-window → MCP server schedule tool (Phase 2)
 *
 * KNUTH-FEAT 2026-07-18 (Phase 2 / Commit 5)
 *
 * 设计要点：
 * - 不走 JSON-RPC，直接调 MCP server 的 schedule tool handler
 *   （persengMCPServer 跟 electron main 共享同一 Node 进程 — 见 PersengServerAdapter）
 * - 每个 IPC channel 对应 schedule 工具的一个 operation（除了 list 的几个变体）
 * - 统一返回 { success, data?, error? } 让 renderer 端易于处理
 * - 幂等注册守卫：多次调用 register 不会重复挂 handler
 *
 * 通道清单（与 schedule 工具的 8 个 operation 对齐）：
 *   schedule:list      → operation: 'list'
 *   schedule:get       → operation: 'get'
 *   schedule:create    → operation: 'create'
 *   schedule:pause     → operation: 'pause'
 *   schedule:resume    → operation: 'resume'
 *   schedule:delete    → operation: 'delete'
 *   schedule:history   → operation: 'history'
 *   schedule:runNow    → operation: 'run_now'
 */

import { ipcMain } from 'electron'
import * as logger from '@promptx/logger'
import type { PersengServerAdapter } from '~/main/infrastructure/adapters/PersengServerAdapter'

// ============================================================================
// 形状适配：MCP tool 返回值 → IPC 友好
// ============================================================================

/**
 * 从 MCP tool handler 返回值里提取文本（content[0].text）。
 * 失败时返回 null，让上层走 generic error 路径。
 */
function extractText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  if (!Array.isArray(r.content) || r.content.length === 0) return null
  const first = r.content[0]
  return first && typeof first.text === 'string' ? first.text : null
}

interface IpcOk<T = unknown> {
  success: true
  data: T
  text: string
}

interface IpcErr {
  success: false
  error: string
}

function ok<T = unknown>(result: unknown, data: T): IpcOk<T> {
  return {
    success: true,
    data,
    text: extractText(result) ?? '',
  }
}

function err(message: string): IpcErr {
  return { success: false, error: message }
}

// ============================================================================
// IPC 注册
// ============================================================================

export interface ScheduleIpcDeps {
  getServerPort(): PersengServerAdapter | null
}

let registered = false

/** 测试钩子：清掉 idempotent 守卫，让 beforeEach 能重新注册 */
export function _resetScheduleIpcRegistration(): void {
  registered = false
}

export function registerScheduleIpc(deps: ScheduleIpcDeps): void {
  if (registered) return
  registered = true

  const handle = async (
    opName: string,
    args: Record<string, unknown>,
  ): Promise<IpcOk | IpcErr> => {
    try {
      const port = deps.getServerPort()
      if (!port) {
        return err('MCP server adapter not initialized')
      }
      const result = await port.invokeScheduleTool({ operation: opName, ...args })
      return ok(result, args)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error(`[schedule:${opName}] failed: ${msg}`)
      return err(msg)
    }
  }

  // list — filter 可选 { state?, toolName?, limit? }
  ipcMain.handle(
    'schedule:list',
    async (_event, filter: Record<string, unknown> = {}) =>
      handle('list', filter),
  )

  // get — 必填 { id }
  ipcMain.handle(
    'schedule:get',
    async (_event, args: { id: string }) => handle('get', args),
  )

  // create — { name, cronExpr, timezone?, toolName, toolArgs, maxRetries?, timeoutMs?, notifyOnSuccess?, notifyOnFailure? }
  ipcMain.handle(
    'schedule:create',
    async (_event, args: Record<string, unknown>) => handle('create', args),
  )

  // pause — { id }
  ipcMain.handle(
    'schedule:pause',
    async (_event, args: { id: string }) => handle('pause', args),
  )

  // resume — { id }
  ipcMain.handle(
    'schedule:resume',
    async (_event, args: { id: string }) => handle('resume', args),
  )

  // delete — { id }
  ipcMain.handle(
    'schedule:delete',
    async (_event, args: { id: string }) => handle('delete', args),
  )

  // history — { id, limit?, since? }
  ipcMain.handle(
    'schedule:history',
    async (_event, args: { id: string; limit?: number; since?: number }) =>
      handle('history', args),
  )

  // runNow — { id }
  ipcMain.handle(
    'schedule:runNow',
    async (_event, args: { id: string }) => handle('run_now', args),
  )

  logger.info('[scheduleIpc] registered 8 channels')
}