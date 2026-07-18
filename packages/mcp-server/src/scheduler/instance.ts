/**
 * scheduler/instance.ts — ScheduleStore 单例管理
 *
 * 与 packages/events/src/instance.ts 严格对齐：
 *   - 进程级 _singleton
 *   - getScheduleStore(dbPath?) — 显式路径永远新建（避免和未指定路径的单例混淆）
 *   - resetScheduleStore() — 测试夹具 beforeEach 用
 *   - getScheduleStoreForTest(dbPath, options?) — 总是不走 singleton
 *
 * env `PERSENG_SCHEDULES_DB_PATH` 覆盖默认路径（同 PERSENG_EVENTS_DB_PATH 模式）。
 */

import { ScheduleStore } from './ScheduleStore.js'

let _singleton: ScheduleStore | null = null

/**
 * 拿（或创建）单例。
 *
 * - 第一次调用按 defaultDbPath() 初始化
 * - 后续调用复用同一连接
 * - 传 dbPath 会替换当前 singleton（适合多 db / 测试场景）
 */
export function getScheduleStore(dbPath?: string): ScheduleStore {
  if (dbPath !== undefined) {
    // 显式路径：总是新建
    if (_singleton) {
      void _singleton.close()
    }
    _singleton = new ScheduleStore(dbPath)
    return _singleton
  }
  if (!_singleton) {
    _singleton = new ScheduleStore()
  }
  return _singleton
}

/** 测试用：清掉单例。下次 getScheduleStore() 会按 env 重建 */
export function resetScheduleStore(): void {
  if (_singleton) {
    void _singleton.close()
  }
  _singleton = null
}

/**
 * 拿一个不走单例的实例（测试 / 脚本）。
 * options 透传给 ScheduleStore 构造（目前支持 silent 抑制日志）。
 */
export function getScheduleStoreForTest(
  dbPath?: string,
  options: { silent?: boolean } = {},
): ScheduleStore {
  return new ScheduleStore(dbPath, options)
}
