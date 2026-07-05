# Desktop App — 启动文档索引

> Perseng 桌面端(Electron + Vite + React)从开发到发布的全部场景。

## 按场景选文档

| 场景 | 文档 |
|---|---|
| 本地开发、热重载、调试 | [desktop-startup-dev.md](./desktop-startup-dev.md) |
| 生产打包 / 安装包 / 自动更新 | [desktop-startup-prod.md](./desktop-startup-prod.md) |
| **二进制构建（electron-builder 详细流程）** | [desktop-binary-build.md](./desktop-binary-build.md) |
| CLI 启动与构建 | [cli-startup.md](./cli-startup.md) |
| 活动事件流时间线（架构 + UI + 调试） | [desktop-timeline.md](./desktop-timeline.md) |

## 与飞书服务的关系

桌面端 + 飞书服务是两个独立进程,通过 LLM 配置和 ws 端口联动:

| 维度 | 桌面端 | 飞书服务 |
|---|---|---|
| 启动命令 | `pnpm dev` / 启动 .exe | `Perseng-feishu-service start` |
| AgentX 模式 | Source(本地) | Source(本地,从 v2.4 起) |
| 默认 ws 端口 | 5200 | 5200 |
| 数据目录 | `%APPDATA%/Perseng-desktop/.agentx/` | `~/.perseng/feishu-service/.agentx/` |
| LLM API key 配在哪 | 桌面端 settings UI / `agentx-config.json` | env / `feishu-config.json` |

> 两边都能独立运行,互不依赖。如果要同时跑,**端口必须不同**
> (桌面端默认 5200、飞书服务改成 5300,或反过来)。

详见:
- [feishu-startup-local.md](./feishu-startup-local.md) § 与桌面端共存
- [feishu-startup-systemd.md](./feishu-startup-systemd.md) § 与桌面端共存

## 跨参考

- LLM 配置文件加载:参见 [feishu-deploy.md](./feishu-deploy.md) § LLM 配置加载顺序
- feishu-config.json 模板: `apps/feishu-service/feishu-config.example.json`
- 桌面端配置 UI: `apps/desktop/src/view/pages/settings-window/`
- AgentX 配置管理: `apps/desktop/src/main/services/AgentXService.ts`