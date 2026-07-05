# CLI — 启动与构建指南

> `@promptx/cli` 是 Perseng 的命令行入口 (`promptx` / `promptx-cli`)。
> 基于 commander.js 调度，底层走 `@promptx/core` (CJS) + `@promptx/mcp-server`。
> 输出格式 ESM，运行时需要 Node.js ≥ 18.17（推荐 22 LTS）。

---

## 1. 前置条件

| 工具 | 最低版本 | 说明 |
|---|---|---|
| Node.js | 18.17 | 推荐 22 LTS（better-sqlite3 预编译版本更全） |
| pnpm | 9.x | monorepo workspace 必备 |
| Python | 3.x | `node-gyp` 编译 better-sqlite3 用 |
| C++ 编译工具链 | — | macOS: Xcode CLT；Windows: VS Build Tools；Linux: build-essential |

> `@promptx/core` 依赖的 `better-sqlite3` 是原生模块，会触发 `node-gyp`。
> Windows 上跑 `pnpm install` 后会自动跑 `@electron/rebuild`（见根 `postinstall`）。
> 如果失败，参见 §7.2。

## 2. 安装依赖（monorepo 根）

```bash
pnpm install
```

`postinstall` 钩子会自动跑 `electron-rebuild --only better-sqlite3 --force`，
确保原生模块兼容当前 Node ABI。

## 3. dev 模式（开发热重载）

```bash
cd apps/cli
pnpm dev
```

实际跑的是 `tsup --watch`：
- 监听 `src/bin/promptx.ts` 及所有 import 文件
- 文件变动 → 重新打包到 `apps/cli/dist/promptx.js`
- **不会自动重启 CLI**，需要手动 Ctrl+C 再跑 `pnpm start`

同时在另一个终端跑：

```bash
cd apps/cli
pnpm start
```

实际跑 `PERSENG_ENV=development node dist/promptx.js`，
即在 dev 环境下加载 `dist/promptx.js`。
PERSENG_ENV 控制日志级别 / 资源路径 / 调试开关。

预期行为：
- 输出 promptx ASCII banner（dev 模式带颜色）
- 进入交互 REPL（无参数）或直接执行命令（有参数）

## 4. 常用命令速查

CLI 通过 commander.js 路由命令，最常用的：

```bash
promptx                       # 启动交互 REPL
promptx discover              # 列出所有可用角色 + 工具
promptx discover --all        # 含已归档角色
promptx discover --archived   # 仅已归档角色
promptx action <roleId>       # 激活角色（如 promptx action luban）
promptx learn                 # 学习资源
promptx remember <text>       # 写入记忆网络
promptx recall <query>        # 检索记忆
promptx toolx <args>          # 工具执行
promptx project               # 项目管理
promptx mcp-server            # 启动 MCP server
promptx --help                # 列出所有命令
promptx <command> --help      # 单命令帮助
```

## 5. 构建产物

```bash
cd apps/cli
pnpm build
```

实际跑 `tsup`，按 `tsup.config.ts` 配置：
- entry: `src/bin/promptx.ts`
- format: `esm`
- target: `es2020`
- outDir: `dist/`
- 三个 workspace 包（`@promptx/core` / `@promptx/mcp-server` / `@promptx/logger`）标记为 `external`，不打包进产物
- shims: true（注入 `__dirname` / `__filename` 等 CJS 兼容 shim）

输出在 `apps/cli/dist/`：

```
dist/
└── promptx.js     # 单文件 ESM bundle，含 sourcemap
```

> 产物是单文件 JS，依赖通过 workspace 软链在 monorepo 内引用。
> 单独发包到 npm 时依赖会通过 peerDependencies 解析。

## 6. 全局安装与本地运行

### 6.1 从 monorepo workspace 直接跑（开发期）

```bash
# monorepo 根
pnpm --filter @promptx/cli build
node apps/cli/dist/promptx.js --help
```

### 6.2 全局安装（发布后）

```bash
npm install -g @promptx/cli
promptx --version
```

`package.json` 的 `bin` 字段声明两个入口：

```json
{
  "bin": {
    "promptx": "./dist/promptx.js",
    "promptx-cli": "./dist/promptx.js"
  }
}
```

`npm install -g` 会创建 `promptx` 和 `promptx-cli` 两个全局命令（同文件入口）。

### 6.3 npx 临时跑（不安装）

```bash
npx @promptx/cli discover
npx -p @promptx/cli promptx action luban
```

> npx 会下载最新版本，首次运行需要等几分钟。

## 7. 常用开发任务

```bash
cd apps/cli

# 类型检查
pnpm typecheck                       # tsc --noEmit

# 测试
pnpm test                            # vitest run
pnpm test:watch                      # vitest watch

# 清理
pnpm --filter @promptx/core build    # 重建依赖（core 改了要先 build）
rm -rf dist && pnpm build            # 强制重建 CLI 产物
```

## 8. 关键路径

