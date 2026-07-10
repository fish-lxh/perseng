# Role Authoring Guide

> 内容契约 (Content Contract) 的开发者落地手册。
>
> 配套文档：[docs/content-contract.md](./content-contract.md) — 内容契约的三大支柱（角色 / 引用 / actAs）和四个里程碑（M1~M4）的完整说明。

## 0. 阅读对象

写新角色 / 技能 / 人格 / 知识 / 思想的开发者，以及审 DPML 资源 PR 的 reviewer。

读完本文档你应该能：

1. 知道 11 种资源协议各自适用什么场景
2. 在新角色文件里正确写 `@!skill://` `@!persona://` 等引用
3. 在本地用 `pnpm validate:content` 验证自己写的资源合法
4. 理解 6 个激活入口（`action` MCP、lifecycle、learning、organization、CLI、Feishu）如何校验

---

## 1. 协议表

每个 DPML 资源都是一个 `.md` 文件，存在 `packages/resource/resources/<protocol>/<id>/` 下。

| Protocol | 文件后缀 | 用途 | 例子 |
|----------|----------|------|------|
| `role` | `.role.md` | 角色身份（系统提示主入口） | `nuwa.role.md` |
| `persona` | `.persona.md` | 人格风格（语气 / 禁忌） | `nuwa.persona.md` |
| `skill` | `.skill.md` | 可调用的能力（步骤式） | `story-weaving.skill.md` |
| `thought` | `.thought.md` | 思维方式 / 心法 | `contradiction.thought.md` |
| `execution` | `.execution.md` | 执行流程 / SOP | `decision.execution.md` |
| `knowledge` | `.knowledge.md` | 领域知识 | `dpml-spec.knowledge.md` |
| `tool` | `.tool.md` | 工具定义（ToolX） | `calculator.tool.md` |
| `manual` | `.manual.md` | 工具使用手册 | — |
| `package` | n/a | 文件系统映射 | `@package://...` |
| `project` | n/a | 项目级映射 | `@project://...` |
| `user` | n/a | 用户级映射 | `@user://...` |
| `file` | n/a | 通用文件 | `@file://...` |

`role` / `persona` / `skill` 是 M1 新加的；其余 9 种沿用历史。

---

## 2. 引用语法

在任意 DPML 文件里，你可以通过以下三种 loading semantic 引用其他资源：

| 形式 | 语义 | 何时用 |
|------|------|--------|
| `@protocol://path` | DEFAULT（默认） | 大多数情况，加载时按需解析 |
| `@!protocol://path` | HOT_LOAD | 必须立刻拿到内容（如 persona / skill 这种激活时就需要注入的） |
| `@?protocol://path` | LAZY_LOAD | 真正用到才加载（大段知识） |

约束：

- `protocol` 必须是小写字母开头
- `path` 满足 `[a-zA-Z0-9_-]+`，**不带中文标点**（如 `@tool://foo，bar` 应写成 `@tool://foo` 然后单独说明）
- **不能在 markdown 代码块内**被识别为引用（lexer 会跳过三反引号 / 单反引号 / `<thought-stem>` 占位符）
- 引用必须存在于 `dist/registry.json`，否则 `pnpm validate:content --strict` 会失败

---

## 3. 新建一个 role 的完整步骤

### 步骤 1：写 .role.md

```bash
# 假设新建角色 my-role
$EDITOR packages/resource/resources/role/my-role/my-role.role.md
```

模板（参考 `nuwa.role.md`）：

```xml
<role>
  <personality>
    你是 <name>（<id>），<一句话定位>。

    **背景**：...
    **专长**：...
    **对话风格**：...

    人格风格：见 @!persona://my-role
    执行能力：见 @!skill://dpml-composition
  </personality>

  <principle>
    @!execution://decision
  </principle>

  <knowledge>
    @!knowledge://my-role
  </knowledge>
</role>
```

### 步骤 2：补齐引用到的资源

如果你的 role 用了 `@!persona://my-role`，那就新建 `packages/resource/resources/persona/my-role/my-role.persona.md`。否则 validator 会报 unknown-id。

`persona` 文件骨架：

