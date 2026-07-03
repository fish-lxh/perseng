# Desktop App — 生产环境启动

> 适用场景:打包成安装包、发布给最终用户、配置自动更新。

## 1. 平台支持矩阵

| 平台 | 构建主机 | 输出 | 签名 |
|---|---|---|---|
| macOS (universal) | macOS | `.dmg` | 公证(notarize)需要 Apple ID |
| macOS (Apple Silicon) | macOS (M1/M2/M3) | `.dmg` / `-arm64.dmg` | 同上 |
| macOS (Intel) | macOS (Intel) | `.dmg` / `-x64.dmg` | 同上 |
| Windows | Windows | `.exe` (NSIS) | 代码签名证书(可选) |
| Linux | Linux | `.AppImage` / `.deb` / `.rpm` | GPG 签名(可选) |

> 跨平台构建受限:macOS 安装包只能在 macOS 上构建。
> Linux/Windows 可以在 macOS 上用 Docker 跨编译,但通常不推荐。

## 2. 构建配置

`apps/desktop/electron-builder.yml` 是正式发布用的配置,
`electron-builder-dev.yml` 是开发内测版(签名/公证放开)。

关键字段:

```yaml
appId: com.perseng.perseng
productName: Perseng
copyright: Copyright © 2026 Perseng

directories:
  output: release
  buildResources: build

files:
  - out/**/*
  - package.json
  - "!**/.git"
  - "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}"
  - "!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}"
  - "!**/*.{o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,suo,xproj,cc,d.ts}"
  - "!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}"

asar: true
asarUnpack:
  - node_modules/better-sqlite3/**
  - node_modules/@anthropic-ai/claude-agent-sdk/cli.js

mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch: [universal]    # 一次构建 x86 + arm64
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true         # CI 时打开,本地可以 false

win:
  target:
    - target: nsis
      arch: [x64]
  # certificateFile: /path/to/cert.pfx
  # certificatePassword: ${env.CSC_KEY_PASSWORD}

linux:
  target:
    - target: AppImage
      arch: [x64]
  category: Office

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  shortcutName: Perseng

publish:
  - provider: github
    releaseType: release
    # 自动更新用的 release 仓库
```

## 3. 构建产物

```bash
cd apps/desktop

# 完整构建 + 打包(全平台 → 当前平台能打的)
pnpm package

# macOS
pnpm package:mac

# Windows(用国内镜像加速)
pnpm package:win

# Linux
pnpm package:linux
```

输出在 `apps/desktop/release/`:

```
release/
├── Perseng-2.4.1-universal.dmg          # macOS
├── Perseng-2.4.1-x64.exe                # Windows
├── Perseng-2.4.1-x86_64.AppImage        # Linux
├── latest.yml                           # 自动更新元数据
├── Perseng-desktop-2.4.1-mac.zip        # 增量更新包
└── ...
```

## 4. 发布到 GitHub Releases(自动更新)

桌面端用 `electron-updater`,配置好 GitHub Releases 后:
- 用户打开 app → 自动检查新版本
- 有新版本时弹更新提示
- 下载 → 静默安装 → 重启 app

### 4.1 准备工作

1. 在 GitHub 创建 release(或 push tag 触发 CI)
2. 把构建产物(dmg/exe/AppImage)上传到 release
3. `latest.yml`(自动生成)同 release 一并上传

### 4.2 自动更新代码

主进程 `apps/desktop/src/main/updater/ElectronUpdater.ts` 已经实现,
关键开关:

```ts
autoUpdater.autoDownload = !isDev           // dev 不下载
autoUpdater.autoInstallOnAppQuit = true
```

默认更新源是 GitHub(`publish.provider: github`)。

### 4.3 渠道(channel)

- `latest`: 稳定版
- `beta`: 公测(在 `electron-builder.yml` 里加 `channel: beta`,或文件名带 `-beta`)

macOS 的 Sparkle / Windows 的 NSIS 自动支持 channel,无需额外改代码。

## 5. 安装包签名

### 5.1 macOS

需要 Apple Developer ID + 公证:

```bash
# 1. 装证书到 Keychain(略)
# 2. 设置环境变量
export CSC_LINK=/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD=...
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...

# 3. 构建时会自动签名 + 公证
pnpm package:mac
```

> 跳过公证(内测用):在 `electron-builder.yml` 里设 `notarize: false`。

### 5.2 Windows