| 用途 | 路径 |
|---|---|
| CLI 入口 | `apps/cli/src/bin/promptx.ts` |
| commander 命令注册 | `apps/cli/src/bin/promptx.ts` (主文件) |
| tsup 配置 | `apps/cli/tsup.config.ts` |
| 包描述 | `apps/cli/package.json` |
| 运行时依赖 | `@promptx/core`, `@promptx/mcp-server`, `@promptx/logger`, `chalk`, `commander` |
| 用户数据目录 | `~/.perseng/` (Linux/macOS) / `%APPDATA%\.perseng\` (Windows) |
| 资源目录 | `~/.perseng/resource/` (V1 roles) + RoleX SQLite DB (`~/.rolex/`) |

## 9. dev 模式 vs production 行为差异

| 行为 | dev (`PERSENG_ENV=development`) | prod (`PERSENG_ENV=production`) |
|---|---|---|
| 日志级别 | DEBUG（最详细） | INFO |
| 资源扫描 | 每次重新扫描 | 启动时扫一次 + ResourceManager 缓存 |
| 用户数据目录 | 同 prod（不隔离，方便调试） | 同 dev |
| 错误堆栈 | 完整打印 | 简化（user-friendly） |
| Prompt 路径 | workspace 内 `packages/resource/` | `node_modules/@promptx/resource/dist/resources/` |

> 通过 `PERSENG_ENV=production node dist/promptx.js` 可模拟生产行为。

## 10. 常见问题

### 10.1 `Cannot find module '@promptx/core'`

CLI 跑在 ESM，但 `@promptx/core` 是 CJS。
常见原因：

1. **monorepo 依赖没装**：`pnpm install`
2. **workspace 软链断了**：`ls -la node_modules/@promptx/` 看一下，应指向 `packages/*`
3. **dist 没 build**：`pnpm --filter @promptx/core build` 然后 `pnpm --filter @promptx/cli build`

### 10.2 better-sqlite3 加载失败 / `NODE_MODULE_VERSION` 不匹配

ABI 不匹配，原生模块是用旧 Node 编译的。

```bash
# 重新编译
pnpm rebuild better-sqlite3

# 或从源码强制重新编译
npm_config_build_from_source=true pnpm install

# 或指定 Node 版本切换
nvm use 22
pnpm install
```

### 10.3 `promptx` 命令找不到（全局安装后）

```bash
# 看 npm 全局 bin 在哪
npm bin -g

# 加到 PATH（一次性）
export PATH="$(npm bin -g):$PATH"

# 或用 npx 兜底
npx promptx discover
```

### 10.4 dev 模式改代码后没生效

`pnpm dev` 是 watch build，但 `pnpm start` 是另起一个 Node 进程。
**dev 模式不会自动重启 Node 进程**，需要：
1. Ctrl+C 停掉 `pnpm start`
2. 看到 tsup 重新打包完成
3. 重新 `pnpm start`

### 10.5 角色列表看不到新加的角色

CLI 启动时会扫描资源目录，但有缓存。
dev 模式每次会重新扫描，如果还是看不到：

```bash
# 看资源是否真的写到了正确位置
ls ~/.perseng/resource/

# 重新生成 user registry
promptx discover
```

### 10.6 PERSENG_ENABLE_V2=0 禁用 V2 角色

CLI 默认启用 V2（RoleX）。如果 V2 跑不起来或测试 V1-only 行为：

```bash
PERSENG_ENABLE_V2=0 promptx discover
```

会跳过 `@rolexjs/local-platform` 初始化，只显示 V1 角色。

## 11. 进阶：自定义启动

CLI 入口 `promptx.ts` 会在启动时：
1. 读 `package.json` 拿版本号（显示在 banner）
2. 初始化 logger（按 `PERSENG_ENV` 切级别）
3. 初始化 ProjectManager（恢复上次项目配置）
4. 解析命令行参数
5. 路由到对应 commander command

如果要在产品里嵌 CLI 逻辑：

```ts
import { Command } from 'commander'
import core from '@promptx/core'
const { cli } = core.pouch
const result = await cli.execute('discover', [{}])
```

## 12. 与桌面端的关系

CLI 是**独立产品**，不依赖桌面端。
桌面端的 MCP server 走 `@promptx/mcp-server`（独立包），
桌面端的角色生命周期 UI 用 `@promptx/core` 直调，
**桌面端不调 CLI**（命令解析逻辑不复用）。

如果要同时跑 CLI 和桌面端：
- 用户数据目录独立（CLI 用 `~/.perseng/`，桌面端用 `%APPDATA%/Perseng-desktop/`）
- 角色 / 工具资源目录独立
- ws 端口不冲突（如果同时启 MCP server）

## 13. 跨参考

- 桌面端启动：[desktop-startup.md](./desktop-startup.md)
- 桌面端开发：[desktop-startup-dev.md](./desktop-startup-dev.md)
- 桌面端打包：[desktop-binary-build.md](./desktop-binary-build.md)（二进制构建指南）
- 发布流程：[RELEASE_GUIDE.md](./RELEASE_GUIDE.md)
- MCP server 启动：见 `@promptx/mcp-server` 包的 `package.json scripts` 与源码