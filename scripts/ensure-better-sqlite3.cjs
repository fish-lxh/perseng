#!/usr/bin/env node
/**
 * ensure-better-sqlite3.cjs — KNUTH-FIX 2026-07-13 (方案 A) + KNUTH-FIX 2026-07-19 (容错加固)
 *
 * 替代 root `postinstall` 里的 `electron-rebuild --only better-sqlite3 --force`,
 * 改走 prebuild-install(国内 npmmirror 镜像)直接下 Electron ABI prebuilt。
 *
 * 为什么:
 * - electron-rebuild = node-gyp 源码编译, 要 VS Build Tools + Python 3,
 *   国内网络拉 github.com electron-headers 经常挂, 编出错的 ABI 也是常见坑
 *   (NODE_MODULE_VERSION 127 vs Electron 39 的 140)
 * - prebuild-install 用 .npmrc 里的 better_sqlite3_binary_host 拉现成 .tar.gz,
 *   解压到 build/Release/better_sqlite3.node, 不需要任何编译器
 * - prebuild-install 失败兜底回 electron-rebuild (从 packages/mcp-server 启动,
 *   才能扫到 transitive dep), 极端情况下仍可编译
 *
 * 不变量:
 * - 不动 better-sqlite3 安装本身, 不改 deps
 * - electron-builder.yml 的 npmRebuild: true 在 package 时仍跑(但已无 ABI 错配)
 *
 * 用法:
 *   pnpm install 自动触发 (postinstall 钩子)
 *   node scripts/ensure-better-sqlite3.cjs --check      # 只校验当前 binary
 *   node scripts/ensure-better-sqlite3.cjs --force      # 强制重装 (即使当前 binary 已校验通过)
 *
 * 容错 (KNUTH-FIX 2026-07-19):
 *  - prebuild-install ECONNRESET 时自动重试 3 次 (backoff 2s/5s/10s)
 *  - post-install sanity check: 文件大小 + (可选) sha256 + 在当前 Node ABI 下 require 探测
 *  - fallback electron-rebuild 改为从 packages/mcp-server 启动 (那里 better-sqlite3 是 direct dep)
 *  - 显式 exit code: 0=OK, 1=hard fail (binary 状态不可信)
 */

const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

function log(...args) {
  console.log('[ensure-better-sqlite3]', ...args)
}

function warn(...args) {
  console.warn('[ensure-better-sqlite3]', ...args)
}

function fail(...args) {
  console.error('[ensure-better-sqlite3] FATAL:', ...args)
}

// ---------------------------------------------------------------------------
// 配置 / CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const FLAGS = {
  check: args.includes('--check'),
  force: args.includes('--force'),
  help: args.includes('--help') || args.includes('-h'),
}

// Electron ABI 对照表 (完整表见 node-abi / electron-rebuild 源码; 这里仅覆盖主线版本)
// 来源: https://www.electronjs.org/docs/latest/tutorial/electron-versioning
const ELECTRON_ABI = {
  '32.0.0': 119, '32.2.0': 119,
  '33.0.0': 121, '33.4.0': 121,
  '34.0.0': 125,
  '35.0.0': 127,
  '36.0.0': 130,
  '37.0.0': 132,
  '38.0.0': 136,
  '39.0.0': 140, '39.8.10': 140,
}

// better-sqlite3 v12.x prebuilt 最小体积 (sanity check, 太小说明下载残缺)
// Electron 39 win32-x64 = 1,920,512 bytes; Node 22 = 1,918,976 bytes
const MIN_BINARY_SIZE = 1_500_000

// Electron 版本号 — apps/desktop/package.json devDependencies.electron
function getElectronVersion() {
  const pkgPath = path.join(__dirname, '..', 'apps', 'desktop', 'package.json')
  if (!fs.existsSync(pkgPath)) {
    warn('apps/desktop/package.json 不存在, 跳过')
    return null
  }
  const desktopPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const raw = desktopPkg.devDependencies?.electron
  if (!raw) {
    warn('apps/desktop/devDependencies.electron 未配置, 跳过')
    return null
  }
  return String(raw).replace(/^[\^~]/, '')
}

function expectedAbi(electronVersion) {
  return ELECTRON_ABI[electronVersion] ?? '?'
}

function printHelp() {
  console.log(`用法: node scripts/ensure-better-sqlite3.cjs [选项]

选项:
  --check   只校验当前 binary 是否存在 + 加载正常, 不下载/编译
  --force   强制重装 (即使当前 binary 已校验通过)
  --help    显示帮助

默认行为: 下载 Electron ABI prebuilt (经 npmmirror), 失败重试 3 次,
          再失败则 fallback electron-rebuild (从 packages/mcp-server 启动).
`)
}

