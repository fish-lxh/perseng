# Perseng 调度系统设计稿

> **状态**：设计稿（v0.1，2026-07-17）
> **目标读者**：Perseng 维护者 / MCP server 开发者 / 桌面端开发者
> **对应代码**：暂无实现。本文档先于代码落地，所有 schema / API 都是提案，最终以代码为准。

---

## 1. 背景与目标

### 1.1 现状

- Perseng 是一个多角色（role-based）的 agent 框架，核心交互通过 MCP 工具完成（`action` / `lifecycle` / `remember` / `learning` / `organization` / `toolx` / `discover`）。
- 事件平台已就绪（`packages/events`）：`EventStore` SQLite 持久化、`EventEnvelope` 通用包、`InProcessEventBus` 进程内分发。
- 桌面端已模块化：`PersengDesktopApp` + `AgentXService` + `settings-window` 等。
- **缺**：所有动作都需要人主动调用工具，没有"时间触发"维度。

### 1.2 目标

引入一个**时间触发的工具调用层**，让 Perseng 能：

1. 按 cron 表达式自动调用任意 MCP 工具
2. 支持多时区（特别是 `Asia/Shanghai` 这种本地时区）
3. 调度过程本身可观测（事件总线 + 历史记录）
4. 出错时有降级与否决权机制
5. 用户能在桌面 UI 中查看、暂停、恢复、删除、立即运行调度

### 1.3 非目标

- ❌ 不实现"日历事件触发"（Google Calendar / Outlook 同步）。这是后续增强。
- ❌ 不实现"自然语言创建调度"（LLM 解析 cron 表达式）。这是后续增强。
- ❌ 不替代外部 daemon（5 人团队那种 agent-daemon 模式）。本设计专注 in-app 调度；daemon 模式作为后续 Phase 3。

---

## 2. 架构总览

### 2.1 一句话

**调度器作为独立 MCP 工具 `schedule`，跑在 MCP server 进程内，事件进现有事件总线，UI 在 settings-window 新增 Schedules 页面。**

### 2.2 组件图

```
┌────────────────────────────────────────────────────────────────────┐
│  Electron 桌面端 (apps/desktop)                                    │
│  ┌──────────────────┐    IPC    ┌──────────────────────────────┐  │
│  │ settings-window  │◀────────▶│ PersengDesktopApp            │  │
│  │  + Schedules 页  │           │  + ScheduleNotificationBridge│  │
│  └──────────────────┘           └──────────────┬───────────────┘  │
└─────────────────────────────────────────────────┼─────────────────┘
                                                  │ IPC / stdio
                                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│  MCP server (packages/mcp-server)                                  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  ToolRegistry                                                 │ │
│  │   ├─ action  ├─ lifecycle  ├─ remember  ├─ learning  ├─ ...  │ │
│  │   └─ schedule  ◀── 本次新增（独立顶层工具）                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────────┐ │
│  │ ScheduleEngine │  │ CronParser     │  │ ScheduleStore        │ │
│  │  (croner tick) │◀─│ (croner)       │  │  (SQLite schedules + │ │
│  │                │  │                │  │   schedule_runs)     │ │
│  └───────┬────────┘  └────────────────┘  └──────────────────────┘ │
│          │                                                        │
│          ▼                                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  EventBus / EventStore (packages/events)                      │ │
│  │   schedule.triggered / schedule.succeeded / schedule.failed   │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### 2.3 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 调度器位置 | **MCP server 内** | 工具调用闭环；事件流已就绪；跨进程一致。备选：Electron 主进程（被否决：仅 app 运行时有效）。 |
| 工具形式 | **独立 `schedule` 工具**（非 lifecycle 子操作） | 调度是"时间触发"，lifecycle 是"意图表达"，两者正交。 |
| 存储 | **新表 schedules / schedule_runs**，可放 `events.db` 同库或独立 `schedules.db` | 与 events 同库便于事务一致；独立库便于备份/迁移。**倾向独立 `schedules.db`**（后续可分）。 |
| 引擎 | **croner**（1 dep、TS 原生、IANA 时区） | node-cron 无时区；自实现太轻；cron 包太重。 |
| 失败处理 | **三档响应**：L1 warn → L2 auto-pause + 询问 → L3 kill switch | 与 5 人团队方案 B 的"否决权状态机"对齐。 |
| 持久化 | SQLite + state 列 + 启动恢复 | 重启后丢失未触发调度不可接受。 |

---

## 3. 存储模型

### 3.1 schedules 表

```sql
CREATE TABLE schedules (
  id            TEXT PRIMARY KEY,                  -- uuid v7
  name          TEXT NOT NULL,
  description   TEXT,                              -- 用户备注
  cron_expr     TEXT NOT NULL,                     -- '0 9 * * 1-5'
  timezone      TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  tool_name     TEXT NOT NULL,                     -- 'action' / 'remember' / 'learning' / 自定义
  tool_args     TEXT NOT NULL,                     -- JSON
  state         TEXT NOT NULL DEFAULT 'pending',   -- pending / active / paused / deleted
  max_retries   INTEGER NOT NULL DEFAULT 0,
  timeout_ms    INTEGER NOT NULL DEFAULT 60000,    -- 单次执行超时
  notify_on_success INTEGER NOT NULL DEFAULT 0,    -- boolean
  notify_on_failure INTEGER NOT NULL DEFAULT 1,    -- boolean
  created_by    TEXT,                              -- role id 或 'user'
  created_at    INTEGER NOT NULL,                  -- epoch ms
  updated_at    INTEGER NOT NULL,
  approved_at   INTEGER,                           -- dry-run 通过的时间
  last_run_at   INTEGER,
  next_run_at   INTEGER,                           -- 缓存 nextRun() 结果
  last_status   TEXT,                              -- success / failed / skipped / vetoed
  last_error    TEXT,
  fail_count    INTEGER NOT NULL DEFAULT 0         -- 连续失败计数（L2 触发依据）
);

