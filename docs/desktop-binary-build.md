# Desktop App — 二进制构建与发布指南

> Perseng 桌面端通过 `electron-builder` 把 Electron 应用打成各平台原生安装包
> （.dmg / .exe / .deb / .rpm / .AppImage / .zip）。
> 本文档覆盖**本地构建 + 跨平台构建 + 签名公证 + 自动更新元数据**全流程。

---

## 1. 构建总览

### 1.1 两条构建路径

| 场景 | 配置文件 | 触发命令 | 用途 |
|---|---|---|---|
| **正式发布** | `electron-builder.yml` | `pnpm package` | 多架构 / 公证 / 签名 / 自动更新元数据 |
| **本地内测** | `electron-builder-dev.yml` | `pnpm package:mac` / `package:win` / `package:linux` | 当前架构 / 跳过公证 / 强制签名 / 快速迭代 |

> ⚠️ `package:mac` / `package:win` / `package:linux` **都默认走 dev 配置**，
> 因为本地开发时不需要公证。
> 正式发版必须显式跑 `pnpm package`（走 prod 配置）。

### 1.2 产物命名规范

正式发布（`electron-builder.yml`）：

```
perseng-desktop-{version}-{os}-{arch}.{ext}
├── macOS:    perseng-desktop-2.4.1-darwin-x64.dmg     (Intel)
│             perseng-desktop-2.4.1-darwin-arm64.dmg   (Apple Silicon)
│             perseng-desktop-2.4.1-darwin-x64.zip     (增量更新)
│             perseng-desktop-2.4.1-darwin-arm64.zip
├── Windows:  perseng-desktop-2.4.1-win32-x64-setup.exe (NSIS 安装包)
│             perseng-desktop-2.4.1-win32-x64.exe       (免安装版，见 §7)
├── Linux:    perseng-desktop-2.4.1-linux-x64.deb       (Debian/Ubuntu)
│             perseng-desktop-2.4.1-linux-arm64.deb
│             perseng-desktop-2.4.1-linux-x64.AppImage  (可执行)
│             perseng-desktop-2.4.1-linux-x64.rpm       (RedHat/Fedora)
```

dev 内测（`electron-builder-dev.yml`）：

```
perseng-desktop-2.4.1-darwin-arm64.zip    (macOS 仅当前架构 + ZIP)
perseng-desktop-2.4.1-win32-x64.exe       (Windows)
perseng-desktop-2.4.1-linux-x64.AppImage  (Linux)
```

## 2. 前置条件

### 2.1 通用

```bash
# monorepo 根
pnpm install
```

### 2.2 平台特定

| 平台 | 系统要求 | 额外工具 |
|---|---|---|
| macOS | macOS 11+ | Xcode Command Line Tools（`xcode-select --install`）|
| Windows | Windows 10/11 + Python 3 + VS Build Tools | WebView2 Runtime（用户机器要装） |
| Linux | glibc 2.31+（如 Ubuntu 20.04） | `dpkg` / `rpm` / `fakeroot` |

### 2.3 electron-builder 镜像加速（可选）

国内网络环境：

```bash
# 根 .npmrc 或临时环境变量
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

# 注意：electron-builder.yml 里的 electronDownload.mirror
# 已强制指向 GitHub 官方源（避免镜像过期问题）
```

### 2.4 原生模块（better-sqlite3）

electron-builder 默认会自动跑 `npmRebuild: true`，
针对 Electron Node ABI 重新编译原生模块。

如果失败：

```bash
# 手动 rebuild
pnpm rebuild better-sqlite3

# 强制从源码编译
npm_config_build_from_source=true pnpm install
```

## 3. 构建命令详解

### 3.1 当前主机构建（最常用）

```bash
cd apps/desktop

# 全平台产物（当前主机能打的全打）
pnpm package
# 实际跑：pnpm build && electron-builder

# 单平台快速构建（dev 配置，跳过公证）
pnpm package:mac       # macOS 当前架构 ZIP
pnpm package:win       # Windows NSIS 安装包
pnpm package:linux     # Linux deb/AppImage/rpm

# 跳过 macOS clean 重打
pnpm package:mac:skip  # 跳过 pnpm build

# macOS alias（开发用）
pnpm dist
```

