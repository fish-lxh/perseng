#!/usr/bin/env node
/**
 * ensure-better-sqlite3.cjs — KNUTH-FIX 2026-07-13 (方案 A)
 *
 * 替代 root `postinstall` 里的 `electron-rebuild --only better-sqlite3 --force`,
 * 改走 prebuild-install(国内 npmmirror 镜像)直接下 Electron ABI prebuilt。
 *
 * 为什么:
 * - electron-rebuild = node-gyp 源码编译, 要 VS Build Tools + Python 3,
 *   国内网络拉 github.com electron-headers 经常挂, 编出错的 ABI 也是常见坑
 *   (NODE_MODULE_VERSION 127 vs Electron 39 的 140)
 * - prebuild-install 用 .npmrc 里的 better-sqlite3_binary_host 拉现成 .tar.gz,
 *   解压到 bin/{platform}-{abi}/, 不需要任何编译器
 * - prebuild-install 失败兜底回 electron-rebuild, 极端情况下仍可编译
 *
 * 不变量:
 * - 不动 better-sqlite3 安装本身, 不改 deps
 * - electron-builder.yml 的 npmRebuild: true 在 package 时仍跑(但已无 ABI 错配)
 *
 * 用法: pnpm install 自动触发 (postinstall 钩子)
 */

const { execSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function log(...args) {
  console.log('[ensure-better-sqlite3]', ...args)
}

function warn(...args) {
  console.warn('[ensure-better-sqlite3]', ...args)
}

// Electron 版本号 — apps/desktop/package.json devDependencies.electron
function getElectronVersion() {
  const pkgPath = path.join(__dirname, '..', 'apps', 'desktop', 'package.json')
  if (!fs.existsSync(pkgPath)) {
    warn('apps/desktop/package.json 不存在, 跳过')
    process.exit(0)
  }
  const desktopPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const raw = desktopPkg.devDependencies?.electron
  if (!raw) {
    warn('apps/desktop/devDependencies.electron 未配置, 跳过')
    process.exit(0)
  }
  // 去掉 ^ 或 ~ 前缀, 取精确版本号
  return String(raw).replace(/^[\^~]/, '')
}

// 找 pnpm 安装的 better-sqlite3 目录 (better-sqlite3@<ver>/node_modules/better-sqlite3)
function findBetterSqlite3Dir() {
  // fs.globSync 来自 Node 22+, 不强依赖
  if (typeof fs.globSync === 'function') {
    const matches = fs.globSync('node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3')
    if (matches.length > 0) return matches[0]
  }
  // 兜底: 手动扫 pnpm 目录
  const pnpmDir = fs.existsSync('node_modules/.pnpm') ? 'node_modules/.pnpm' : null
  if (!pnpmDir) return null
  try {
    const entries = fs.readdirSync(pnpmDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory() && /^better-sqlite3@/.test(e.name)) {
        const candidate = path.join(pnpmDir, e.name, 'node_modules', 'better-sqlite3')
        if (fs.existsSync(candidate)) return candidate
      }
    }
  } catch (e) {
    warn('扫描 pnpm 目录失败:', e.message)
  }
  return null
}

// 找 pnpm store 里 prebuild-install 的 bin.js
function findPrebuildInstallBin() {
  const pnpmDir = 'node_modules/.pnpm'
  if (!fs.existsSync(pnpmDir)) return null
  const entries = fs.readdirSync(pnpmDir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isDirectory() && /^prebuild-install@/.test(e.name)) {
      const candidate = path.join(
        pnpmDir,
        e.name,
        'node_modules',
        'prebuild-install',
        'bin.js',
      )
      if (fs.existsSync(candidate)) return candidate
      // 旧版本路径: prebuild-install/bin.js
      const legacy = path.join(pnpmDir, e.name, 'node_modules', 'prebuild-install')
      if (fs.existsSync(legacy) && fs.statSync(legacy).isDirectory()) return null
    }
  }
  return null
}

