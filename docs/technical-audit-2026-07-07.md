# Perseng 技术审计与修复报告

## 1. 审计范围

本轮工作覆盖以下范围：

- Monorepo 工程基线检查：`pnpm` workspace、`turbo` 流程、TypeScript、ESLint、Vitest
- 桌面端安全审计：Electron 主进程、`preload`、IPC、WebAccess、工作区/资源访问边界
- Runtime 运行时稳定性：Claude SDK 集成、MCP 配置桥接、上下文压缩、类型系统一致性
- CLI / MCP Server / Desktop 回归验证

## 2. 本轮结论

当前代码库已完成一轮“高危优先 -> 中危收敛 -> 全仓回归”的修复闭环。

已确认通过：

- `pnpm test`
- `pnpm -r --if-present typecheck`
- `pnpm --filter @agentxjs/runtime test`
- `pnpm --filter @promptx/desktop test:run`

## 3. 已修复的高风险问题

### 3.1 任意 IPC 调用暴露

问题：

- `preload` 曾暴露泛化 `invoke(channel, ...args)`，渲染层理论上可调用任意主进程 IPC。

修复：

- 将可调用通道收口到显式白名单。

影响：

- 缩小 Electron 渲染层到主进程的攻击面。

### 3.2 WebAccess token / URL / Cookie 设计不安全

问题：

- token 太短
- token 位于 query 参数
- 启动日志会带出 token
- 授权模型过宽

修复：

- 提升 token 强度
- 从 query token 改为 fragment bootstrap token
- 增加 `/auth` + `HttpOnly Cookie`
- 增加 `/ws` 代理鉴权
- 增加一组安全响应头

影响：

- 降低 token 泄露、重放和跨源滥用风险。

### 3.3 AgentX API Key 明文落盘

问题：

- `AgentX` 配置中的 `apiKey` 可明文写入磁盘。

修复：

- 引入 Electron `safeStorage`
- 对顶层和 profile 内的敏感字段进行加密落盘
- 兼容旧明文配置读取

### 3.4 路径穿越与命令注入

问题：

- 工作区文件访问、资源目录访问、认知目录拼接、角色激活命令都存在输入边界不足。

修复：

- `WorkspaceService` 增加工作区根边界校验
- `ResourceListWindow` 增加相对路径安全解析
- `CognitionWindow` 收紧 `roleId`
- `PersengActivationAdapter` 从 `exec` 改为 `execFile`

## 4. 已修复的中风险问题

### 4.1 Runtime 类型系统收敛

问题：

- `packages/runtime` 在 TypeScript 严格校验下存在真实业务类型错误，集中在：
  - `ContextManager`
  - `SDKQueryLifecycle`
  - `RuntimeImpl`

修复：

- `ContextManager` 不再假定所有 `Message` 联合成员都含 `content`
- 为 tool call / tool result 建立统一文本提取与 token 估算路径
- 在 `buildOptions` 中增加 MCP runtime config -> Claude SDK config 的规范化桥接
- 修正 `context_warning` 事件的 `source/category`
- 增加最近 image 选择的空值保护

结果：

- `packages/runtime` 已恢复为：
  - `typecheck` 通过
  - `lint` 通过
  - `test` 通过

### 4.2 CLI 类型检查误伤

问题：

- `apps/cli` 继承根级声明输出配置后，在 `--noEmit` 类型检查阶段仍会尝试为 `@promptx/core` 的 JS 源码生成声明，触发 `TS9006`。

修复：

- 在 `apps/cli/tsconfig.json` 中关闭 `declaration` / `declarationMap`。

结果：

- `pnpm --filter @promptx/cli typecheck` 通过。

### 4.3 Desktop 严格空值问题

问题：

- `WebAccessService` 的 cookie 解析在严格模式下存在 `undefined` 索引风险。

修复：

- 对 cookie key 增加空值守卫。

结果：

- `pnpm --filter @promptx/desktop typecheck` 通过。

### 4.4 MCP Server 契约测试漂移

问题：

