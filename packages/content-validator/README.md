# @promptx/content-validator

Build-time content contract validator for Perseng DPML resources.

扫描 `packages/resource/resources/` 下所有 `.md` 文件，提取 `@!xxx://id` 形式的资源引用，对照 `packages/resource/dist/registry.json` 校验每条引用是否能解析到具体资源。不可解析的引用会让 CI 失败。

## 用法

### 命令行

```bash
# 默认模式（人眼 review，不 block CI）
pnpm validate:content

# 严格模式（任何 unresolved 退出码 1，用于 CI / pre-push）
pnpm validate:content:strict

# 警告模式：unknown-protocol 降级为 warning（迁移期）
node packages/content-validator/dist/cli.cjs --warn-unknown-protocol

# JSON 输出（CI 解析）
node packages/content-validator/dist/cli.cjs --json
```

### 编程调用

```ts
import { validate, renderText } from '@promptx/content-validator'

const report = await validate({
  rootDir: process.cwd(),
  resourcesDir: 'packages/resource/resources',
  registryPath: 'packages/resource/dist/registry.json',
})

console.log(renderText(report))
if (!report.ok) process.exit(1)
```

## 引用的语法

支持的引用语法（与 `packages/core/src/resource/resourceProtocolParser.js` 同步）：

| 形式 | 语义 |
|------|------|
| `@protocol://path` | DEFAULT 加载 |
| `@!protocol://path` | HOT_LOAD（热加载） |
| `@?protocol://path` | LAZY_LOAD（懒加载） |

`id` 必须满足 `[a-zA-Z0-9_-]+`；路径里的中文标点（如 `，`）会被截断。

## lexer 行为

- 跳过 markdown 单行代码（反引号包裹）
- 跳过 markdown fenced code block（三反引号包裹）
- 跳过 DPML 注释行（`#` 开头）
- 一行内多个引用都会识别

## 报告类别

| kind | 含义 |
|------|------|
| `ok` | registry 中能查到 |
| `syntax-error` | 不符合 `@[!]?[protocol]:[id]` 语法 |
| `unknown-protocol` | protocol 不在 registry（如 `@memory://`、`@http://`） |
| `unknown-id` | protocol 存在但 id 找不到 |
| `parse-error` | 解析抛错（罕见） |

## 退出码

- `0` — 通过
- `1` — `--strict` 模式下有 unresolved
- `2` — 工具自身错误（如 registry 文件读不到）

## CI 集成

`.github/workflows/content-contract.yml` 会在 PR 改了 `packages/resource/resources/**` 时自动跑 `--strict`。
`.husky/pre-push` 在 push 前对 `packages/resource/resources/**` 改动也跑 `--strict`。
