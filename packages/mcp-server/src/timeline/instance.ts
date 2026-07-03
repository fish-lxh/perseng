/**
 * EventLog 单例管理
 *
 * 主进程（写）和 MCP server 进程（读）共享同一个 db 文件。
 * 默认路径：~/.perseng/timeline/events.db
 *
 * 跨进程：SQLite WAL 模式天然支持多读单写，无需锁。
 */

import * as os from 'node:os'
import * as path from 'node:path'
import { EventLog } from './EventLog.js'

let _instance: EventLog | undefined
let _instancePath: string | undefined

/**
 * 获取（或创建）默认 db 路径下的 EventLog 单例。
 * 同进程内多次调用返回同一实例。
 */
export function getEventLog(dbPath?: string): EventLog {
  const targetPath = dbPath ?? path.join(os.homedir(), '.perseng', 'timeline', 'events.db')
  if (!_instance || _instancePath !== targetPath) {
    if (_instance) {
      // 路径变了，先关旧的
      try {
        void _instance.close()
      } catch {
        /* ignore */
      }
    }
    _instance = new EventLog(targetPath)
    _instancePath = targetPath
  }
  return _instance
}

/** 测试或重启时清空单例引用（不关连接） */
export function resetEventLog(): void {
  _instance = undefined
  _instancePath = undefined
}