- `packages/mcp-server/src/interfaces/__tests__/MCPServer.test.ts` 中 `server` 变量未初始化，导致整组契约测试对 `undefined.start()` / `undefined.stop()` 调用而失败。

修复：

- 补齐最小测试桩 `TestMCPServer`
- 增加顶层 `beforeEach`
- 增加 `afterEach` 统一 stop 清理

结果：

- `pnpm --filter @promptx/mcp-server test` 通过。

## 5. 验证记录

本轮已执行并确认成功的关键命令：

```bash
pnpm --filter @agentxjs/runtime typecheck
pnpm --filter @agentxjs/runtime test
pnpm --filter @promptx/cli typecheck
pnpm --filter @promptx/desktop typecheck
pnpm --filter @promptx/desktop test:run
pnpm --filter @promptx/mcp-server test
pnpm -r --if-present typecheck
pnpm test
```

## 6. 当前剩余风险

当前没有未收敛的红色构建项，但仍存在后续值得继续推进的非阻塞风险：

- `packages/core` 仍以大量 JS 源码为主，类型边界不如 TS 包稳定
- MCP Server 的接口测试虽然已恢复，但覆盖重点仍偏“契约存在性”，可进一步增加真实 transport 行为断言
- Electron 桌面端的安全模型已明显收紧，但仍建议继续审查外部资源打开、工作区授权、日志脱敏等边角路径
- 目前尚未形成一份正式的依赖漏洞扫描归档文档，可在后续交付中补充版本、CVE、处置状态三元表

## 7. 架构与工程化建议

### 7.1 类型系统

- 优先将 `packages/core` 的关键基础模块从 JS 渐进迁移到 TS
- 对跨包边界统一导出稳定类型，减少运行时包与 SDK 包的重复类型定义

### 7.2 安全治理

- 将安全敏感入口统一纳入 checklist：IPC、文件系统、外链、命令执行、密钥落盘
- 为高风险入口增加单元测试或契约测试，而不是只靠人工回归

### 7.3 可观测性

- 统一日志字段结构，明确 `requestId / imageId / agentId / sessionId`
- 对 WebAccess、AgentX、MCP 连接建立更系统的诊断事件流

### 7.4 测试体系

- 将“高风险修复回归集”抽成稳定命令，避免每次全量人工挑选
- 为 `runtime` 的 context warning / summarization / MCP bridge 增加更明确的行为回归用例

### 7.5 发布与配置

- 对本地状态文件如 `workspaces.json` 增加 JSON 解析失败时的自恢复或错误提示
- 将关键配置的格式校验前置到启动阶段，避免运行时才暴露损坏配置

## 8. 额外本地修复

本轮还修复了本机配置文件：

- `c:\Users\46649\.Perseng\workspaces.json`

问题：

- 文件尾部存在非法文本，已不是合法 JSON。

修复：

- 删除损坏尾缀，恢复为合法 JSON。

意义：

- 避免桌面端工作区配置读取再次因本地配置损坏而失败。

## 9. 建议的下一阶段

建议下一步进入正式交付整理阶段：

1. 输出完整问题清单矩阵
2. 输出安全漏洞评估表
3. 输出架构/工程化/部署/监控优化路线图
4. 按模块拆分后续重构计划：
   - `packages/core` 类型化
   - `packages/mcp-server` 行为测试加深
   - `apps/desktop` 安全边界持续收紧

## 10. 安全漏洞清单与处置状态

下表汇总本轮识别出的关键安全问题、影响面、根因与当前处置状态。