`pnpm build` 实际跑 `pnpm clean && electron-vite build`：
1. `clean`：删 `out/ dist/ release/ tsconfig.tsbuildinfo`
2. `electron-vite build`：构建主进程 + Preload + Renderer 三个 bundle

产物结构：

```
apps/desktop/out/
├── main/        # 主进程 bundle (CommonJS)
├── preload/     # Preload bundle (CommonJS)
└── renderer/    # Renderer bundle (静态资源 + JS + CSS)
```

### 3.2 跨平台构建（高级）

macOS 安装包**只能在 macOS 上构建**（Apple 限制）。
其他平台理论上可交叉编译，但不推荐：

```bash
# Linux 上构建 Windows 包（不推荐，可能缺原生模块编译）
cd apps/desktop
electron-builder --win --x64

# macOS 上通过 Docker 构建 Linux（实验性）
docker run --rm -ti \
  -v ${PWD}:/project \
  -v ${PWD}/../..:/repo \
  electronuserland/builder \
  /bin/bash -c "cd /project && electron-builder --linux"
```

推荐用 CI（GitHub Actions）跑跨平台构建，见 §6。

## 4. 关键配置说明

### 4.1 文件过滤（`files` 段）

`electron-builder.yml` 的 `files` 决定哪些文件被打进安装包：

```yaml
files:
  - "out/**/*"                              # 主进程/Preload/Renderer bundle
  - "assets/**/*"                           # 应用图标等资源
  - "package.json"                          # 包元信息
  - "!**/*.map"                             # 不打包 sourcemap
  - "!**/node_modules/*/{README,CHANGELOG,test,example,examples}"  # 排除冗余文件
  - "!**/node_modules/**/*.ts"              # 不打包 TS 源码（仅留 .js）
  - "!**/*.{md,MD,markdown,txt}"            # 排除文档
  - "node_modules/@promptx/resource/dist/resources/**/*"        # role 资源（系统 prompt）
  - "node_modules/@promptx/resource/dist/resources/**/*.md"      # 重新包含 .md（角色定义）
```

> 系统角色 .md 是必要的（LLM 要读），所以有"排除 → 再包含"的两步配置。

### 4.2 外部资源（`extraResources`）

`packages/mcp-office/dist` 和 `packages/mcp-workspace/dist` 不打进 asar，
而是放到 `resources/mcp-office/` `resources/mcp-workspace/`（运行时按路径加载）：

```yaml
extraResources:
  - from: "../../packages/mcp-office/dist"
    to: "mcp-office"
    filter: ["**/*"]
  - from: "../../packages/mcp-workspace/dist"
    to: "mcp-workspace"
    filter: ["**/*"]
```

> 必须在 monorepo 根跑 `pnpm --filter @promptx/mcp-office build` 才能生成 dist。

### 4.3 asar 打包 + asarUnpack

```yaml
asar: true
# 默认不需要显式声明 asarUnpack，因为：
# 1. extraResources 的文件不打包
# 2. better-sqlite3 已通过 npmRebuild 编译成 Electron ABI 版本
```

如果遇到 `Cannot find module 'better-sqlite3'`，加：

```yaml
asarUnpack:
  - "node_modules/better-sqlite3/**"
```

### 4.4 元数据生成

```yaml
generateUpdatesFilesForAllChannels: true
```

会自动生成自动更新元数据（`latest.yml` / `latest-mac.yml` / `latest-linux.yml`）。

## 5. 代码签名

### 5.1 macOS

#### 5.1.1 开发内测（dev 配置）

`electron-builder-dev.yml` 已配强制签名 + 公司证书：

```yaml
mac:
  identity: "CHINGHO YANG (2L3974JGL8)"
  notarize: false    # 本地跳过公证
  hardenedRuntime: true
```

直接跑 `pnpm package:mac` 即可（需本机 Keychain 已装对应证书）。

#### 5.1.2 正式发布（prod 配置）

需要 Apple Developer ID + App-Specific Password：

```bash
# 1. 装证书到 Keychain（双击 .p12）
# 2. 配环境变量
export CSC_LINK=/path/to/DeveloperID_Application.p12
export CSC_KEY_PASSWORD=...
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=ABCD123456

# 3. 构建（prod 配置自动签名 + 公证）
pnpm package
```