```xml
<persona>
  <voice>...</voice>
  <style>...</style>
  <taboos>...</taboos>
  <example>...</example>
</persona>
```

`skill` 文件骨架：

```xml
<skill>
  <name>...</name>
  <description>...</description>
  <triggers>...</triggers>
  <steps>...</steps>
  <voice>...</voice>
  <anti-patterns>...</anti-patterns>
  <example>...</example>
</skill>
```

### 步骤 3：本地校验

```bash
pnpm validate:content:strict
```

期望输出：

```
✅ All references resolve correctly.
```

如果看到 `unknown-id`，检查：

1. 引用 `protocol://id` 的 id 是否和文件名（去掉 `.xxx.md`）一致
2. 文件是不是放在 `packages/resource/resources/<protocol>/<id>/` 正确目录

如果看到 `unknown-protocol`，说明你用了一个不在 11 种协议表里的 protocol（如 `@memory://`、`@http://`），这通常意味着设计错误 — 引用协议只能从 §1 的表里选。

### 步骤 4：注册到 registry

`packages/resource/dist/registry.json` 是构建产物。改完资源后跑：

```bash
node packages/resource/scripts/generate-registry.js
```

CI（`.github/workflows/content-contract.yml`）会自动化跑这一步。

### 步骤 5：本地试激活

```bash
node apps/cli/dist/promptx.js action my-role
```

期望输出 RoleLayer，包含 personality / principle / knowledge 渲染。

如果失败，检查：

- 引用是否都解析了（运行 `pnpm validate:content:strict`）
- `<role>` 标签结构是否完整（必须包含 personality，可选 principle / knowledge）

### 步骤 6：CI 通过后合入

PR 通过 `.github/workflows/content-contract.yml` 的 strict 校验 + 项目 lint 后即可合入。pre-push 也会拦截引用错误。

---

## 4. 完整示例 1：从零写一个 `character-improvisation.skill.md`

场景：女娲做角色设计，需要"角色即兴"技能。已知 M1 已加 `skill` 协议。

```bash
mkdir -p packages/resource/resources/skill/character-improvisation
$EDITOR packages/resource/resources/skill/character-improvisation/character-improvisation.skill.md
```

文件内容（实际代码示例，已在 M1 提交）：

```xml
<skill>
  <name>character-improvisation</name>
  <description>在已有角色档案基础上做轻量级即兴补全，用于对话中"小动作"层级的发挥。</description>

  <triggers>
    - 角色档案缺失某一维度（如"饮食习惯"）但场景需要
    - 用户问"如果是你，你会怎么做"
    - 同质化场景（重复出现的日常对话）
  </triggers>

  <steps>
    <step>读当前 role 的 persona / knowledge，确认已有档案维度</step>
    <step>挑一个未覆盖维度（如"周末习惯"）</step>
    <step>在 voice / style 风格边界内写一段简短补全（1-3 句）</step>
    <step>明确标注是"即兴"，避免与档案知识混淆</step>
  </steps>

  <voice>延续 persona 的语气</voice>

  <anti-patterns>
    <anti-pattern>不要即兴角色核心身份 / 立场 / 价值观</anti-pattern>
    <anti-pattern>不要补全未在册档案的关键事实（如新作品、新合作）</anti-pattern>
  </anti-patterns>

  <invariant>最关键约束：当角色没有对应的身份档案时，禁止即兴。</invariant>

  <example>
    用户："你周末通常做什么？"
    角色档案 personality 有"工作狂"标签，无"周末"维度。
    即兴：避免编造具体地点；可以补充"工作狂"风格的延伸（如"周末通常也在想产品"）。
  </example>
</skill>
```

然后在 nuwa.role.md 引用：

```xml
<role>
  <personality>
    ...
    执行能力：见 @!skill://character-improvisation
  </personality>
</role>
```

跑 `pnpm validate:content:strict` 应该绿。

---

## 5. 完整示例 2：从 Nuwa 即兴扮演 bug 反向构造 actAs 兜底

历史 bug：MCP `action` 工具在用户问 "扮演姜山" 时返回成功（role info 已落 StateArea），AI 客户端把 error 文本当成 tool result，触发"即兴扮演"。

M3 的根因修复链路：