| 编号 | 问题 | 风险等级 | 位置 | 根因 | 当前状态 |
|------|------|----------|------|------|----------|
| SEC-001 | 渲染层可任意调用 IPC | High | `apps/desktop/src/preload/index.ts` | `invoke(channel, ...args)` 直接暴露 | 已修复 |
| SEC-002 | WebAccess token 设计过弱且易泄露 | High | `apps/desktop/src/main/services/WebAccessService.ts` | token 太短、走 query、日志暴露、鉴权模型过宽 | 已修复 |
| SEC-003 | AgentX API Key 明文落盘 | High | `apps/desktop/src/main/services/AgentXService.ts` | 敏感字段未加密持久化 | 已修复 |
| SEC-004 | 工作区文件访问缺少边界校验 | High | `apps/desktop/src/main/services/WorkspaceService.ts` | 主进程文件操作未限制在注册 workspace 内 | 已修复 |
| SEC-005 | 资源目录存在路径穿越 | High | `apps/desktop/src/main/windows/ResourceListWindow.ts` | 相对路径未做逃逸校验 | 已修复 |
| SEC-006 | 角色激活存在命令注入面 | High | `apps/desktop/src/main/infrastructure/PersengActivationAdapter.ts` | shell 命令拼接执行 | 已修复 |
| SEC-007 | 认知目录拼接缺少 `roleId` 校验 | Medium | `apps/desktop/src/main/windows/CognitionWindow.ts` | 外部输入直接参与路径构造 | 已修复 |
| SEC-008 | 外链协议缺少白名单 | Medium | `apps/desktop/src/main/index.ts` | `openExternal/loadURL` 协议边界不足 | 已修复 |
| SEC-009 | 本地配置文件损坏导致启动异常 | Low | `c:\Users\46649\.Perseng\workspaces.json` | JSON 文件无格式校验与自恢复 | 已修复 |

### 10.1 对 OWASP Top 10 的映射

- A01 Broken Access Control：主要体现在工作区文件系统边界、资源目录边界、IPC 调用边界
- A02 Cryptographic Failures：主要体现在 `AgentX apiKey` 明文落盘
- A05 Security Misconfiguration：主要体现在 WebAccess token、cookie、协议白名单与日志暴露
- A08 Software and Data Integrity Failures：主要体现在命令执行链路对输入信任过强
- A09 Security Logging and Monitoring Failures：当前已初步改善，但日志脱敏与链路观测仍需继续加强

### 10.2 尚未彻底制度化的安全工作

- 依赖漏洞扫描结果尚未整理成“版本/CVE/处置状态/升级计划”的正式归档表
- 目前安全修复已落在代码层，但尚未沉淀为 CI 审计 gate
- 缺少统一的“桌面端安全入口清单”与回归策略

## 11. 架构设计与性能洞察

这一部分不只关注“哪里坏了”，更关注“现在的架构在往哪里长、未来会先卡在哪里”。

### 11.1 从架构设计看：当前最大的优点

#### 11.1.1 Monorepo 分层方向是对的

当前仓库已经隐含形成了比较清晰的职责分层：

- `apps/desktop`：Electron 外壳、UI、桌面集成
- `apps/cli`：CLI 入口与运行模式装配
- `packages/runtime`：Agent 运行时、事件总线、环境适配、会话/镜像抽象
- `packages/mcp-server`：MCP 服务能力与 transport 适配
- `packages/core`：历史能力沉淀与通用业务逻辑

这意味着项目并不是“从零散代码堆起来”的，而是已经具备向平台化演进的骨架。

#### 11.1.2 Runtime 的事件驱动设计具备扩展潜力

`RuntimeImpl -> SystemBus -> CommandHandler / Environment / Receptor` 这一套设计，是当前仓库里最有长期价值的部分之一。

优点：

- 命令和事件解耦，后续可以接入更多外部前端或 transport
- Agent 生命周期、Image 生命周期、Session 生命周期有统一抽象
- 为后续监控、录制、回放、审计提供了天然插点

这类结构的正确演进方向，不是推倒重写，而是继续“去中心化单点膨胀”。

### 11.2 从架构设计看：当前最明显的风险

#### 11.2.1 `apps/desktop` 主进程正在形成“超级装配中心”

当前 `apps/desktop/src/main/index.ts`、各 window、若干 service 与 main 进程启动链之间已经承担了大量职责：

- IPC 暴露
- 窗口管理
- WebAccess 服务接入
- AgentX 配置管理
- 工作区/资源/角色能力绑定

这在项目早期是高效的，但随着功能继续增长，会出现两个问题：