跳过公证（紧急修复）：在 `electron-builder.yml` 设 `notarize: false`。

### 5.2 Windows

```bash
# 代码签名证书 .pfx
set CSC_LINK=C:\path\to\cert.pfx
set CSC_KEY_PASSWORD=...

pnpm package:win
```

无证书也能打 .exe，但 Windows SmartScreen 会拦截（用户点"更多信息 → 仍要运行"可绕过）。

### 5.3 Linux

GPG 签名（deb / rpm 仓库发布需要）：

```bash
export CSC_LINK=/path/to/private.key
pnpm package:linux
```

AppImage 不强制要求 GPG。

## 6. CI/CD（GitHub Actions）

`.github/workflows/release.yml` 模板：

```yaml
name: Release Desktop
on:
  push:
    tags: ['v*']

jobs:
  build:
    name: Build ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # 先 build monorepo 所有依赖包
      - run: pnpm --filter "@promptx/core" --filter "@promptx/mcp-server" --filter "@promptx/mcp-office" --filter "@promptx/mcp-workspace" --filter "@promptx/resource" --filter "@promptx/cli" build
      # 正式构建（用 electron-builder.yml，不用 dev）
      - run: pnpm --filter @promptx/desktop package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS 签名
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          # Windows 签名
          CSC_KEY_PASSWORD_WIN: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: Perseng-${{ matrix.os }}
          path: |
            apps/desktop/release/*.dmg
            apps/desktop/release/*.zip
            apps/desktop/release/*.exe
            apps/desktop/release/*.AppImage
            apps/desktop/release/*.deb
            apps/desktop/release/*.rpm
            apps/desktop/release/*.yml
      - uses: actions/upload-artifact@v4
        with:
          name: Perseng-${{ matrix.os}}-blockmap
          path: apps/desktop/release/*.blockmap
```

构建产物会自动 attach 到 GitHub Release。

## 7. Windows 免安装版（Portable）

`electron-builder.yml` 没显式配 portable 目标，但可通过 `portable` 段覆盖：

```yaml
portable:
  artifactName: perseng-desktop-${version}-${os}-${arch}-portable.${ext}
```

或临时打 portable：

```bash
electron-builder --win portable --x64
```

Portable 模式特点：
- 单文件 `.exe`，无需安装
- 启动时解压到 `%TEMP%`
- 不写注册表 / 不创建快捷方式
- 适合临时测试

## 8. 自动更新元数据

`pnpm package` 会在 `apps/desktop/release/` 生成：

| 文件 | 用途 |
|---|---|
| `latest.yml` | 通用最新版本元数据 |
| `latest-mac.yml` | macOS 专属（区分 x64 / arm64） |
| `latest-linux.yml` | Linux 专属 |

格式示例（`latest.yml`）：

```yaml
version: 2.4.1
files:
  - url: perseng-desktop-2.4.1-win32-x64.exe
    sha512: xxxx...
    size: 89432567
  - url: perseng-desktop-2.4.1-win32-x64.exe.blockmap
    sha512: xxxx...
    size: 91234
path: perseng-desktop-2.4.1-win32-x64.exe
sha512: xxxx...
releaseDate: '2026-07-05T...'
```

