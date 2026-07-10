# Events Platform Cutover Runbook

**Date**: 2026-07-11 · **Stage**: M3 → M5 · **Owner**: 平台 / Perseng Dev

本文档是 **Runtime Event Platform** 重构从双写到完全切换的 runbook。
读完这份文档就能在不冒风险的前提下，把 Timeline UI 从 V2 (`events_v2`)
单一切回 legacy `events` 表（如果需要回退），或者彻底关闭 legacy。

> **M5 状态更新 (2026-07-11)**：
> - §2.1 已执行 — AgentX 双写关闭
> - MCP `query_timeline` / `clear_timeline` 工具已切到 V2
> - `packages/mcp-server/src/timeline/` 目录已删除（EventLog/EventLogger/instance/index）
> - `TimelineEventRow` 类型已 import 自 `@promptx/events`，无本地副本

---

## 0. 现状（M3 PR-3 落地后）

| 组件 | 数据源 | 文件位置 |
|------|--------|---------|
| Renderer TimelinePanel | `@promptx/events` V2 (`events_v2`) | `~/.perseng/events/events.db` |
| `apps/desktop/src/main/ipc/timelineIpc.ts` | `getEventStore()` | 同上 |
| `AgentXService.attachTimeline(...)` | **legacy** `getEventLog()` (双写) | `~/.perseng/timeline/events.db` |
| `@promptx/mcp-server/timeline/EventLog.ts` | legacy | 仍可用，未删 |

两个 DB 物理上完全独立（不同路径、不同表、不同 SQLite connection）。

---

## 1. 验证矩阵（每个切换步骤之前都要跑一次）

### 1.1 健康检查

```bash
# 1.1.1 — V2 能写
node -e "
  const Db = require('better-sqlite3');
  const db = new Db(process.env.HOME + '/.perseng/events/events.db', {readonly:true});
  console.log('v2 count:', db.prepare('SELECT COUNT(*) AS n FROM events_v2').get());
  db.close();
"

# 1.1.2 — legacy 还能写（双写没断）
node -e "
  const Db = require('better-sqlite3');
  const db = new Db(process.env.HOME + '/.perseng/timeline/events.db', {readonly:true});
  console.log('legacy count:', db.prepare('SELECT COUNT(*) AS n FROM events').get());
  db.close();
"

# 1.1.3 — 打开 Timeline UI，确认列表能加载
```

全绿 → 进入 §2；任一红 → §5（回退）。

### 1.2 双写一致性

V2 与 legacy 应当有重叠事件（AgentX 走的是 legacy 路径；core.actAs / MCP action / lifecycle / learning / organization 走 V2）。

```bash
# 按 type 计数，确认 Producer 域覆盖
sqlite3 ~/.perseng/events/events.db   "SELECT producer, COUNT(*) FROM events_v2 GROUP BY producer"
sqlite3 ~/.perseng/timeline/events.db "SELECT type,   COUNT(*) FROM events     GROUP BY type"
```

预期：
- V2 在 `producer` 维度上能看到 `core:actAs` / `tool:action` / `tool:lifecycle` / `tool:learning` / `tool:organization`
- Legacy 在 `type` 维度上以 `tool_*` / `text_*` / `message_*` 为主

---

## 2. 切到 V2 单写（推荐路径）

### 步骤 2.1 — 关掉 AgentX 双写

`apps/desktop/src/main/services/AgentXService.ts` lines 414-424：把整个 `try { ... } catch (err)` 块注释掉。
`this.detachTimeline` 字段保留 — 后续 rollback 用。

```diff
- try {
-   const { getEventLog, attachEventLogger } = await import('@promptx/mcp-server/timeline')
-   this.detachTimeline = built.attachTimeline(attachEventLogger as any, getEventLog())
-   logger.info('Timeline event capture attached (onAny mode)')
- } catch (err) {
-   logger.warn('Failed to attach timeline capture (non-fatal):', String(err))
- }
+ // KNUTH-FEAT 2026-07-XX (M5 cutover): legacy 双写关闭。V2 single-source。
+ // 回退：恢复上面块；timeline UI 立即退回到 legacy。
```