- 变更耦合度越来越高，任何一个入口改动都要回归整个主进程
- 安全边界和生命周期边界会逐渐模糊，容易再次出现“一个服务顺便干了几件不该一起干的事”

建议：

- 把主进程逐步收敛为“装配层 + 生命周期协调层”
- 业务能力下沉为模块化 service，并通过显式接口导出
- 把 IPC 注册从“散落式绑定”逐步演化成“按领域分组注册”

#### 11.2.2 `CommandHandler` 已经是 runtime 里的高耦合枢纽

从当前结构看，`CommandHandler` 既做：

- 命令处理
- 错误转换
- Image 生命周期协调
- summarization 前置编排

这在短期内很实用，但长期会带来两个副作用：

- 一个类要理解过多业务上下文
- 新功能更容易继续“顺手塞进来”，形成 second god object

建议：

- 保留 `CommandHandler` 作为总入口
- 但逐步把复杂命令拆成独立 use-case / operation handler
- 特别是 `image_create / image_run / message_send / summarize` 这类核心路径，可以先独立

#### 11.2.3 `packages/core` 是当前最重要的历史包袱

`packages/core` 仍以 JS 为主，并通过 path alias 直接进入其他包的编译/类型检查链路。

这会产生三个长期成本：

- 类型系统无法可靠约束跨包边界
- 启动和构建问题容易表现为“下游包报错，上游根因隐藏”
- 任何需要产出 `.d.ts` 的包，都可能被核心包里的 JS 细节拖累

建议：

- 把 `packages/core` 视为“平台迁移带”，而不是长期稳定基座
- 后续优先提炼出真正稳定的子域，迁到 TS-first 的新包中

### 11.3 从性能看：当前最可能先出问题的地方

#### 11.3.1 主进程同步 IO 与同步命令执行

桌面端主进程里如果继续堆积：

- 文件系统同步访问
- 配置读写
- `execSync`
- 大对象序列化

会优先伤害：

- 冷启动时间
- 窗口首屏交互响应
- Windows 环境下的卡顿感知

尤其 Electron 主进程是“单线程协调核心”，一旦同步阻塞，就不是某个功能慢，而是整个桌面应用“像卡死”。

建议：

- 主进程尽量避免同步型外部调用
- 把耗时工作放到受控后台任务或专门 worker
- 对冷启动链路做阶段性埋点：bootstrap、窗口创建、AgentX 初始化、WebAccess 初始化、workspace 加载

#### 11.3.2 Runtime summarization 是未来的成本热点

`ContextManager` + `SDKQueryLifecycle` 的摘要链路是正确方向，但未来会在两个维度成为热点：

- token 成本
- 创建额外 SDK 子查询的延迟成本

目前已经有 fallback heuristic，这很好；但如果后续 image 规模增长，建议进一步演进：

- 为 summary 结果做结构化缓存
- 把“是否需要摘要”的判断做得更 cheap
- 区分“软摘要”和“强制摘要”
- 把摘要触发点从单一阈值升级为“消息数 + token 估算 + 会话年龄 + 工具输出体积”联合判断

#### 11.3.3 MCP Server 的性能瓶颈不在算法，而在生命周期与隔离策略

`packages/mcp-server` 当前更大的问题不是单次调用慢，而是：

- server 生命周期管理复杂度会上升
- transport 不同实现之间的一致性成本会上升
- 测试覆盖若只停留在接口契约层，会导致真实运行态问题更晚暴露

建议：

- 把性能分析重点放在“启动/连接/关闭/并发执行”的行为时间线
- 为关键 transport 加上：
  - 启动耗时
  - 并发工具执行耗时分位数
  - 错误率
  - 超时率

#### 11.3.4 WebAccess 本质是一个代理服务，未来要小心状态膨胀

当前 `WebAccessService` 已经具备：

- token 鉴权
- 本地 HTTP 服务
- WebSocket 代理
- QR code / URL 生成

从设计上看，它已经不只是“一个小工具服务”，而是“桌面端内嵌的访问网关”。

如果未来继续加：