EV 代码签名证书 或 普通代码签名证书:

```bash
set CSC_LINK=C:\path\to\cert.pfx
set CSC_KEY_PASSWORD=...
pnpm package:win
```

> 没有证书也能打 .exe,只是 Windows SmartScreen 会拦截。

### 5.3 Linux

GPG 签名(可选):
```bash
export CSC_LINK=/path/to/private.key
pnpm package:linux
```

## 6. CI/CD 示例(GitHub Actions)

`.github/workflows/release.yml`:

```yaml
name: Release Desktop
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @promptx/desktop build
      - run: pnpm --filter @promptx/desktop package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS 签名(只在 macos-latest 上生效)
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      - uses: actions/upload-artifact@v4
        with:
          name: Perseng-${{ matrix.os }}
          path: apps/desktop/release/*.{dmg,exe,AppImage,deb,rpm}
```

`release.yml`(`electron-builder` 自动生成):

```yaml
version: 2.4.1
files:
  - url: Perseng-2.4.1-x64.exe
    sha512: ...
    size: ...
  - url: Perseng-2.4.1-x64.exe.blockmap
    sha512: ...
    size: ...
path: Perseng-2.4.1-x64.exe
sha512: ...
releaseDate: '2026-06-30T...'
```

## 7. 用户数据迁移

如果 schema 改了,需要写迁移脚本。`apps/desktop/src/main/storage/`
有相关代码。

简单的迁移模式:
```ts
// 在主进程启动时
const migrations = [
  { from: '2.0.0', to: '2.1.0', run: migrateRoleFormat },
  { from: '2.1.0', to: '2.4.0', run: migrateAgentXConfig },
]
const currentVersion = await getCurrentVersion()
for (const m of migrations) {
  if (semver.lt(currentVersion, m.to)) {
    logger.info(`Running migration ${m.from} → ${m.to}`)
    await m.run()
  }
}
```

## 8. 升级后行为

用户从 2.3.x 升到 2.4.x:
- `agentx-config.json` 自动兼容(`apiKey` / `profiles` / `activeProfileId` 都会保留)
- `agentxDir` 不动,image 数据保留
- 如果是首次升级(从来没设过 LLM key) → 启动后弹"配置 LLM"提示

## 9. 卸载 / 清理

- **macOS**: 拖到废纸篓;数据保留在 `~/Library/Application Support/Perseng-desktop/`
- **Windows**: 控制面板卸载;数据保留在 `%APPDATA%/Perseng-desktop/`
- **Linux**: `sudo dpkg -r Perseng-desktop`(deb)或直接删 AppImage

彻底清理(含数据):
- macOS: `rm -rf ~/Library/Application\ Support/Perseng-desktop/ ~/Library/Logs/Perseng-desktop/`
- Windows: `del /s /q %APPDATA%\Perseng-desktop %APPDATA%\Perseng-desktop\logs`
- Linux: `rm -rf ~/.config/Perseng-desktop/ ~/.local/share/Perseng-desktop/`

## 10. 监控 / 崩溃上报

主进程可以接 Sentry / Bugsnag,把崩溃日志上送:

```ts
import * as Sentry from '@sentry/electron'
Sentry.init({
  dsn: process.env.PERSENG_SENTRY_DSN,
  release: app.getVersion(),
  environment: 'production',
})
```

(目前代码里没接,后续 roadmap 加)

## 11. 常见问题

### 11.1 macOS 公证失败 "The signature is invalid"
- 证书过期 / 撤销
- `hardenedRuntime: true` 但 entitlements 文件配错

### 11.2 Windows 上 SmartScreen 拦截
- 没签名 → 用户点"更多信息 → 仍要运行"
- 长期方案:EV 证书 + 提交微软信誉库

### 11.3 Linux AppImage 启动报 "libgtk-x11-2.0.so.0: cannot open"
- 系统缺老依赖,装 `libgtk2.0-0` 即可
- 或改打 `.deb` 用系统包管理器装

### 11.4 自动更新下载到一半失败
- GitHub API rate limit → 加 GitHub Token
- 网络问题 → 用户重启后会自动续传(`electron-updater` 默认行为)

### 11.5 安装后启动报 "Cannot find module 'better-sqlite3'"
- `asarUnpack` 没配置好,原生模块在 asar 里加载失败
- 检查 `electron-builder.yml` 的 `asarUnpack` 段是否包含 `node_modules/better-sqlite3/**`