function runPrebuildInstall(sqliteDir, prebuildBinRel, electronVersion, platform, arch) {
  // prebuild-install 直接调用 node + bin.js, 不经 npx (避免 --no-install 在 Windows 上的怪行为)
  // prebuild-install bin.js 内会 require('./package.json'), 所以 cwd 必须进 sqliteDir
  // 路径必须转绝对, 不然 cwd=sqliteDir 时 node 找不到
  const prebuildBinAbs = path.isAbsolute(prebuildBinRel)
    ? prebuildBinRel
    : path.resolve(process.cwd(), prebuildBinRel)
  const args = [
    prebuildBinAbs,
    '--runtime', 'electron',
    '--target', electronVersion,
    '--arch', arch,
    '--platform', platform,
  ]
  log('exec:', 'node', args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' '))
  return spawnSync(process.execPath, args, {
    cwd: sqliteDir,
    stdio: 'inherit',
    env: process.env,
  })
}

function runFallbackRebuild() {
  // 优先调 node_modules/.bin/electron-rebuild (pnpm shim), 失败则提示
  const shim = path.resolve(process.cwd(), 'node_modules', '.bin', 'electron-rebuild' + (process.platform === 'win32' ? '.cmd' : ''))
  const useCmd = process.platform === 'win32'
  const runner = useCmd ? 'cmd.exe' : shim
  const args = useCmd ? ['/c', shim, '--only', 'better-sqlite3', '--force'] : ['--only', 'better-sqlite3', '--force']
  log('fallback exec:', runner, args.join(' '))
  return spawnSync(runner, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  })
}

function main() {
  const electronVersion = getElectronVersion()
  const platform = process.platform
  const arch = process.arch

  log(`runtime=electron target=${electronVersion} platform=${platform} arch=${arch}`)

  const sqliteDir = findBetterSqlite3Dir()
  if (!sqliteDir) {
    log('better-sqlite3 未安装, 跳过 (后续 pnpm install 触发其自带 prebuild-install)')
    return
  }
  log('better-sqlite3 cwd:', sqliteDir)

  const prebuildBin = findPrebuildInstallBin()
  if (!prebuildBin) {
    warn('prebuild-install 没在 pnpm store 找到, 兜底 electron-rebuild')
    const fallback = runFallbackRebuild()
    if (fallback.status !== 0) {
      warn(`electron-rebuild exit=${fallback.status}, 不阻断后续步骤 (|| true 语义)`)
    }
    return
  }
  log('prebuild-install bin:', prebuildBin)

  const result = runPrebuildInstall(sqliteDir, prebuildBin, electronVersion, platform, arch)

  if (result.status === 0) {
    log('OK prebuilt landed, ABI:', `${platform}-${arch}-${expectedAbi(electronVersion, platform)}`)
    return
  }

  warn(`prebuild-install exit=${result.status}, 兜底 electron-rebuild (需要 VS Build Tools + Python)`)
  const fallback = runFallbackRebuild()
  if (fallback.status !== 0) {
    warn(`electron-rebuild exit=${fallback.status}, 不阻断后续步骤 (|| true 语义)`)
  }
}

// electron-rebuild 的 ABI 编号 (Electron 39 → NODE_MODULE_VERSION 140)
// 完整对照表见 node-abi / electron-rebuild 源码; 这里仅作日志展示, 实际由 prebuild-install 决定落盘位置
function expectedAbi(electronVersion, _platform) {
  // 简易映射, 不覆盖所有版本, 出错回 '?'
  const m = {
    '32.0.0': 119, '33.0.0': 121, '34.0.0': 125, '35.0.0': 127,
    '36.0.0': 130, '37.0.0': 132, '38.0.0': 136, '39.0.10': 140, '39.8.10': 140,
  }
  return m[electronVersion] || '?'
}

main()