- 多 container
- 多 token
- 会话续期
- 审计日志

那它就需要从“简单 service”升级为“显式状态机 + 会话模型”的组件。

### 11.4 更好的见树：我认为最值得保留和强化的设计

如果从长期演进看，我认为 Perseng 里最值得继续投资的不是某个单点功能，而是这三棵“树”：

#### 树 1：事件总线驱动的 Runtime

这是未来支持多入口、多前端、多 transport 的核心。

方向：

- 强化事件 schema
- 补足 tracing / metrics / replay
- 控制 `CommandHandler` 的持续膨胀

#### 树 2：Electron 壳 + Runtime 核的边界分离

桌面端真正长期有价值的，不是把所有逻辑放进主进程，而是把 Electron 只作为宿主能力层。

方向：

- 主进程负责 OS 集成
- Runtime 负责 Agent 生命周期
- UI 负责状态展示与交互编排

#### 树 3：MCP 与 Agent 能力的平台化装配

这个方向如果做顺，会形成项目的差异化能力：不是单纯聊天壳，而是可编排的 Agent 平台。

方向：

- 统一 server / tool / resource / prompt 的领域模型
- 强化配置、测试、可观测性
- 从“能运行”进化到“可诊断、可审计、可扩展”

## 12. 架构与工程化优化路线图

### 12.1 近端（1-2 周）

- 将本轮安全修复与类型修复整理成 CI gate
- 为桌面端高风险入口增加最小回归集：
  - IPC 白名单
  - WebAccess 鉴权
  - Workspace 边界
- 为 runtime 增加 summary / MCP bridge / event schema 的回归用例
- 在主进程启动链路补充耗时日志

### 12.2 中期（2-6 周）

- 拆分 `apps/desktop` 主进程的装配职责与业务职责
- 将 `CommandHandler` 中复杂路径拆成独立用例处理器
- 为 `packages/mcp-server` 增加 transport 级集成测试
- 逐步从 `packages/core` 中迁出稳定 TS-first 子模块

### 12.3 中长期（1-3 个月）

- 建立统一运行时观测模型：
  - request trace
  - event trace
  - agent/image/session 生命周期指标
- 为 WebAccess 建立正式的会话模型与状态机
- 推动跨包统一类型出口，减少重复定义与桥接成本
- 把“安全审计 + 回归验证 + 构建检查”固化为发布前必经流程

### 12.4 部署与监控建议

- 桌面端：
  - 记录冷启动阶段耗时
  - 记录窗口首屏可交互时间
  - 记录关键服务初始化失败率
- Runtime：
  - 记录单次 turn 延迟
  - 记录 tool 执行耗时与错误率
  - 记录 summary 触发率、耗时、fallback 比例
- MCP：
  - 记录 server 启动/关闭耗时
  - 记录连接失败重试次数
  - 记录并发执行时的队列积压

## 13. 分模块重构优先级计划

### P0：必须优先推进

- `packages/core`
  - 目标：降低 JS 历史包对全仓类型系统的持续污染
  - 动作：优先迁移最常被下游消费的模块到 TS
- `apps/desktop/src/main`
  - 目标：避免主进程继续膨胀成全能入口
  - 动作：按领域拆 service 注册与 IPC 注册
- `packages/runtime/src/internal/CommandHandler.ts`
  - 目标：避免 runtime 中心编排器持续变重
  - 动作：拆分 image/message/summarization 用例

### P1：高价值但可稍后推进

- `packages/mcp-server`
  - 目标：补齐 transport 级行为覆盖与性能观测
  - 动作：从接口测试扩展到真实启动/连接/关闭测试
- `apps/desktop/src/main/services/WebAccessService.ts`
  - 目标：为未来多会话、多 container、多鉴权策略预留空间
  - 动作：重构为更显式的状态模型

### P2：体验与长期治理项

- 统一日志字段与 trace 语义
- 建立依赖漏洞归档表与处置流程
- 抽象“高风险回归测试集”作为稳定脚本
- 为本地配置损坏增加自动诊断与修复提示