CREATE INDEX idx_schedules_state ON schedules(state);
CREATE INDEX idx_schedules_next_run ON schedules(next_run_at) WHERE state = 'active';
```

### 3.2 schedule_runs 表

```sql
CREATE TABLE schedule_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id  TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  scheduled_at INTEGER NOT NULL,                   -- 应该触发的时间
  started_at   INTEGER,
  finished_at  INTEGER,
  status       TEXT NOT NULL,                      -- running / success / failed / skipped / vetoed
  attempt      INTEGER NOT NULL DEFAULT 1,         -- 第几次重试
  error        TEXT,
  output       TEXT,                               -- 工具返回（脱敏）
  duration_ms  INTEGER
);

CREATE INDEX idx_runs_schedule ON schedule_runs(schedule_id, started_at DESC);
```

### 3.3 状态机

```
pending ──dry-run 通过──▶ active ──暂停──▶ paused
   │                       │                │
   │                       └──失败重试─┐    │
   │                                  ▼    │
   │                              active (attempt++) │
   │                                                  │
   └──删除──▶ deleted                                │
                                                     │
active / paused ──删除──▶ deleted                    │
                                                     │
active ──L2 触发──▶ paused (fail_count >= 3) ◀──────┘
```

---

## 4. 工具接口：schedule 工具的 7 个子操作

### 4.1 形式

与现有工具对齐（参考 `action.ts` / `lifecycle.ts` 的 manifest 模式）：

- 文件：`packages/mcp-server/src/tools/schedule.manifest.ts` — manifest
- 文件：`packages/mcp-server/src/tools/schedule.ts` — 工厂 + handler
- 在 `packages/mcp-server/src/tools/index.ts` 的 `buildToolRegistry` 中注册

### 4.2 子操作

| 操作 | 输入 | 输出 | 权限 |
|------|------|------|------|
| `create` | name, cron_expr, timezone, tool_name, tool_args, max_retries, notify_* | { id, state: 'pending', dry_run_preview } | 需要 `dry-run 通过`才能进入 `active` |
| `list` | filter: { state?, tool_name? } | [{ id, name, cron, next_run_at, last_status }] | 公开 |
| `get` | id | schedule 详情 + 最近 10 条 runs | 公开 |
| `pause` | id | { id, state: 'paused' } | 需要 role 或 user |
| `resume` | id | { id, state: 'active', next_run_at } | 需要 role 或 user |
| `delete` | id | { id, state: 'deleted' } | 需要 role 或 user（**软删除**） |
| `run_now` | id | { run_id, scheduled_at: now } | 需要 role 或 user |
| `history` | id, limit?, since? | [run, ...] | 公开 |

注：`run_now` 不影响 `next_run_at`，仅插入一条"立即触发"记录。

### 4.3 参数示例

```yaml
# create
name: "sean 早间简报"
cron_expr: "0 9 * * 1-5"
timezone: "Asia/Shanghai"
tool_name: "remember"
tool_args:
  scope: "session"
  content: "sean 早间简报 - ${today.date}"
  tags: ["briefing", "morning"]
