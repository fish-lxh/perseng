/**
 * EventStore 单例管理 — 镜像 packages/mcp-server/src/timeline/instance.ts 模式
 *
 * 主进程 / MCP server 启动时通过 getEventStore() 拿同一份 db 连接；
 * 测试 / 脚本可传 dbPath 覆盖。resetEventStore() 用于测试夹具 beforeEach。
 */

import { EventStore } from './EventStore.js'

let _singleton: EventStore | null = null

/**
 * 拿（或创建）单例。
 *
 * - 第一次调用时按 defaultDbPath()/events-db-schema v2 初始化
 * - 后续调用复用同一连接
 * - 传 dbPath 会替换当前 singleton（适合多 db 场景）
 *
 * 用 env `PERSENG_EVENTS_DB_PATH` 覆盖默认路径。
 */
export function getEventStore(dbPath?: string): EventStore {
  if (dbPath !== undefined) {
    // 显式路径：总是新建（避免和未指定路径的 singleton 混淆）
    if (_singleton) {
      void _singleton.close()
    }
    _singleton = new EventStore(dbPath)
    return _singleton
  }
  if (!_singleton) {
    _singleton = new EventStore()
  }
  return _singleton
}

/** 测试用：清掉单例。重新 getEventStore() 会按 env 重建。 */
export function resetEventStore(): void {
  if (_singleton) {
    void _singleton.close()
  }
  _singleton = null
}

/**
 * 拿单例；接受额外 enabled 覆盖（用于显式 disabled 测试）。
 * 测试代码用 `getEventStoreForTest(':memory:', { enabled: false })`。
 */
export function getEventStoreForTest(
  dbPath?: string,
  options: { enabled?: boolean } = {},
): EventStore {
  const s = new EventStore(dbPath, options)
  return s
}
