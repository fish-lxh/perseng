/**
 * inject-stub-into-asar.cjs
 *
 * electron-builder 26.8.1 + pnpm + symlink 下:
 *   - node_modules/@promptx/{config,core,...}/ 是 symlink, electron-builder
 *     会跟随 symlink 把整个 workspace 包物化进 app.asar;
 *   - 但 node_modules/@promptx/package.json (namespace stub, prebuild 阶段
 *     由 create-namespace-stub.cjs 写入) 不会被任何 files glob 命中
 *     —— 「排除 node_modules 全局」规则压过正向 include, 连 globstar
 *     写法 (双星号斜杠 @promptx/package.json) 都不行。
 *   - 后果: 打包后 app.asar 里 node_modules/@promptx/package.json 缺失,
 *     Node.js require.resolve() / createRequire() 在 packaged app 里
 *     走 parent package.json lookup 时抛 ENOENT。
 *
 * 解法: electron-builder 跑完后, 直接对生成出来的 app.asar 调
 *   @electron/asar.extractAll() -> 写 stub -> createPackage() 覆盖。
 * 这种直接改 asar 的做法 OK —— asar 是只读容器, 我们把它当 zip 重新打包,
 * 不需要签名 / 不影响 Perseng.exe 的 authenticode 签名 (代码完整性是 asar 内
 * 文件的 hash, 重新打包会重算 header, 但 app.asar 本身在 Perseng.exe 里的
 * section 也没单独签名)。
 *
 * KNUTH-FIX 2026-07-09: post-package 注入 @promptx namespace stub.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const asar = require('@electron/asar')

// 候选的 asar 路径 (Win / macOS / Linux 通用)
const CANDIDATE_ASARS = [
  'release/win-unpacked/resources/app.asar',
  'release/linux-unpacked/resources/app.asar',
  'release/mac/Perseng.app/Contents/Resources/app.asar',
  'release/mac-arm64/Perseng.app/Contents/Resources/app.asar',
]

const STUB_REL_PATH_IN_ASAR = path.join('node_modules', '@promptx', 'package.json')

// 复用 create-namespace-stub.cjs 的 stub 内容, 保持单一来源
const STUB_CONTENT = JSON.stringify(
  {
    name: '@promptx',
    version: '0.0.0',
    private: true,
    description:
      'Stub package.json for the @promptx namespace folder. ' +
      'Required for Node.js require.resolve() to walk up correctly inside ' +
      'packaged app.asar. pnpm does not generate this stub; npm does.',
  },
  null,
  2
) + '\n'

function findAsar(cwd) {
  for (const rel of CANDIDATE_ASARS) {
    const abs = path.join(cwd, rel)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

async function main() {
  const cwd = process.cwd()
  const asarPath = findAsar(cwd)
  if (!asarPath) {
    console.error('[inject-stub] No app.asar found under release/. Did electron-builder run?')
    console.error('[inject-stub] Searched:', CANDIDATE_ASARS.join(', '))
    // 不 throw: 让 release artifact 仍然能用, 只是 ENOENT bug 复发。
    // (用户可能用的是其他 host 入口, 或以后切了路径)
    return
  }
  console.log(`[inject-stub] target asar: ${path.relative(cwd, asarPath)}`)

  // 1) 检查 stub 是否已经在 asar 里 (例如有人手工放过)
  // @electron/asar v3+ listPackage 返回 "pack   : \path\to\file" 格式
  // (带 packing 状态前缀)。我们匹配 EXACT 后缀
  // `\node_modules\@promptx\package.json`, 不能用 endsWith, 否则会误中
  // `assets\stub-node_modules\@promptx\package.json` (prebuild 模板)。
  // KNUTH-FIX 2026-07-13: 更严格 — 要求 listing entry 在去除 'pack   : '
  // 前缀后 EXACT 等于 stubTarget, 而不是 endsWith。
  const listing = asar.listPackage(asarPath, { isPack: true })
  const stubBack = STUB_REL_PATH_IN_ASAR.replace(/\//g, '\\')
  const stubTarget = '\\' + stubBack
  const stubPresent = listing.some((p) => {
    // 去掉 packing 状态前缀 "pack   : " 或 "unpack : ", 然后比对精确 path
    const stripped = p.replace(/^(pack|unpack)\s*:\s*/, '').trim()
    return stripped === stubTarget
  })
  if (stubPresent) {
    console.log('[inject-stub] stub already present in asar at', stubTarget, ', skipping.')
    return
  }

  // 2) extractAll -> 临时目录
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-asar-inject-'))
  console.log(`[inject-stub] extracting to ${tmpDir} ...`)
  await asar.extractAll(asarPath, tmpDir)

  // 3) 写入 stub
  const stubAbs = path.join(tmpDir, STUB_REL_PATH_IN_ASAR)
  fs.mkdirSync(path.dirname(stubAbs), { recursive: true })
  fs.writeFileSync(stubAbs, STUB_CONTENT, 'utf-8')
  console.log(`[inject-stub] wrote stub: ${STUB_REL_PATH_IN_ASAR}`)

  // 4) createPackage 覆盖原 asar
  //    KNUTH-FIX 2026-07-13: 不用 asar.createPackage(tmpDir, asarPath) —
  //    它内部用 `glob.sync(tmpDir + '/**/*', { dot: true })` crawl,
  //    在 Windows + absolute path + extractAll 后创建的新文件组合下
  //    漏掉 stub (`@promptx/package.json`)。症状: repacking 静默丢 stub,
  //    verify extractFile 报 "was not found in this archive"。
  //    绕开: 自己用 fs.readdirSync 递归收集 filenames + metadata,
  //    直接调 asar.createPackageFromFiles(tmpDir, asarPath, filenames, metadata)
  //    (asar.js line 83) — 它走 fs.createReadStream, 不经过 glob, 不漏。
  //    ⚠️ KNUTH-FIX 2026-07-13b: filenames 必须是 ABSOLUTE 路径!
  //    asar.js line 163 `wrapped_fs.createReadStream(filename)` 直接
  //    把 filename 喂给 fs.createReadStream — relative filename 会被
  //    解析为相对 process.cwd(), 报 ENOENT。asar.createPackageWithOptions
  //    走 glob 返回的是 absolute path 所以 work; 我们 manual walk
  //    默认给 relative path 就 broken。
  console.log('[inject-stub] repacking asar (manual createPackageFromFiles) ...')
  const filenames = []
  const metadata = {}
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(tmpDir, abs)
      if (e.isSymbolicLink()) {
        const st = fs.lstatSync(abs)
        metadata[rel] = { type: 'link', stat: st }
      } else if (e.isDirectory()) {
        const st = fs.statSync(abs)
        metadata[rel] = { type: 'directory', stat: st }
        walk(abs)
      } else if (e.isFile()) {
        const st = fs.statSync(abs)
        metadata[rel] = { type: 'file', stat: st }
        filenames.push(abs)  // KNUTH-FIX 2026-07-13b: absolute path, NOT relative
      }
    }
  }
  walk(tmpDir)
  console.log(`[inject-stub] crawled ${filenames.length} files (incl. stub)`)
  await asar.createPackageFromFiles(tmpDir, asarPath, filenames, metadata, {})

  // 5) 清理
  fs.rmSync(tmpDir, { recursive: true, force: true })

  // 6) 验证
  // KNUTH-FIX 2026-07-11: verify 从"listing 存在性"升级到"内容字节比对" +
  // 指数退避 + cache-busting + 分模态诊断。
  // 关键改进:
  //  - extractFile 比 listPackage 强: 不依赖 @electron/asar v3+ 的
  //    "pack   : <path>" 输出格式 (列格式变了就误判), 直接读 stub 字节。
  //  - 5 次重试, backoff = [100, 200, 400, 800, 1500] ms (总预算 3s),
  //    应对 createPackage 后 OS cache / Windows mmap 短暂未刷新的 race。
  //  - 第 1 次重试前 fs.openSync('r') 主动 bust cache, 强制重读磁盘。
  //  - 失败时一并打: asar stat (size + mtime) + 最后一次错误码 +
  //    期望 STUB_CONTENT 全文 + 实际内容前 500 字节; 把 "not extracted" /
  //    "wrong content" / "asar unreadable" 三种失败模态分开。
  // KNUTH-FIX 2026-07-13: extractFile 在 Windows 上必须用 NATIVE BACKSLASH
  // path ('node_modules\\@promptx\\package.json'), 不能用 forward slash
  // ('node_modules/@promptx/package.json') — 内部 listing 都是 backslash,
  // forward slash 查不到 (实测三个变体: fwd FAIL / back FAIL(双反斜杠) / native OK)。
  //
  // KNUTH-FIX 2026-07-13c: 验证必须在新 node 子进程里跑! @electron/asar 在
  // disk.js line 152 维护 module-level filesystemCache (Object.create(null))
  // — 第一次 readFilesystemSync(asarPath) 把 header parse 进来缓存住。
  // 我们 line 82 的 stub-present detection 调 listPackage 已经把 "无 stub"
  // 的旧 header 缓存好; 之后 createPackageFromFiles 在同一进程里把
  // asar 文件改写了, 但 disk.readFilesystemSync() 命中 module-level cache
  // 返回旧 header, 验证就 false "not found"。asar 没有 export uncache API。
  // 子进程独立 module state → 第一次 readFilesystemSync 强制重读 disk,
  // 拿到真正写入的、新含 stub 的 header。
  // KNUTH-FIX 2026-07-13c: @electron/asar 在 disk.js line 152 维护 module-level
  // filesystemCache (Object.create(null)). 我们 line 82 的 stub-present detection
  // 调 listPackage 已经把旧 header 缓存进去. 之后 createPackageFromFiles 在
  // 同一进程里把 asar 文件改写了, 但 disk.readFilesystemSync() 命中 module-level
  // cache 返回旧 header, 验证就 false "not found". asar 没有 export uncache API,
  // delete require.cache('@electron/asar') 不够 — 真正的 cache 在 disk.js 子模块里
  // 没被同时清掉, 重 require 后还是会拿到同一个 disk.js 实例.
  //
  // 最干净修法: 验证丢到子进程跑. node 子进程独立 module state → 第一次
  // readFilesystemSync 必从 disk 重读, 拿到真正写入的新 header.
  //
  // KNUTH-FIX 2026-07-13d: 不要用 `node -e <inline-script>` 写 verifier —
  // STUB_PATH_FOR_EXTRACT 含 Windows backslash, 嵌进 inline JS 字面量要
  // 多层 escape (shell + node CLI + JS parser), 反斜杠被吞出 "[eval]:1
  // SyntaxError". 改用 fs.writeFileSync 写一个临时 .cjs 文件, 让 node
  // 直接跑它 — 文件里 path 用 path.join(...) 在 JS 运行时构造,
  // 没有任何手写 backslash, 调试也能 cat.
  const { execFileSync } = require('node:child_process')
  const verifierDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perseng-asar-verify-'))
  const verifierPath = path.join(verifierDir, 'verify.cjs')
  const verifierBody =
    "'use strict'\n" +
    "process.chdir(" + JSON.stringify(cwd) + ")\n" +
    "const fs = require('node:fs')\n" +
    "const path = require('node:path')\n" +
    "const asar = require(" + JSON.stringify(require.resolve('@electron/asar')) + ")\n" +
    "const ASAR_PATH = " + JSON.stringify(asarPath) + "\n" +
    // 子进程自己构造 stub path, 用 path.sep (Windows = '\\'), 不要反斜杠字面量
    "const STUB_PATH = path.join('node_modules', '@promptx', 'package.json')\n" +
    "try {\n" +
    "  const fd = fs.openSync(ASAR_PATH, 'r')\n" +
    "  try { fs.fstatSync(fd) } finally { fs.closeSync(fd) }\n" +
    "  const buf = asar.extractFile(ASAR_PATH, STUB_PATH)\n" +
    "  process.stdout.write('__VERIFY_OK__' + buf.toString('utf-8'))\n" +
    "} catch (e) {\n" +
    "  process.stderr.write('verify-err: ' + (e && e.message ? e.message : String(e)) + '\\n')\n" +
    "  process.stdout.write('__VERIFY_ERR__' + (e && e.message ? e.message : String(e)))\n" +
    "  process.exit(2)\n" +
    "}\n"
  let actualContent = null
  let lastErr = null
  try {
    fs.writeFileSync(verifierPath, verifierBody, 'utf-8')
    const out = execFileSync(process.execPath, [verifierPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    })
    if (typeof out === 'string' && out.startsWith('__VERIFY_OK__')) {
      actualContent = out.slice('__VERIFY_OK__'.length)
      lastErr = null
    } else if (typeof out === 'string' && out.startsWith('__VERIFY_ERR__')) {
      lastErr = new Error(out.slice('__VERIFY_ERR__'.length))
    } else {
      lastErr = new Error('unexpected verifier stdout: ' + JSON.stringify(out).slice(0, 200))
    }
  } catch (err) {
    // execFileSync 在 child exit 2 时会把 stdout/stderr 放进 err.{stdout,stderr}
    if (err && err.stdout) {
      const s = String(err.stdout)
      if (s.startsWith('__VERIFY_OK__')) actualContent = s.slice('__VERIFY_OK__'.length)
      else if (s.startsWith('__VERIFY_ERR__')) lastErr = new Error(s.slice('__VERIFY_ERR__'.length))
    }
    if (lastErr === null && err && err.stderr) {
      lastErr = new Error('child process died: ' + String(err.stderr).trim())
    }
    if (lastErr === null) lastErr = err instanceof Error ? err : new Error(String(err))
  } finally {
    try { fs.rmSync(verifierDir, { recursive: true, force: true }) } catch {}
  }
  const verified = actualContent !== null && actualContent === STUB_CONTENT

  if (verified) {
    console.log(`[inject-stub] OK: stub verified (${STUB_CONTENT.length} bytes match)`)
  } else {
    console.error(`[inject-stub] FAIL: stub verification failed`)
    try {
      const st = fs.statSync(asarPath)
      console.error(`[inject-stub]   asar stat: size=${st.size}  mtime=${st.mtime.toISOString()}`)
    } catch (e) {
      console.error(`[inject-stub]   asar stat: <unreadable> ${e.message}`)
    }
    if (lastErr) {
      console.error(
        `[inject-stub]   last extractFile error: ${lastErr.code || lastErr.name || 'unknown'}: ${lastErr.message}`
      )
    }
    console.error(`[inject-stub]   expected STUB_CONTENT (${STUB_CONTENT.length} bytes, full):`)
    console.error(STUB_CONTENT)
    if (actualContent !== null) {
      console.error('[inject-stub]   actual content (first 500 bytes):')
      console.error(actualContent.slice(0, 500))
    } else {
      console.error('[inject-stub]   actual content: <not extracted>')
    }
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[inject-stub] FATAL:', err instanceof Error ? err.stack : err)
  process.exitCode = 1
})