max_retries: 2
notify_on_success: true
notify_on_failure: true
```

### 4.4 dry-run 机制

`create` 时不直接进入 `active`：
1. 校验 cron 表达式合法（`croner` 解析）
2. 校验 tool_name 在 registry 中存在
3. 用模板参数（替换 `${today.*}` 等）做一次**模拟调用**（不实际执行，返回"如果执行会得到 X"）
4. 输出 `dry_run_preview` 给用户确认
5. 用户显式 `resume`（或单独的 `approve` 操作）才进入 `active`

---

## 5. 触发契约

### 5.1 模板参数

`tool_args` 支持以下占位符（执行时替换）：

| 占位符 | 含义 | 示例 |
|--------|------|------|
| `${now.iso}` | ISO 8601 UTC | `2026-07-17T01:23:45Z` |
| `${now.date}` | YYYY-MM-DD（按 schedule 时区） | `2026-07-17` |
| `${now.time}` | HH:mm:ss（按 schedule 时区） | `09:00:00` |
| `${now.weekday}` | Monday / Tuesday / ... | `Friday` |
| `${today.date}` | 同 `${now.date}`，按 schedule 时区 | 同上 |
| `${schedule.id}` | 当前调度 ID | `01J9X...` |
| `${schedule.name}` | 当前调度名 | `sean 早间简报` |
| `${run.attempt}` | 当前是第几次重试 | `1` |

### 5.2 调用流程

```
ScheduleEngine.tick (croner 每分钟 wake)
  │
  ▼
查询 schedules WHERE state='active' AND next_run_at <= now
  │
  ▼
对每条 schedule：
  ├─ BEGIN IMMEDIATE 事务
  ├─ UPDATE state='running' (临时标记，避免并发)
  ├─ INSERT INTO schedule_runs (status='running')
  ├─ COMMIT
  │
  ├─ emit event: schedule.triggered { schedule_id, run_id, attempt }
  │
  ├─ 调用 target tool (tool_name + tool_args，模板替换后)
  │    ├─ 成功 → status='success', emit schedule.succeeded
  │    └─ 失败 → status='failed', attempt < max_retries ? 重试 : 终止
  │
  ├─ UPDATE schedules SET last_*, next_run_at = nextRun(), fail_count = ...
  │
  └─ emit event: schedule.completed { schedule_id, run_id, status, duration }
```

### 5.3 重试策略

- 默认 `max_retries=0`（不重试）
- 启用时：指数退避 30s → 2min → 8min
- 超过重试 → `fail_count++`，`last_status='failed'`
- 触发 L2：连续 3 次 fail_count → 自动 `pause` + 通知用户

### 5.4 互斥与并发

同一 schedule 的多次触发通过 SQLite `BEGIN IMMEDIATE` 串行化：
- 启动时 `UPDATE schedules SET ... WHERE id=? AND state='active'` 失败（state 已变）→ 跳过
- 跨 schedule 并行：每个 schedule 独立 transaction，不阻塞

---

## 6. cron 引擎选型

### 6.1 推荐：**croner**（https://github.com/hexagon/croner）

| 项 | 值 |
|----|----|
| 体积 | ~25 KB |
| 依赖 | 0 |
| TypeScript | 原生 |
| 时区 | ✓ IANA（如 `Asia/Shanghai`） |
| API | `Cron(expr, { timezone, startAt })` + `.nextRun()` |
| Cron 5/6 字段 | ✓ |
| 错误处理 | 表达式非法抛 `Error`，可捕获 |

### 6.2 关键 API 用法

```typescript
import { Cron } from 'croner'