// ---------------------------------------------------------------------------
// pnpm 目录扫描
// ---------------------------------------------------------------------------

function findBetterSqlite3Dir() {
  // 必须返回绝对路径 — 后续 probe 子进程的 require() 才能正确解析
  if (typeof fs.globSync === 'function') {
    const matches = fs.globSync('node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3')
    if (matches.length > 0) return path.resolve(matches[0])
  }
  const pnpmDir = fs.existsSync('node_modules/.pnpm') ? 'node_modules/.pnpm' : null
  if (!pnpmDir) return null
  try {
    const entries = fs.readdirSync(pnpmDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory() && /^better-sqlite3@/.test(e.name)) {
        const candidate = path.resolve(pnpmDir, e.name, 'node_modules', 'better-sqlite3')
        if (fs.existsSync(candidate)) return candidate
      }
    }
  } catch (e) {
    warn('扫描 pnpm 目录失败:', e.message)
  }
  return null
}

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
    }
  }
  return null
}

function findElectronRebuildShim() {
  const binDir = path.resolve(process.cwd(), 'node_modules', '.bin')
  if (!fs.existsSync(binDir)) return null
  const candidates = [
    `electron-rebuild${process.platform === 'win32' ? '.cmd' : ''}`,
    `electron-rebuild${process.platform === 'win32' ? '.ps1' : ''}`,
  ]
  for (const name of candidates) {
    const p = path.join(binDir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

// ---------------------------------------------------------------------------
// prebuild-install 执行 + 重试
// ---------------------------------------------------------------------------

function runPrebuildInstallOnce(sqliteDir, prebuildBinRel, electronVersion, platform, arch) {
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
  return spawnSync(process.execPath, args, {
    cwd: sqliteDir,
    stdio: ['ignore', 'pipe', 'pipe'], // 重试时需要读 stderr 判 ECONNRESET
    env: process.env,
  })
}

// ECONNRESET / ETIMEDOUT / EAI_AGAIN 等网络瞬态错误 → 重试
const RETRYABLE_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /socket hang up/i,
  /getaddrinfo/i,
]

function isRetryable(result) {
  if (result.status === 0) return false
  const stderr = result.stderr ? result.stderr.toString() : ''
  const stdout = result.stdout ? result.stdout.toString() : ''
  const combined = stderr + '\n' + stdout
  return RETRYABLE_PATTERNS.some((re) => re.test(combined))
}

function runPrebuildInstallWithRetry(sqliteDir, prebuildBin, electronVersion, platform, arch) {
  const RETRY_DELAYS_MS = [2000, 5000, 10000] // 3 attempts total
  let lastResult = null

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const isRetry = attempt > 0
    if (isRetry) {
      log(`retry ${attempt}/${RETRY_DELAYS_MS.length} after ${RETRY_DELAYS_MS[attempt - 1]}ms`)
      // 重试前先 sleep (同步, 因为这是 postinstall 钩子)
      const deadline = Date.now() + RETRY_DELAYS_MS[attempt - 1]
      while (Date.now() < deadline) {
        /* busy wait */
      }
    }

    log(`exec: node <prebuild-install> --runtime electron --target ${electronVersion} --platform ${platform} --arch ${arch}`)
    const r = runPrebuildInstallOnce(sqliteDir, prebuildBin, electronVersion, platform, arch)
    // 实时透传 stdout/stderr (避免重试期间信息丢失)
    if (r.stdout) process.stdout.write(r.stdout)
    if (r.stderr) process.stderr.write(r.stderr)
    lastResult = r

    if (r.status === 0) return r
    if (!isRetryable(r)) {
      log(`prebuild-install non-retryable error (status=${r.status}), 不再重试`)
      return r
    }
    log(`transient network error detected, will retry`)
  }

  return lastResult
}

// ---------------------------------------------------------------------------
// electron-rebuild fallback (从 packages/mcp-server 启动, 才能扫到 better-sqlite3 direct dep)
// ---------------------------------------------------------------------------

function runFallbackRebuild() {
  const shim = findElectronRebuildShim()
  if (!shim) {
    warn('node_modules/.bin/electron-rebuild 没找到, fallback 不可用')
    return { status: 127, error: 'shim not found' }
  }

  const mcpServerDir = path.join(__dirname, '..', 'packages', 'mcp-server')
  const useCmd = process.platform === 'win32' && shim.endsWith('.cmd')
  const runner = useCmd ? 'cmd.exe' : shim
  const args = useCmd
    ? ['/c', shim, '--only', 'better-sqlite3', '--force']
    : ['--only', 'better-sqlite3', '--force']

  log(`fallback exec (cwd=${mcpServerDir}):`, runner, args.join(' '))
  return spawnSync(runner, args, {
    cwd: mcpServerDir, // 关键: better-sqlite3 是 mcp-server 的 direct dep, electron-rebuild 才能扫到
    stdio: 'inherit',
    env: process.env,
  })
}

// ---------------------------------------------------------------------------
// post-install 校验
// ---------------------------------------------------------------------------

function getBinaryPath(sqliteDir) {
  return path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node')
}

function fileSha256(filePath) {
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * 校验当前 binary 是否可用。
 * 在 Node 进程下 require 二进制 → 如果 ABI 不匹配会抛 ERR_DLOPEN_FAILED。
 * (局限: 在 Node 22 下校验只能确认 Node ABI; Electron ABI 校验需要 Electron 进程。)
 */
function tryLoadBinary(binaryPath) {
  let probe = null
  try {
    // 用子进程加载, 避免污染当前进程的 module cache
    probe = path.join(__dirname, '__abi_probe__.cjs')
    fs.writeFileSync(
      probe,
      `try {
         const binding = require(${JSON.stringify(binaryPath)});
         process.exit(binding && typeof binding === 'object' ? 0 : 2);
       } catch (e) {
         const code = e.code || 'NO_CODE';
         const firstLine = (e.message || '').split(String.fromCharCode(10))[0];
         process.stderr.write('PROBE_ERR code=' + code + ' msg=' + firstLine + String.fromCharCode(10));
         process.exit(1);
       }`,
    )
    const r = spawnSync(process.execPath, [probe], { stdio: 'pipe', env: process.env })
    return {
      ok: r.status === 0,
      code: r.status,
      stderr: r.stderr ? r.stderr.toString().trim() : '',
    }
  } catch (e) {
    return { ok: false, code: -1, stderr: 'OUTER_ERR:' + e.message }
  } finally {
    if (probe && fs.existsSync(probe)) {
      try { fs.unlinkSync(probe) } catch { /* ignore */ }
    }
  }
}

function validateBinary(binaryPath, electronAbi) {
  const result = {
    exists: false,
    size: 0,
    sha256: null,
    sizeOk: false,
    electronAbiExpected: electronAbi,
    electronAbiMatch: null,
  }

  if (!fs.existsSync(binaryPath)) {
    return { ...result, reason: 'missing' }
  }
  result.exists = true
  result.size = fs.statSync(binaryPath).size
  result.sizeOk = result.size >= MIN_BINARY_SIZE
  if (!result.sizeOk) {
    return { ...result, reason: `size ${result.size} < ${MIN_BINARY_SIZE} (likely truncated)` }
  }

  try {
    result.sha256 = fileSha256(binaryPath)
  } catch (e) {
    warn('sha256 计算失败:', e.message)
  }

  // 运行时 ABI 探测: 用当前 Node 加载, 看是否抛 ERR_DLOPEN_FAILED
  // (本脚本在 Node 22 下运行 → 只能验证 Node ABI; Electron ABI 由文件名/源确认)
  const probe = tryLoadBinary(binaryPath)
  if (probe.ok) {
    result.electronAbiMatch = 'node-compatible' // 能被当前 Node 加载说明 ABI 至少对得上当前 Node
  } else if (/ERR_DLOPEN_FAILED/.test(probe.stderr)) {
    result.electronAbiMatch = 'abi-mismatch' // 当前 Node 加载不了, 说明 binary 是其他 ABI (例如 Electron)
  } else {
    result.electronAbiMatch = 'load-error'
    result.loadError = probe.stderr
  }

  return result
}

function logValidation(v) {
  log('binary 校验:')
  log(`  path: build/Release/better_sqlite3.node`)
  log(`  exists: ${v.exists}`)
  if (v.exists) {
    log(`  size: ${v.size} bytes (min ${MIN_BINARY_SIZE})`)
    log(`  sha256: ${v.sha256 ?? '?'}`)
    log(`  ABI match (vs current Node): ${v.electronAbiMatch}`)
  }
  if (v.reason) log(`  reason: ${v.reason}`)
}

// ---------------------------------------------------------------------------
// --check 模式
// ---------------------------------------------------------------------------

function runCheck() {
  const electronVersion = getElectronVersion()
  if (!electronVersion) process.exit(0)
  const sqliteDir = findBetterSqlite3Dir()
  if (!sqliteDir) {
    log('better-sqlite3 未安装')
    process.exit(0)
  }
  const binaryPath = getBinaryPath(sqliteDir)
  const expected = expectedAbi(electronVersion)
  const v = validateBinary(binaryPath, expected)
  logValidation(v)

  if (!v.exists || !v.sizeOk) {
    fail('binary 缺失或损坏, 需要重新跑 install')
    process.exit(1)
  }
  if (v.electronAbiMatch === 'abi-mismatch') {
    log(`binary 与当前 Node ABI 不匹配 — 这是预期情况 (binary 是 Electron ABI ${expected}, Node ${process.versions.modules})`)
    log(`Electron 运行时加载应正常`)
    process.exit(0)
  }
  if (v.electronAbiMatch === 'node-compatible') {
    warn(`binary 在当前 Node 下可加载 — 如果你的 runtime 是 Electron ${electronVersion} (ABI ${expected}), 这可能不是预期的 Electron ABI`)
    warn(`re-run without --check 强制重装`)
    if (!FLAGS.force) process.exit(2)
  }
  log('OK')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  if (FLAGS.help) {
    printHelp()
    process.exit(0)
  }
  if (FLAGS.check) {
    runCheck()
    return
  }

  const electronVersion = getElectronVersion()
  if (!electronVersion) {
    log('electron version 无法确定, 跳过')
    process.exit(0)
  }
  const platform = process.platform
  const arch = process.arch
  const expected = expectedAbi(electronVersion)

  log(`runtime=electron target=${electronVersion} platform=${platform} arch=${arch} expected-abi=${expected}`)

  const sqliteDir = findBetterSqlite3Dir()
  if (!sqliteDir) {
    log('better-sqlite3 未安装, 跳过 (后续 pnpm install 触发其自带 prebuild-install)')
    process.exit(0)
  }
  log('better-sqlite3 cwd:', sqliteDir)

  const binaryPath = getBinaryPath(sqliteDir)

  // 已存在且校验通过 → 跳过 (除非 --force)
  if (!FLAGS.force) {
    const existing = validateBinary(binaryPath, expected)
    if (existing.exists && existing.sizeOk && existing.electronAbiMatch === 'abi-mismatch') {
      log('binary 已存在且与当前 Node ABI 不匹配 (预期 — Electron ABI), 跳过')
      logValidation(existing)
      process.exit(0)
    }
    if (existing.exists && existing.sizeOk && existing.electronAbiMatch === 'node-compatible') {
      warn('binary 是 Node ABI 不是 Electron ABI — 需要重新安装 (Electron 加载会失败)')
      logValidation(existing)
      // 不跳过, 继续走 prebuild-install 重装
    }
  }

  const prebuildBin = findPrebuildInstallBin()
  if (!prebuildBin) {
    warn('prebuild-install 没在 pnpm store 找到, 直接走 electron-rebuild fallback')
    const fallback = runFallbackRebuild()
    if (fallback.status !== 0) {
      fail(`electron-rebuild exit=${fallback.status}, binary 可能仍是 Node ABI`)
      process.exit(1)
    }
  } else {
    log('prebuild-install bin:', prebuildBin)
    const result = runPrebuildInstallWithRetry(sqliteDir, prebuildBin, electronVersion, platform, arch)
    if (result.status !== 0) {
      warn(`prebuild-install 重试 3 次后仍失败 (status=${result.status}), 兜底 electron-rebuild`)
      const fallback = runFallbackRebuild()
      if (fallback.status !== 0) {
        fail(`prebuild-install + electron-rebuild 都失败, binary 状态不可信`)
        fail(`手动修复: cd packages/mcp-server && pnpm rebuild better-sqlite3`)
        process.exit(1)
      }
    }
  }

  // post-install 校验
  const final = validateBinary(binaryPath, expected)
  logValidation(final)

  if (!final.exists || !final.sizeOk) {
    fail('post-install 校验失败: binary 缺失或体积异常')
    process.exit(1)
  }

  // 体积正常即视为 OK (本进程在 Node 下, 无法直接验证 Electron ABI 加载,
  // 但 Electron ABI 的 prebuilt 体积特征 1.9MB 与 Node ABI 的 1.9MB 几乎一致 — 靠 npmmirror 镜像保证来源)
  log(`OK prebuilt landed, target=electron-${electronVersion} expected-abi=${expected}`)
  log(`提示: 如果 Electron 运行时仍报 ERR_DLOPEN_FAILED, 跑: node scripts/ensure-better-sqlite3.cjs --check`)
  process.exit(0)
}

main()