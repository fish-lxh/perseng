# V2 角色（RoleX）使用指南

> 本文档说明 V1（DPML）与 V2（RoleX）角色的差异，以及如何通过 MCP `action` 工具创建和激活 V2 角色。
>
> 修复背景：Bug 6 — V2 工具的 inputSchema 错误地把 `role` 设为必填，导致 `born` 等不需要 `role` 的操作被 MCP 客户端 schema 校验拦截，V2 生态实质不可用。本文档配合 schema 修复同步发布。

## 一、V1 vs V2 总览

| 维度 | V1（DPML） | V2（RoleX） |
|---|---|---|
| 定位 | 预定义角色配置 | 生命周期管理的角色 |
| 激活 | `action({ role: "name" })` | `action({ operation: "activate", role: "name" })` |
| 创建 | 仅预定义 | `action({ operation: "born", name, source })` |
| 配套工具 | recall / remember | + lifecycle / learning / organization |
| 认知记忆 | 角色配置内 | 完整认知循环（reflect → realize → master） |
| 目标任务 | 不支持 | lifecycle（want → plan → todo → finish → achieve） |
| 组织管理 | 不支持 | organization（found / hire / appoint …） |

## 二、激活方式差异

### V1 角色

直接传 role ID，`operation` 默认为 `activate`：

```json
{ "role": "luban" }
```

### V2 角色

两种方式：

1. **自动检测（推荐）**：V2 优先，找不到则回退 V1

   ```json
   { "role": "my-v2-role" }
   ```

2. **显式 activate**：

   ```json
   { "operation": "activate", "role": "my-v2-role" }
   ```

### 强制指定版本

```json
{ "role": "nuwa", "version": "v1" }
{ "role": "my-v2-role", "version": "v2" }
```

## 三、创建 V2 角色（born）

V2 角色通过 `born` 操作创建，使用 Gherkin Feature 格式定义角色语义：

```json
{
  "operation": "born",
  "name": "my-developer",
  "source": "Feature: Developer\n  As a senior developer\n  I want to write clean code\n  So that the team can maintain it"
}
```

参数说明：

| 参数 | 必填 | 说明 |
|---|---|---|
| `operation` | 是 | `"born"` |
| `name` | 是 | 新角色 ID |
| `source` | 是 | Gherkin Feature 格式的角色定义 |
| `archiveV1` | 否 | 迁移完成后自动归档的 V1 角色 ID 列表 |

> ⚠️ **重要**：`born` 操作**不需要** `role` 参数。`name` 即新角色的 ID。
>
> 旧版本曾因 schema 强制 `role` 必填，导致必须传魔法值 `"role": "_"` 才能调用 born。该缺陷已修复（Bug 6），现在直接传 `name` + `source` 即可。

### V1 → V2 迁移

创建 V2 角色后，可用 `archiveV1` 自动归档对应的旧 V1 角色：

```json
{
  "operation": "born",
  "name": "product-manager",
  "source": "Feature: ...",
  "archiveV1": ["old-pm-role"]
}
```

## 四、operation 速查表

### `action` 工具

| operation | 必填参数 | 说明 |
|---|---|---|
| `activate`（默认） | `role` | 激活角色（V1/V2 自动检测） |
| `born` | `name`, `source` | 创建 V2 角色 |
| `identity` | `role` | 查看角色信息 |
| `archive` | `roleIds` | 归档角色（批量，可恢复） |
| `unarchive` | `roleIds` | 恢复归档角色 |
| `delete` | `roleIds` | 物理删除（`force: true` 绕过系统角色保护） |

### `lifecycle` 工具（仅 V2）

目标与任务管理，工作流：`want` → `plan` → `todo` → `finish` → `achieve`

| operation | 必填参数 |
|---|---|
| `want` | `name`, `source` |
| `plan` | `source`, `id` |
| `todo` | `name`, `source` |
| `finish` | `name` |
| `achieve` | `experience` |
| `focus` | `name` |

### `learning` 工具（仅 V2）

认知循环：`reflect` → `realize` → `master` → `synthesize`

| operation | 必填参数 |
|---|---|
| `reflect` | `encounters`, `experience` |
| `realize` | `experiences`, `principle` |
| `master` | `procedure` |
| `synthesize` | `role`（目标角色）, `name`, `source` |
| `forget` | `nodeId` |
| `skill` | `locator` |

### `organization` 工具（仅 V2）

组织 / 职位 / 人员管理：`found` / `charter` / `establish` / `hire` / `appoint` / `retire` …

## 五、常见问题

**Q：调用 `born` 报错 "role is required"？**
A：这是 Bug 6 的旧症状。`born` 不需要 `role`，只需 `name` + `source`。升级到修复版本后即可正常调用。若仍报错，确认 MCP server 已重启加载新 schema。

**Q：如何查看可用角色？**
A：使用 `discover` 工具列出所有角色（含 V1 与 V2）。

**Q：V1 角色能用 lifecycle / learning / organization 吗？**
A：不能。这三个工具仅支持 V2 角色。V1 角色用 `recall` / `remember` 管理知识。若需使用 V2 工具，先通过 `born` 创建对应的 V2 角色。

**Q：`role` 参数什么时候可以省略？**
A：对于 `lifecycle` / `learning` / `organization` 工具，`role` 可省略——省略时自动使用当前已激活的角色。对于 `action` 的 `activate` / `identity` 操作，`role` 仍需提供；`born` / `archive` / `unarchive` / `delete` 则不需要（它们用 `name` 或 `roleIds`）。
