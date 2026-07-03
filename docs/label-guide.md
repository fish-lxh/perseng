# 🏷️ Perseng 标签使用指南

> 本文档描述 Perseng 项目的标签体系和使用规范

## 📐 核心规则

- **`/` 斜杠** = 动作标签（触发工作流）
- **`:` 冒号** = 信息标签（分类和追踪）

## 🎯 动作标签（会触发自动化）

### changeset/* - 版本管理
| 标签 | 作用 | 使用时机 |
|------|------|----------|
| `changeset/patch` | 创建 patch 版本 changeset | Bug 修复 |
| `changeset/minor` | 创建 minor 版本 changeset | 新功能 |
| `changeset/major` | 创建 major 版本 changeset | 破坏性变更 |
| `changeset/none` | 不需要 changeset | 文档、测试等不影响版本的改动 |

### publish/* - 发布控制
| 标签 | 作用 | 使用时机 |
|------|------|----------|
| `publish/dev` | 合并后自动发布到 dev | 开发版本快速迭代 |
| `publish/alpha` | 合并后自动发布到 alpha | 内部测试版本 |
| `publish/beta` | 合并后自动发布到 beta | 公开测试版本 |
| `publish/latest` | 合并后自动发布到 latest | 稳定版本发布 |
| `publish/hold` | 合并后不自动发布 | 需要等待其他 PR 一起发布 |

### test/* - 测试策略
| 标签 | 作用 | 使用时机 |
|------|------|----------|
| `test/skip-unit` | 跳过单元测试 | 纯文档改动 |
| `test/skip-integration` | 跳过集成测试 | 独立功能改动 |
| `test/skip-e2e` | 跳过 E2E 测试 | 小改动或紧急修复 |
| `test/extended` | 运行扩展测试套件 | 重要功能或架构改动 |
| `test/performance` | 运行性能测试 | 性能相关改动 |

### merge/* - 合并策略
| 标签 | 作用 | 使用时机 |
|------|------|----------|
| `merge/squash` | 使用 squash 合并 | 多个小提交需要合并为一个 |
| `merge/rebase` | 使用 rebase 合并 | 保持线性历史 |
| `merge/auto` | 测试通过后自动合并 | 简单改动或已充分讨论 |

## 📊 信息标签（分类和状态）

### type: - PR/Issue 类型
| 标签 | 含义 | 分支前缀 |
|------|------|----------|
| `type: feature` | 新功能 | feature/* |
| `type: fix` | Bug 修复 | fix/* |
| `type: docs` | 文档改进 | doc/* |
| `type: refactor` | 代码重构 | refactor/* |
| `type: test` | 测试改进 | test/* |
| `type: chore` | 构建/工具链改动 | chore/* |
| `type: style` | 代码风格调整 | style/* |
| `type: perf` | 性能优化 | perf/* |

### status: - PR 状态
| 标签 | 含义 | 说明 |
|------|------|------|
| `status: wip` | 开发中 | 还在开发，请勿合并 |
| `status: ready` | 准备审查 | 开发完成，等待审查 |
| `status: in-review` | 审查中 | 正在进行代码审查 |
| `status: approved` | 已批准 | 审查通过，可以合并 |
| `status: blocked` | 被阻塞 | 等待其他 PR 或外部依赖 |

### priority: - 优先级
| 标签 | 含义 | 响应时间 |
|------|------|----------|
| `priority: critical` | 紧急 | 立即处理 |
| `priority: high` | 高 | 24 小时内 |
| `priority: medium` | 中 | 本周内 |
| `priority: low` | 低 | 有空处理 |

### release: - 版本计划
| 标签 | 含义 | 说明 |
|------|------|------|
| `release` | 发布相关 | 通用发布标记 |
| `release: alpha` | Alpha 版本 | 计划在 alpha 版本包含 |
| `release: beta` | Beta 版本 | 计划在 beta 版本包含 |
| `release: stable` | 稳定版本 | 计划在稳定版本包含 |

### 其他通用标签
| 标签 | 含义 | 使用场景 |
|------|------|----------|
| `breaking` | 破坏性变更 | API 或行为的不兼容改动 |
| `bug` | Bug | Issue 报告的问题 |
| `enhancement` | 改进 | Issue 提出的改进建议 |
| `good first issue` | 新手友好 | 适合新贡献者 |
| `help wanted` | 需要帮助 | 需要社区协助 |
| `duplicate` | 重复 | 与已有 Issue/PR 重复 |
| `invalid` | 无效 | 不符合要求或无法重现 |
| `wontfix` | 不修复 | 决定不处理 |

## 🔄 典型工作流程

### 1. 开发者创建 PR
```
创建 PR → 自动添加 type: 标签（基于分支名）
```

### 2. 审查者添加动作标签
```
添加 changeset/minor → 自动创建 changeset 文件
添加 test/extended → 运行额外测试
添加 merge/auto → 启用自动合并
```

### 3. 合并和发布
```
PR 合并 → 检查 publish/* 标签 → 自动发布到对应渠道
```

## 💡 最佳实践

1. **一个 PR 一个 type**：每个 PR 只做一种类型的改动
2. **尽早添加 status 标签**：让其他人了解 PR 状态
3. **changeset 和 publish 配合使用**：
   - 开发阶段：`changeset/minor` + `publish/dev`
   - 测试阶段：`changeset/patch` + `publish/alpha`
   - 发布阶段：`changeset/minor` + `publish/latest`
4. **优先使用自动化**：让工作流自动处理重复任务

## 🚀 快速参考

### 常见组合
- 新功能开发：`type: feature` + `changeset/minor` + `publish/dev`
- Bug 修复：`type: fix` + `changeset/patch` + `publish/alpha`
- 文档更新：`type: docs` + `changeset/none`
- 紧急修复：`type: fix` + `priority: critical` + `merge/auto`

### 谁负责添加？
- **type:** - 开发者创建 PR 时添加（或自动识别）
- **changeset/** - 审查者根据影响范围决定
- **publish/** - 审查者根据发布计划决定
- **status:** - PR 作者和审查者共同维护
- **priority:** - 项目维护者设置

---

*最后更新：2025-01-06*