### 入口层（action.ts MCP）

```ts
async function activateV1(args) {
  try {
    await actAs(args.role, { fallback: 'throw' })  // 1. 强制校验
  } catch (e) {
    return outputAdapter.convertToMCPFormat({     // 2. 失败 → MCP error
      type: 'error',
      content: `❌ 角色 '${args.role}' 不存在`,
    })
  }
  await cli.execute('action', [args.role])         // 3. 校验通过才走底层
}
```

### 根因层（ActionCommand.getRoleInfo）

```ts
async getRoleInfo(roleId) {
  const result = await this.resourceManager.loadResource(`@role://${roleId}`)
  if (!result || !result.success) {
    const available = this._safeListRoleIds()
    throw new RoleNotFoundError(roleId, available)  // 不再 return null
  }
  ...
}
```

### 不变量测试（actAs.test.ts）

```ts
it('I-1: actAs("jiang-shan-totally-fake") 抛 ActAsError', async () => {
  await expect(actAs('jiang-shan-totally-fake')).rejects.toMatchObject({
    code: 'ACTAS_NOT_FOUND',
  })
})
```

把这三层组合起来：

- 入口层把 `actAs` 失败转成 MCP `isError: true` → AI 客户端不再把错误文本当 tool result
- 根因层让 ActionCommand 不再"沉默地渲染错误 StateArea" → 即使绕过 MCP 层，CLI 用户也会看到显式错误
- 不变量测试防回归 → 任何 PR 把 actAs 改回"返回假身份"都会立即失败

---

## 6. 引用规则速查

| 错误 | 正确写法 | 说明 |
|------|---------|------|
| `@!role://姜山` | `@!role://jiang-shan` | id 必须 ASCII |
| `@tool://calc, mode=x` | `@tool://calc` + 在注释里说明 mode | id 后无标点 |
| 在反引号内写 `@!skill://foo` | 写裸引用 | markdown 代码块内不解析 |
| `@memory://foo` | `@knowledge://foo` | protocol 必须在 11 种表里 |
| `@role://nuwa` `@!role://nuwa` | 选一种 | 同一行多引用 OK |
| `<thought-stem>@skill://foo</thought-stem>` | 把 `<thought-stem>` 用反引号包起来 | 占位符内不解析 |

---

## 7. 常见问题

**Q：validator 报 `unknown-id`，但 id 看着没问题？**

A：检查文件后缀。`.role.md` / `.skill.md` / `.persona.md` 必须严格匹配（大小写敏感）。`generate-registry.js` 的 suffix 映射决定哪个 id 进哪个 protocol。

**Q：role 文件里写了一大段中文，validator 报 "syntax-error"？**

A：DPML 文件里大部分正文是 free text，validator 只对 `@xxx://id` 模式敏感。如果某行报错，把那行包到反引号里再看是不是误识别。

**Q：可以引用一个还没写好的 .skill.md 吗？**

A：可以，但 `pnpm validate:content:strict` 会失败。建议在 PR 里把 skill 文件和引用一起提交。

**Q：actAs 报 ACTAS_NOT_FOUND，但 role 文件确实存在？**

A：跑一次 `node packages/resource/scripts/generate-registry.js` 重新生成 dist/registry.json，可能 cache 没刷新。

---

## 8. 相关链接

- [docs/content-contract.md](./content-contract.md) — 内容契约规格
- [packages/content-validator/README.md](../packages/content-validator/README.md) — validator 工具用法
- [packages/core/src/actAs.ts](../packages/core/src/actAs.ts) — actAs 实现 + 错误码常量
- [packages/core/src/__tests__/actAs.test.ts](../packages/core/src/__tests__/actAs.test.ts) — 5 不变量测试
- [.github/workflows/content-contract.yml](../.github/workflows/content-contract.yml) — CI 流水线

---

## 9. 维护

修改本文档时同步更新：

- 协议表（§1）变化 → 同步 `packages/core/src/resource/protocols/`
- 引用语法（§2）变化 → 同步 `packages/core/src/resource/resourceProtocolParser.js`
- 新建 role 的步骤（§3）变化 → 同步本文件 + 在 `packages/resource/README.md`（如有）加索引