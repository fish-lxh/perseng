# 内容契约 (Content Contract)

> 现状：内容（role / thought / execution / knowledge / tool / manual / skill）之间的关系是**隐式契约**——靠人脑维护，靠 AGENT 临场发挥兜底。Nuwa 案例就是教训：用户问"姜山 / Sean"，AGENT 没有该 role、没有 skill 协议，于是即兴扮演了女娲。
>
> 本文档把这条隐式契约显式化，作为长期维护的工程纲领。**只立 spec，不实现**。实现拆到后续独立 ticket。

---

## 0. 目录

1. [背景与动机](#1-背景与动机)
2. [三大支柱](#2-三大支柱)
3. [支柱 A：协议枚举完整性](#3-支柱-a协议枚举完整性)
4. [支柱 B：引用校验器](#4-支柱-b引用校验器)
5. [支柱 C：AGENT 入口统一](#5-支柱-cagent-入口统一)
6. [里程碑](#6-里程碑)
7. [风险与 FAQ](#7-风险与-faq)

---

## 1. 背景与动机

### 1.1 当前症状（已观察到）

| # | 症状 | 根因 |
|---|------|------|
| 1 | 用户问"姜山 / Sean"，AGENT 即兴扮演"女娲" | 系统内 **没有 `skill` 协议**，action dispatcher 却有 `skill` 操作；role 没有"姜山"，AGENT 走 fallback |
| 2 | 一些角色能识别、一些不能 | `registry` 列表与 dispatcher 操作集合**不对称**（registry 6 个 protocol，dispatcher 7 个 op） |
| 3 | 字体缺失、服务起不来 | 资源文件在打包阶段被遗漏（与本文档正交，但同属"内容契约"的运维面） |

### 1.2 隐式契约的表现

```
DPML:  @!knowledge://promptx-architecture
RolexActionDispatcher.dispatch({ op: 'skill', args: { locator: 'nuwa' } })
registry 中查 'nuwa'    → role 注册 ✓
action dispatcher 操作 'skill' → 无对应 protocol，fallback 即兴
```

代码看不出问题，但运行时塌方。

### 1.3 目标

让以下三类问题在 **CI 跑 lint 时**（即不靠用户、不靠 AGENT、不靠加班）就能被捕获：

1. DPML 引用不存在
2. dispatcher 操作无对应协议
3. AGENT 收到模糊请求时，没有走唯一入口

---

## 2. 三大支柱

| 支柱 | 解决什么 | 谁负责 |
|------|---------|--------|
| **A. 协议枚举** | dispatcher 操作 ⇄ protocol ⇄ registry 必须**穷举且对称** | 开发者写新 op/registry 时强制 |
| **B. 引用校验** | DPML 内的 `@!xxx://id` 引用必须能解析到具体资源 | `pnpm validate:content` + CI |
| **C. 入口统一** | "我以 X 身份工作" 是一条唯一路径 `actAs(id)` | runtime 层封装 |

三支柱的依赖关系：

```
   A 协议枚举
       ↓
   B 引用校验  ── 依赖 A 的协议表
       ↓
   C 入口统一  ── 依赖 A 的协议表 + B 的校验器（运行时也校验）
```

---

## 3. 支柱 A：协议枚举完整性

### 3.1 协议表（v0 草案）

来源：`packages/core/src/resource/resourceManager.js` 的 `initializeProtocols()` + `packages/resource/scripts/generate-registry.js` 的 suffix mapping。

| Protocol | 文件后缀 | 现有 artifact 数 | 操作符映射（dispatcher） | 状态 |
|----------|---------|------------------|--------------------------|------|
| `package` | npm pkg 内任意文件 | n/a | — | 基础 |
| `project` | 项目相对路径 | n/a | — | 基础 |
| `file` | 本地绝对/相对路径 | n/a | — | 基础 |
| `user` | `~/.promptx/` | n/a | — | 基础 |
| `role` | `.role.md` | 5 | `activate` / `deactivate` | 已对齐 |
| `thought` | `.thought.md` | 8 | `thought` | 已对齐 |
| `execution` | `.execution.md` | 15 | `execution` | 已对齐 |
| `knowledge` | `.knowledge.md` | 5 | `knowledge` | 已对齐 |
| `tool` | `.tool.js` | 1 | `tool` | 已对齐 |
| `manual` | `.manual.md` | 1 | `manual` | 已对齐 |
| **`skill`** | `.skill.md` | **0** | **`skill` (未实现 protocol，但 dispatcher 已调用)** | ❌ 必修 |

**关键缺口**：
- `skill` 是 `RolexActionDispatcher` 第 59 行已声明的操作（`bridge.skill(args.locator)`），但 `ResourceManager` 没注册 `SkillProtocol`，registry 也无 skill 条目。
- 任何 `@!skill://xxx` 引用当前会在 parser 抛错或 runtime 走到 fallback。

### 3.2 完整性规则（**硬约束**）

> **RULE A.1**：对每个 `RolexActionDispatcher.DispatchOperation`，必须存在一个同名或一一映射的 `Protocol` 注册，且 registry 中该 protocol 至少有 1 个 entry（除被设计为"动态生成"且有 tsdoc 标注的外）。

> **RULE A.2**：每个协议注册的 `Protocol` 实现，必须（a）有 `validateContent()` 对加载内容自检、（b）有 `canResolve(id)` 在解析前先问询、（c）通过 `ResourceRegistry.listIdsByProtocol()` 暴露 ID 列表。

### 3.3 完整性的机器可验证形式

新提案：

- 在 `packages/core/src/rolex/RolexActionDispatcher.ts` 旁引入 `protocol-table.ts`：
  - 静态枚举 `PROTOCOL_TABLE: { [op: string]: ProtocolConstructor }`
  - 启动时断言 `RolexActionDispatcher.OPERATIONS ⊆ PROTOCOL_TABLE.keys`，反之亦然
- 单元测试 `expect(ops).toEqual(protocols)` 单向收敛失败，给出"补 protocol"或"摘 op"的修复选项

### 3.4 待补协议草案

| 新增 | 用途 | 文件后缀 | 内容骨架 |
|------|------|---------|---------|
| `skill` | 角色技能（专项能力片段） | `.skill.md` | `<skill>\n<name/><description/><script/>\n</skill>` |
| `mind` | 思维模式（已并入 thought，**不再单列**） | — | — |
| `persona` | 角色人格补充（供 Nuwa 类文化角色使用） | `.persona.md` | `<persona>\n<style/><voice/><taboos/>\n</persona>` |

> 注：`persona` 当前在 Nuwa role 内联表达。独立成 protocol 后，可在多角色间复用"姜山"风格。

---

## 4. 支柱 B：引用校验器

### 4.1 职责

给"DPML 文本 + registry"做一次一致性体检，**构建期执行**。输入两类错误：

1. **句法错误**：`@!???://foo:bar` 不在语法白名单
2. **解析错误**：`@!role://jiang-shan` registry 不存在

输出人类可读报告 + 机器可读 JSON（CI 用）。

### 4.2 校验流水线

```
$ pnpm exec perseng validate:content

[1/4] lexer:   packages/resource/resources/**/*.md  →  AST
[2/4] extract: AST.resources[].refs[]                →  RefList
[3/4] resolve: RefList × registry                    →  ResolvedReport
[4/4] report:  unresolved / wrong-protocol / orphan   →  stdout + reports/content-validate.json
```

### 4.3 引用提取（结构）

```ts
type Ref = {
  raw: '@!role://nuwa'
  protocol: 'role'         // or 'unknown'
  loadingSemantic: 'HOT'   // @  / @!  / @?
  id: 'nuwa'
  source: { file: string, line: number }
}

type ResolveResult =
  | { kind: 'ok', protocol: 'role', entry: RegistryEntry }
  | { kind: 'unknown-protocol', registered: string[] }
  | { kind: 'unknown-id', protocolExists: true, availableIds: string[] }
```

### 4.4 报告样例

```
✗ 12 unresolved references

packages/resource/resources/role/nuwa/nuwa.role.md:50
  @!knowledge://perseng-architecture  →  UNKNOWN PROTOCOL
  protocols available:  role, thought, execution, knowledge, tool, manual

packages/resource/resources/tool/filesystem/filesystem.tool.md:3
  @!thought://design                   →  OK
  @!role://nuwa                        →  OK
  @!execution://filesystem-mkdir       →  OK
```

### 4.5 CI 集成

- `pnpm validate:content --strict` 任何 unresolved 退出码 ≠ 0
- `pnpm validate:content --warn-unknown-protocol` 警告但通过（迁移期）
- Husky pre-push 钩跑 `validate:content`（仅对修改了 `resources/**/*.md` 的 commit）
- GitHub Actions：每次 PR 必跑，结果贴在 PR 评论区

### 4.6 已存在的零散校验（不要重写）

| 已存在 | 位置 | 本 validator 如何融合 |
|--------|------|----------------------|
| `ManualProtocol.validateManualContent()` | `packages/core/src/resource/protocols/ManualProtocol.js:70` | 复用，作为 per-protocol 内容校验勾子 |
| `ToolProtocol.validateToolContent()` | `packages/core/src/resource/protocols/ToolProtocol.js:62` | 复用 |
| 协议内的 `validatePath()` | 各 `*Protocol.js` | 复用为 `canResolve(id)` |
| registry 生成脚本 | `packages/resource/scripts/generate-registry.js` | validator 调它生成 registry 快照，避免 race |

---

## 5. 支柱 C：AGENT 入口统一

### 5.1 现状（散点）

| 入口 | 文件 | 行为 |
|------|------|------|
| MCP `action` 工具 | `packages/mcp-server/src/tools/action.ts` | V2 走 `RolexActionDispatcher` |
| MCP `lifecycle` 工具 | `.../lifecycle.ts` | `rolex` ops |
| MCP `learning` 工具 | `.../learning.ts` | `rolex` ops |
| MCP `organization` 工具 | `.../organization.ts` | `rolex` ops |
| Feishu bot | `packages/feishu-desktop/src/manager.ts` | 自己挑角色（默认 `Perseng`） |
| Desktop UI | `apps/desktop/src/renderer/.../RoleX/...` | 用户手动选择 |
| CLI | `perseng action <roleId>` | 直接传字符串，没问询 registry |

**问题**：

1. 每个入口都得重复一遍"找不到就 fallback"的逻辑（→ Nuwa 现象）
2. 角色、skill、persona 三类身份混在一个 `string` 参数里，调用方搞不清自己激活的是哪种
3. 错误处理各自为政

### 5.2 提案：`actAs(id, opts?)` 统一接口

```ts
interface ActAsOptions {
  scope?: 'session' | 'task' | 'conversation'   // 默认 'session'
  attach?: { knowledge?: string[]; skill?: string[]; persona?: string[] }
  fallback?: 'throw' | 'prompt' | 'reject'      // 默认 'throw'
}

interface ActAsResult {
  kind: 'role' | 'skill' | 'persona'
  identity: { id: string; name: string }
  attachedRefs: ResolvedAttachment[]
  warnings: string[]
}

async function actAs(id: string, opts?: ActAsOptions): Promise<ActAsResult>
```

### 5.3 内部 dispatch 表

```
actAs('jiang-shan')

  1. 协议询问：registry.listIdsByProtocol('role')
                   是否包含 'jiang-shan'? 否
  2. 协议询问：registry.listIdsByProtocol('skill')
                   是否包含 'jiang-shan'? 否
  3. 协议询问：registry.listIdsByProtocol('persona')
                   是否包含 'jiang-shan'? 否
  4. opts.fallback === 'throw'  → 抛 ContentContractViolation
     opts.fallback === 'reject' → 抛 NotFound 给上层（CLI 退出 / IPC 返回）
     opts.fallback === 'prompt' → 走"请选择..."对话流（仅 UI 入口支持）
```

注意：**`actAs` 永不**自己"扮演"任何角色——fallback 只在显式 opts 控制下拒绝或询问，**绝不**即兴创作（这是根治 Nuwa 现象的不变量）。

### 5.4 各入口改造后映射

| 原入口 | 改造后 |
|--------|--------|
| MCP `action { op: 'activate', roleId }` | `actAs(roleId, { scope: 'session' })` |
| MCP `action { op: 'skill', args: { locator } }` | `actAs(locator, { scope: 'task', fallback: 'throw' })` |
| Feishu 默认 `Perseng` | 启动时 `actAs('perseng', { fallback: 'reject' })`；缺则报错给运营 |
| Desktop RoleX 选择 | UI 列出 `registry.listIdsByProtocol('role') + 'skill' + 'persona'` 三组合并 |
| CLI `perseng action <roleId>` | `actAs(roleId, { fallback: 'throw' })` |

### 5.5 不变量（必须由测试守住）

| # | 不变量 | 失败模式 |
|---|--------|----------|
| I-1 | `actAs` 对未注册 id 默认抛错，永不返回"假身份"对象 | Nuwa 现象复发 |
| I-2 | `actAs(roleId)` 后 systemPrompt、tool 白名单、memory 全部来自 registry；不改写、不补全 | 漂移 |
| I-3 | 同一 session 重复 `actAs(roleId)` 幂等，返回同一 `identity` | 状态机抖动 |
| I-4 | `actAs(skillId)` 必须有一个当前 role（否则抛 NoActiveRole） | 孤儿技能 |
| I-5 | 任何入口调用 `actAs` 前先调用 `validate:content` 缓存，避免 race | 引用抖动 |

---

## 6. 里程碑

> 仅 spec 文档，**下列 M1–M4 不在本工单范围**。

| # | 标题 | 依赖 | 估时 | 出口标准 |
|---|------|------|------|----------|
| M0 | **本 spec 落盘** | — | — | 本文件 review-pass |
| M1 | 添加 `skill` / `persona` 两个 protocol + registry 模板 | A | 3d | registry 包含 ≥3 skill / ≥1 persona，nuwa 角色迁移到使用 `skill://story-weaving` |
| M2 | `pnpm validate:content` 工具 + CI | M1 | 3d | `pnpm validate:content --strict` 现有资源 0 报错；CI 集成；pre-push 钩 |
| M3 | `actAs(id, opts?)` 落地 | M2 | 5d | 6 个入口全部走 `actAs`；不变量 I-1~I-5 有测试覆盖 |
| M4 | 文档：开发者写新 role / skill 流程 | M3 | 1d | `docs/role-authoring.md` + examples |

---

## 7. 风险与 FAQ

**Q：为什么不一步到位直接上 `actAs`？**
A：现在 6 个入口的 fallback 行为各异，不先建协议表和引用校验，`actAs` 落地后会"看上去好了"但漏报依旧。

**Q：validator 会不会因为旧资源的临时错误把 CI 红成一片？**
A：M2 阶段开 `--warn-unknown-protocol` 模式，先 warnings 通过；M3 才升级到 `--strict`。每个 milestone 切换 gate 单独做 PR。

**Q：`persona` 协议会不会和 `role` 重复？**
A：role 是身份（决定 systemPrompt + 工具白名单 + 默认行为），persona 是语言风格补充（不影响白名单，可叠加）。两者非互斥，可同时激活。

**Q：MCP action tool 的 V1 路径怎么办？**
A：V1 走 CLI `perseng action <id>`，本工单要求 CLI 也走 `actAs`。V1 的字符串解析仍然向后兼容，但 fallback 强制 throw（不再"勉强扮演"）。

**Q：会不会影响产品功能？**
A：现状是"沉默地假装工作"。契约化后，不存在就说"不存在"。短期有用户需要重新创建角色，长期收益是杜绝"角色识别偶发性失败"。

---

## 附录 A：相关文件清单

| 文件 | 角色 |
|------|------|
| `packages/core/src/resource/resourceManager.js` | 协议注册中心 (修改点) |
| `packages/core/src/resource/resourceProtocolParser.js` | lexer (validator 直接调) |
| `packages/core/src/resource/protocols/*.js` | 协议实现 (validator 扩展点) |
| `packages/core/src/rolex/RolexActionDispatcher.ts` | dispatcher 操作表 (A 支柱 source of truth) |
| `packages/resource/package.registry.json` | 静态注册 (validator 输入) |
| `packages/resource/scripts/generate-registry.js` | registry 生成 (validator 子调用) |
| `packages/mcp-server/src/tools/{action,lifecycle,learning,organization}.ts` | 6 个 MCP 入口 (C 支柱替换目标) |
| `packages/feishu-desktop/src/manager.ts` | 飞书入口 (C 支柱替换目标) |
| `apps/desktop/src/renderer/.../RoleX/...` | 桌面 UI 入口 (C 支柱替换目标) |
| `docs/technical-audit-2026-07-07.md` | 历史审计 (交叉参考) |

## 附录 B：术语

| 术语 | 含义 |
|------|------|
| **DPML** | Deepractice Prompt Markup Language，`.role.md` / `.thought.md` 内的标签 + 引用语法 |
| **Protocol** | 一种 URI scheme（`role://` / `knowledge://` 等）+ resolver + 内容校验器 |
| **Resource** | 一种持久化在磁盘或 npm 包内的 DPML 内容，protocol 解析得到 |
| **Registry** | 静态化的资源 ID 列表（`package.registry.json`），按 protocol 索引 |
| **actAs** | "以 X 身份工作"的统一动作，是 dispatcher 的人类友好面 |

---

**最后修订**：2026-07-10（spec only, no code）