const job = new Cron('0 9 * * 1-5', {
  name: 'sean 早间简报',
  timezone: 'Asia/Shanghai',
  protect: true,                              // 阻止重叠（兜底，主要靠 SQLite 锁）
}, async () => {
  await triggerSchedule(scheduleId)
})

// 查询下次触发
const next = job.nextRun()                    // Date | null
```

### 6.3 引擎生命周期

- MCP server 启动 → `ScheduleEngine.init()`：
  - 打开 `schedules.db` / 初始化 schema
  - 读所有 `state='active'` 的 schedules
  - 对每条 `new Cron(expr, { timezone }, tickCallback)`
  - **不立即触发错过的调度**（避免重启后洪水）；下一次正常 tick 时按 `next_run_at` 排队
- MCP server 关闭 → `engine.shutdown()`：
  - `job.stop()` 所有 jobs
  - 关闭 DB 连接
  - 等待正在执行的 run 完成（最多 5s 后强 kill）

---

## 7. 事件总线集成

### 7.1 事件类型

复用现有 `EventEnvelope`，新增 type：

| type | 触发时机 | producer | payload |
|------|---------|----------|---------|
| `schedule.created` | create 通过 | `tool:schedule` | { schedule_id, name, cron, tool_name } |
| `schedule.dry_run_passed` | dry-run 通过 | `tool:schedule` | { schedule_id, preview } |
| `schedule.triggered` | 开始执行 | `scheduler:engine` | { schedule_id, run_id, scheduled_at, attempt } |
| `schedule.succeeded` | 执行成功 | `scheduler:engine` | { schedule_id, run_id, duration_ms } |
| `schedule.failed` | 执行失败 | `scheduler:engine` | { schedule_id, run_id, error, attempt } |
| `schedule.retried` | 进入重试 | `scheduler:engine` | { schedule_id, run_id, attempt, next_attempt_at } |
| `schedule.paused` | 自动或手动暂停 | `tool:schedule` 或 `scheduler:engine` | { schedule_id, reason: 'auto' \| 'manual' } |
| `schedule.deleted` | 删除 | `tool:schedule` | { schedule_id } |

### 7.2 与现有事件流的关系

- `remember` / `learning` 工具触发的事件（如 `memory.recorded`）保持不变
- 调度触发的事件是**元事件**（meta-events），描述"何时、为谁、为什么"调了某个工具
- UI 可用 `query({ type: 'schedule.*', schedule_id: ... })` 做时间线展示

---

## 8. UI：settings-window Schedules 页面

### 8.1 路由

`settings-window` 新增 tab "Schedules"，与已有 Language / Theme / Resource 并列。

### 8.2 组件结构

```
apps/desktop/src/view/pages/settings-window/
├─ index.tsx                          (已有，加 tab)
├─ components/
│   ├─ LanguageSelector.tsx           (已有)
│   ├─ ThemeSelector.tsx              (已有)
│   ├─ ScheduleList.tsx               (新增)
│   ├─ ScheduleEditor.tsx             (新增)
│   ├─ ScheduleHistory.tsx            (新增)
│   └─ CronInput.tsx                  (新增，带预览)
```

### 8.3 ScheduleList 视图

```
┌─ Schedules ──────────────────────────────────────────────┐
│ [+] 新建   [刷新]   [⏸ 暂停所有]   [▶ 恢复所有]          │
│                                                          │
│ ● sean 早间简报                       [▶] [⏸] [🗑] [⋯]  │
│   工具: remember  |  0 9 * * 1-5 (Asia/Shanghai)         │
│   下次: 2026-07-18 09:00:00 CST (in 21h 36m)             │
│   上次: ✓ 2026-07-17 09:00:12 (took 245ms)               │
│                                                          │
│ ● verifier 每日收盘检查               [▶] [⏸] [🗑] [⋯]  │
│   工具: action  |  0 18 * * 1-5 (Asia/Shanghai)          │
│   下次: 2026-07-17 18:00:00 CST (in 6h 35m)              │
│   上次: ✗ 2026-07-16 18:00:05                            │
│        Error: action.activate 404 - role not found       │
│        [查看历史] [查看事件]                              │
│                                                          │
│ ⊙ verifier 数据备份 (已暂停)           [▶] [⏸] [🗑] [⋯]  │
│   工具: toolx  |  0 2 * * 0 (Asia/Shanghai)              │
│   暂停于: 2026-07-10 (连续 3 次失败，已通知)              │
│   [查看失败原因] [恢复]                                  │
└──────────────────────────────────────────────────────────┘
```

### 8.4 新建向导（ScheduleEditor）

3 步：
1. **基本信息**：name + description
2. **触发规则**：cron 表达式（带语法提示 + 下次触发预览） + 时区（默认 `Asia/Shanghai`，可改）
3. **动作配置**：
   - tool_name 下拉（仅显示当前 registry 中已注册的工具）
   - tool_args 表单（动态生成，根据工具 manifest 的 inputSchema）
   - 失败处理：max_retries / notify / fallback
4. **预览 + 确认**：显示 dry-run 结果，用户点"激活"

### 8.5 IPC 桥

复用 `ElectronAPI.invokeAllowedChannel`（preload 已暴露）：
- `schedule:list` / `schedule:get` / `schedule:create` / `schedule:pause` / `schedule:resume` / `schedule:delete` / `schedule:run_now` / `schedule:history`
- 主进程（`PersengDesktopApp`）转发到 MCP server（通过 stdio / SSE）

---

## 9. 安全与否决权

### 9.1 三档响应（与 5 人团队方案 B 对齐）

| 级别 | 触发条件 | 动作 |
|------|---------|------|
| **L1 warn** | 单次失败 | 桌面通知；写入 `schedule.failed` 事件；`fail_count=1`；不暂停 |
| **L2 auto-pause + 询问** | `fail_count >= 3` | 自动 `state='paused'`；模态弹窗"调度 X 连续失败 3 次，是否继续？" |
| **L3 kill switch** | 用户主动 / 全局紧急旁路 | `state='paused'`（全局）；模态提示"已暂停所有调度" |

### 9.2 dry-run 强制

- 所有新建调度**必须**经过 dry-run 才能进 `active`
- dry-run 内容：
  - cron 解析 + 下次 5 次触发时间
  - tool_name 存在性校验
  - tool_args schema 校验
  - 模板替换后的最终 args（带真实占位符值）
- 用户在 UI 看到预览后显式确认

### 9.3 权限

- `create` / `delete`：需要 `role` 处于 active 状态，或显式 `user` 确认
- `list` / `get` / `history`：公开
- `run_now` / `pause` / `resume`：需要 role 或 user

### 9.4 速率限制

- 每用户 / 每角色：最多 100 个 active 调度
- 每小时：最多触发 1000 次（防 runaway）

---

## 10. 跨平台与生命周期

### 10.1 平台差异

| 平台 | 调度器跑在哪 | 通知方式 | 备注 |
|------|------------|---------|------|
| Windows | MCP server 内 + 桌面通知 | Electron Notification API | 主流场景 |
| macOS | 同上 | 系统通知中心 | dock 未运行时需 `app.dock.setBadge` 配合 |
| Linux | 同上 | libnotify（Electron 自动） | 桌面环境差异大，文档需注明 |

### 10.2 时区处理

- 调度 cron 表达式按 schedule 的 `timezone` 字段解析（IANA 格式）
- 用户在 UI 中看到的是本地时间，存的是 UTC + 时区
- `croner` 内置时区支持，无需额外依赖

### 10.3 重启行为

| 场景 | 行为 |
|------|------|
| MCP server 重启 | `ScheduleEngine.init()` 重新加载所有 active 调度，**不立即补触发错过的**（避免洪水）；下次正常 tick 按 `next_run_at` 排队 |
| 桌面端重启 | MCP server 自动重启（MCP server 是 desktop 子进程），调度器随之重启 |
| 系统休眠唤醒 | croner 内置"catch-up" 选项，默认 `false`：唤醒后不补触发错过的，按下一个 next_run_at 触发 |

---

## 11. 开放问题与权衡

### 11.1 已确认（基于本次对话）

| 问题 | 决策 |
|------|------|
| 调度器位置 | MCP server 内 |
| 工具形式 | 独立 `schedule` 工具 |
| UI 位置 | settings-window 新增 tab |
| 触发进事件总线 | ✓ |

### 11.2 待讨论

| 问题 | 选项 | 倾向 |
|------|------|------|
| 调度器是否要独立 `schedules.db` | A) 同 events.db B) 独立 schedules.db | **B**（迁移/备份独立） |
| 是否暴露"调度触发→目标工具"的事件供其他工具订阅 | A) 是（InProcessEventBus） B) 否（只写 EventStore） | **A**（为 Phase 3 智能化留口） |
| cron 表达式 vs 间隔（"每 30 分钟"） | A) 只支持 cron B) cron + interval | **B**（interval 用 `croner` 的 `*/30 * * * *` 表达即可，无需额外 API） |
| 是否支持"工作日跳过节假日" | A) 暂不支持 B) 接 holidays.js | **A**（先简单，后续按需） |
| 失败 fallback tool 的递归深度 | A) 1 层 B) 3 层 C) 不限 | **A**（避免链式雪崩） |
| 删除是软删除还是硬删除 | A) 软删（state='deleted'） B) 硬删 | **A**（保留审计） |

### 11.3 与 5 人团队方案 B 的关系

CLAUDE.md 中提到的方案 B（`agent-daemon.js` 常驻进程）是另一个独立方向。本设计**专注 in-app 调度**，不替代 daemon。

后续如果要做 daemon 模式：
- daemon 调 MCP API 触发工具（走 IPC 协议）
- daemon 自己的调度器（独立 schema，独立 UI）
- 两个调度器可以共存：app 内用于个人轻量，daemon 用于团队协作

---

## 12. 落地阶段（建议）

### Phase 1（核心引擎 + 工具接口）— 估计 1 周

- [ ] `packages/mcp-server/src/tools/schedule.manifest.ts`
- [ ] `packages/mcp-server/src/tools/schedule.ts`
- [ ] `packages/mcp-server/src/scheduler/ScheduleEngine.ts`
- [ ] `packages/mcp-server/src/scheduler/ScheduleStore.ts`
- [ ] `packages/mcp-server/src/scheduler/CronParser.ts`（包装 croner）
- [ ] `schedules.db` schema + 迁移脚本
- [ ] 7 个子操作的单元测试
- [ ] 集成测试：create → trigger → succeed → audit
- [ ] 无 UI（CLI / tool call 验证）

### Phase 2（UI + 通知）— 估计 1 周

- [ ] `apps/desktop/src/view/pages/settings-window/components/ScheduleList.tsx`
- [ ] `apps/desktop/src/view/pages/settings-window/components/ScheduleEditor.tsx`
- [ ] `apps/desktop/src/view/pages/settings-window/components/ScheduleHistory.tsx`
- [ ] `apps/desktop/src/view/pages/settings-window/components/CronInput.tsx`
- [ ] `PersengDesktopApp` 加 IPC 桥 + Notification 集成
- [ ] 端到端测试：UI 创建 → 触发 → 桌面通知

### Phase 3（智能化增强）— 后续

- [ ] 自然语言创建（"每天早上 9 点给 sean 角色发简报" → 解析 cron）
- [ ] 失败模式学习（自动调整 retry / pause 阈值）
- [ ] 可选：daemon 模式
- [ ] 可选：日历事件触发（Google Calendar / Outlook）

---

## 13. 附录：相关文件路径速查

| 主题 | 路径 |
|------|------|
| MCP server 入口 | `packages/mcp-server/src/tools/index.ts` |
| 现有工具参考 | `packages/mcp-server/src/tools/action.ts` / `lifecycle.ts` / `remember.ts` |
| 事件总线 | `packages/events/src/EventBus.ts` / `EventStore.ts` / `instance.ts` |
| 桌面入口 | `apps/desktop/src/main/index.ts` |
| 桌面设置窗口 | `apps/desktop/src/view/pages/settings-window/index.tsx` |
| Preload IPC | `apps/desktop/src/preload/index.ts` |
| 5 人团队方案 B | `E:\5人团队协作组\schedule\agent-daemon.js`（外部） |

---

## 14. 变更历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-07-17 | v0.1 | 初稿。基于对话结论：MCP server 内 / 独立工具 / settings-window / 触发进事件总线。 |