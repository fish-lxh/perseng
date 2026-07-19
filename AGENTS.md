<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **perseng** (13166 symbols, 26669 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/perseng/context` | Codebase overview, check index freshness |
| `gitnexus://repo/perseng/clusters` | All functional areas |
| `gitnexus://repo/perseng/processes` | All execution flows |
| `gitnexus://repo/perseng/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Active Workstreams

| Stream | Status | Owner doc |
|--------|--------|-----------|
| **P0 Step 0B** — `packages/core` JS→TS 迁移（136 文件） | Phase 1-6 已完成：utils / rolex / pouch / 4 边界全部迁 .ts, `tsup dts: true` 已开 | [`docs/tech-core-migration-2026-07-08.md`](docs/tech-core-migration-2026-07-08.md) |
| **P0 Step 2.3** — `apps/desktop` main 进程 lifecycle 拆分 | 已完成：抽出 `lifecycle/AppLifecycle.ts` | [`docs/technical-audit-2026-07-07.md`](docs/technical-audit-2026-07-07.md) |

约束（任何新工作流须遵守）：

- **MUST run `gitnexus_impact` before editing** 任何新函数/类/方法
- **MUST run `gitnexus_detect_changes()` before commit**
- 跨包边界（apps/cli → packages/core）继续使用 `const X = require('...')` 模式直到 apps/cli 的 tsconfig path-mapping 切换到 dist（详见迁移报告 §三 Phase 6）
