# Desktop App — 开发环境启动

> 适用场景:开发者本地修改代码、热重载、调试 Electron 主进程 / Renderer。

## 1. 前置条件

- Node.js ≥ 18.17(推荐 22 LTS)
- pnpm ≥ 9
- 平台对应工具链:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools + Python 3
  - **Linux**: `build-essential` + `libnss3` 等(详见 electron 文档)

> `better-sqlite3` 是原生模块,会触发 `node-gyp`。如果装不上,先确认
> 系统装了 Python 和 C++ 编译工具。

## 2. 安装依赖

```bash
# 在 monorepo 根
pnpm install
```

> `postinstall` 会自动跑 `scripts/install-electron.cjs`,帮你下 Electron 二进制。
> 国内网络如果慢,设镜像:
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> ```

## 3. 启动 dev server

```bash
cd apps/desktop
pnpm dev
```

实际跑的是 `electron-vite dev`,会:
1. 启 Vite dev server(给 Renderer 用,默认 `http://localhost:5173`)
2. 用 `electron-vite` 的 hot-reload 模式启动 Electron
3. 监听主进程 / preload / Renderer 文件改动并自动刷新

预期日志:
```
VITE v5.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
[main] Electron started
```

## 4. 关键路径

| 用途 | 路径 |
|---|---|
| 主进程入口 | `apps/desktop/src/main/index.ts` |
| Preload | `apps/desktop/src/preload/index.ts` |
| Renderer | `apps/desktop/src/view/` |
| electron-vite 配置 | `electron.vite.config.ts` |
| 用户数据目录 | `%APPDATA%/Perseng-desktop/` (Windows)<br>`~/Library/Application Support/Perseng-desktop/` (macOS)<br>`~/.config/Perseng-desktop/` (Linux) |
| 运行时配置 | `<userData>/agentx-config.json`(LLM API key 等) |
| AgentX 数据 | `<userData>/.agentx/`(image / container) |
| Skills 目录 | `<userData>/skills/` |

> 在 dev 模式下 `<userData>` 通常指向系统目录,不会污染你 `pnpm dev` 跑的工作树。

## 5. LLM 配置(开发期)

打开应用 → 右上角设置图标 → "LLM 配置" 标签页:
- 填 `API Key` / `Base URL` / `Model`
- 点 "测试连接" 验证
- 保存

也可以直接编辑 `<userData>/agentx-config.json`:
```json
{
  "apiKey": "sk-ant-xxx",
  "baseUrl": "https://api.anthropic.com",
  "model": "claude-sonnet-4-20250514",
  "profiles": [{ "id": "...", "name": "Default", "...": "..." }],
  "activeProfileId": "..."
}
```

重启 app 让配置生效。

## 6. 常用 dev 任务

```bash
# 类型检查(主进程 / Renderer)
pnpm typecheck

# 测试
pnpm test:run

# 单测 watch
pnpm test

# Lint
pnpm lint
pnpm lint:fix

# 预览构建产物(不打包成安装包)
pnpm build && pnpm preview
```

## 7. 调试主进程

### 7.1 VS Code `.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Desktop Main",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}/apps/desktop",
      "runtimeExecutable": "electron",
      "runtimeArgs": [
        "--inspect-brk=5858",
        "out/main/index.js"
      ],
      "skipFiles": ["<node_internals>/**"],
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/apps/desktop/out/main/**/*.js"]
    }
  ]
}
```

> `pnpm build` 一次后用上面配置,F5 启动,Chrome DevTools 打开
> `chrome://inspect` 即可打断点。

### 7.2 DevTools 调试 Renderer

`pnpm dev` 启动后:
- 默认 DevTools 是关闭的
- 临时打开:`Cmd/Ctrl + Shift + I`,或在主进程代码里加:
  ```ts
  mainWindow.webContents.openDevTools({ mode: 'detach' })
  ```

## 8. 性能分析

```bash
# 主进程 CPU/Heap profile
node --prof out/main/index.js
node --prof-process isolate-*.log > processed.txt
```

Renderer 端用 Chrome DevTools 的 Performance / Memory tab 即可。

## 9. 常见问题

### 9.1 启动后白屏
- Vite dev server 没起来 → 看终端日志
- Renderer 报错 → 开 DevTools 看 console
- `<userData>` 损坏 → 删 `<userData>` 重启(会丢本地数据!)

### 9.2 better-sqlite3 加载失败
```bash
# 重新编译原生模块
pnpm rebuild better-sqlite3
# 或者
npm_config_build_from_source=true pnpm install
```

> 跨平台原生模块需要在当前 Node ABI 下重新编译。timeline 模块依赖 better-sqlite3，
> 编译失败时先看 [desktop-timeline.md §7.2](./desktop-timeline.md#72-better-sqlite3-加载失败)。

### 9.3 electron 下不下来
```bash
# 国内镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
pnpm install
```

### 9.4 Windows 上 EPERM 创建 symlink
dev 模式下通常不触发(因为 workdir 是 userData 下);如果碰到:
- 用管理员身份跑一次
- 长期方案:开启 Windows 开发者模式

### 9.5 端口冲突(桌面端 AgentX 默认 5200)
- 飞书服务也用 5200 → 在飞书服务侧改 `--agentx-port`
- 或在桌面端 settings.json 里改 agentx 端口(目前 UI 未暴露,需手动改文件)

## 10. dev 模式的常见"反直觉"

- **修改主进程代码会重启 Electron**,但 Renderer 用的是 Vite HMR,只刷新页面
- **修改 preload 代码需要重启主进程**
- **修改依赖包(package.json)后,必须重跑 `pnpm install` 然后重启 dev**
- **dev 模式不会自动更新 userData**,所以开发期间填的 API key 会持续存在,
  直到你删 userData 目录