### 步骤 2.2 — Renderer 已经只读 V2

无操作 — `timelineIpc.ts` 在 M3 PR 改完。

### 步骤 2.3 — 验证（再跑 §1.1）

预期：`legacy count` 不再增长，`v2 count` 持续增长。

### 步骤 2.4 — 归档 legacy

```bash
mv ~/.perseng/timeline/events.db ~/.perseng/timeline/events.db.archived-$(date +%Y%m%d)
```

事件保留 ≥ 30 天再删。

---

## 3. 切回 legacy（紧急回退）

`@promptx/events` 出现 P0 故障，且 §2 已执行。

### 步骤 3.1 — `apps/desktop/src/main/services/AgentXService.ts`

恢复 `attachTimeline(...)` 块。

### 步骤 3.2 — `apps/desktop/src/main/ipc/timelineIpc.ts`

将 `import { getEventStore } from '@promptx/events'` 换回 `getEventLog()`，
并把 `mapRowToLegacy` 改为直通 — V2 row 字段名不一样，需要重新映射。

### 步骤 3.3 — `packages/mcp-server/src/tools/timeline.ts`

恢复 `import { getEventLog } from '~/timeline/index.js'` + handler 内 `getEventStore()` → `getEventLog()`。
但因为 `packages/mcp-server/src/timeline/` 已在 M5 删除，此回退需要先把目录恢复
（git revert M5 commit）。**建议**：M5 已是终态，不要回退；如必须回退，回滚整个 M5 commit。

不删 `packages/events/*`；它仍然在 npm workspace 里，下个 release 可以再次启用。

---

## 4. 主进程 IPC 通道契约

| 通道 | 请求 | 响应 | 备注 |
|------|------|------|------|
| `timeline:query` | `RendererQueryFilter` | `{success,events:TimelineEventRow[],total,nextCursor}` | renderer 直接消费 |
| `timeline:clear` | `{scope,targetId?}` | `{success,deleted}` |  |
| `timeline:statistics` | — | `EventStatistics` | 旧面板用 |
| `timeline:audit` | — | `EventStatistics` (M3 新增) | 给未来 dashboard |

`TimelineEventRow` 形状：
```ts
interface TimelineEventRow {
  id: number
  ts: number
  sessionId: string | null
  containerId: string | null
  agentId: string | null
  imageId: string | null
  type: string
  role: EventRole
  payload: string   // JSON-stringified
  createdAt: number
}
```

**注**：渲染层 `TimelinePanel.tsx` 没有改动 — 它继续按 legacy 形状读 IPC。这是双写期的接口稳定策略。

---

## 5. Feature Flag

| Flag | 默认 | 含义 |
|------|------|------|
| `PERSENG_EVENTS_ENABLED=false` | unset → `true` | `EventStore.append` short-circuit；timeline UI 仍可读（历史） |
| `PERSENG_EVENTS_DB_PATH` | `~/.perseng/events/events.db` | 测试 / 多实例时覆盖 |

紧急回退可在 launch env 加 `PERSENG_EVENTS_ENABLED=false` 让写入立刻停止。

---

## 6. 联系人 / 升级路径

- 平台负责人：本仓库 owner (`Perseng Dev`)
- 性能 / 容量：详见 `packages/events/src/EventStore.ts` — 8000 行/秒目标的瓶颈点在 WAL
- Schema 迁移：见 `packages/events/src/EventStore.ts::_initializeSchema()`

如果发现：
1. `events_v2` 写入 IO 显著高于 legacy
2. WAL 文件持续 > 100MB
3. `timeline:query` 延迟 > 500ms（默认 limit 50）

立即触发 §3 紧急回退，然后在本仓库开 issue。