主进程的 `electron-updater` 自动用这些文件检查更新。
详见 [desktop-startup-prod.md §4](./desktop-startup-prod.md#4-发布到-github-releases自动更新)。

## 9. 发布渠道

### 9.1 发布源（`publish` 段）

```yaml
publish:
  - provider: generic
    url: https://perseng.deepractice.ai/download/latest   # 优先 CDN
  - provider: github
    owner: Deepractice
    repo: Perseng
    releaseType: release                                    # 兜底 GitHub
```

构建时会**按顺序尝试每个 provider**，自动更新时也是。
优先用公司 CDN，CDN 挂了走 GitHub Releases。

### 9.2 渠道（channel）

- `latest`：稳定版
- `beta`：公测版
- 文件名带 `-beta` 后缀（如 `perseng-desktop-2.4.1-beta.1-x64.exe`）会被识别为 beta 渠道

自动更新时：
- `latest` 用户只能升到 `latest`
- `beta` 用户可以升到 `beta` 或 `latest`
- 通过环境变量 `PERSENG_UPDATE_CHANNEL=beta` 切换

## 10. 调试构建

```bash
# 详细日志
DEBUG=electron-builder,electron-download pnpm package:mac

# 只构建不打包（生成 out/，给 electron-builder 用的）
pnpm build

# 预览构建产物
pnpm preview

# 检查产物结构
npx asar list apps/desktop/out/resources/app.asar
```

## 11. 常见问题

### 11.1 macOS 构建失败 "Identity not found"

本地 Keychain 没装对应证书：
- 双击 `.p12` 导入
- 或用 `security find-identity -p codesigning -v` 列出可用 identity

### 11.2 macOS 公证失败 "The signature is invalid"

- 证书过期 / 被撤销 → 重新申请
- `hardenedRuntime: true` 但 entitlements 文件没配或配错
- 检查 `assets/entitlements.mac.plist` 是否包含必要权限

### 11.3 Windows 上 SmartScreen 拦截

- 没签名 → 用户点"更多信息 → 仍要运行"
- 长期方案：买 EV 证书 + 提交微软信誉库

### 11.4 better-sqlite3 找不到（`Cannot find module 'better-sqlite3'`）

```bash
# 1. npmRebuild 失败，手动 rebuild
cd apps/desktop
pnpm rebuild better-sqlite3

# 2. asar 打包问题，加 asarUnpack
# electron-builder.yml:
#   asarUnpack:
#     - "node_modules/better-sqlite3/**"

# 3. 编译 ABI 不匹配
npm_config_build_from_source=true pnpm install
```

### 11.5 Linux AppImage 启动报 `libgtk-x11-2.0.so.0`

系统缺老依赖：
```bash
sudo apt install libgtk2.0-0
```

或换打 `.deb` 让系统包管理器处理依赖。

### 11.6 安装包体积过大

```bash
# 看哪些目录占空间
npx asar list apps/desktop/out/resources/app.asar | head -50

# 常见瘦身方向：
# 1. 排除 dev dependencies（默认就排除）
# 2. 排除 i18n locale 文件
# 3. 排除 optional dependencies
```

详见 `electron-builder.yml` 的 `files` 段，按需加排除规则。

### 11.7 macOS Gatekeeper 拦截未签名 dev 包

```bash
# 临时绕过（仅限内测）
xattr -d com.apple.quarantine /Applications/Perseng.app

# 或允许任何来源（系统设置）
# System Settings → Privacy & Security → Allow apps from: Anywhere
```

### 11.8 自动更新下载到一半失败

- GitHub API rate limit → 配 `GH_TOKEN` 环境变量
- 网络问题 → 用户重启后自动续传（`electron-updater` 默认行为）
- CDN 挂了 → 自动 fallback 到 GitHub provider

## 12. 构建产物清单示例

`pnpm package` 一次成功（macOS）：

```
apps/desktop/release/
├── perseng-desktop-2.4.1-darwin-x64.dmg
├── perseng-desktop-2.4.1-darwin-arm64.dmg
├── perseng-desktop-2.4.1-darwin-x64.zip
├── perseng-desktop-2.4.1-darwin-arm64.zip
├── perseng-desktop-2.4.1-darwin-x64.zip.blockmap
├── perseng-desktop-2.4.1-darwin-arm64.zip.blockmap
├── latest-mac.yml
└── builder-effective-config.yaml       # electron-builder 实际生效配置（调试用）
```

`pnpm package` 一次成功（Windows）：

```
apps/desktop/release/
├── perseng-desktop-2.4.1-win32-x64-setup.exe      (NSIS 安装包)
├── perseng-desktop-2.4.1-win32-x64.exe.blockmap
├── latest.yml
└── builder-effective-config.yaml
```

## 13. 跨参考

- 桌面端启动总览：[desktop-startup.md](./desktop-startup.md)
- 桌面端开发：[desktop-startup-dev.md](./desktop-startup-dev.md)
- 桌面端生产配置 / 自动更新：[desktop-startup-prod.md](./desktop-startup-prod.md)
- CLI 启动：[cli-startup.md](./cli-startup.md)
- 发布流程 / changesets：[RELEASE_GUIDE.md](./RELEASE_GUIDE.md)
- 活动事件流：[desktop-timeline.md](./desktop-timeline.md)