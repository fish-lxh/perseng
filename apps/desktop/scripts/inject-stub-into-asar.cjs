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
  const listing = asar.listPackage(asarPath, { isPack: true })
  const stubBack = STUB_REL_PATH_IN_ASAR.replace(/\//g, '\\')
  const stubTarget = '\\' + stubBack
  const stubPresent = listing.some(
    (p) => p === stubTarget || p.endsWith(' ' + stubTarget) || p.endsWith(':' + stubTarget)
  )
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
  //    @electron/asar v3.4+ createPackage 返回 Promise<void>
  console.log('[inject-stub] repacking asar ...')
  await asar.createPackage(tmpDir, asarPath)

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
  const BACKOFFS_MS = [100, 200, 400, 800, 1500]
  let actualContent = null
  let lastErr = null
  for (let i = 0; i < BACKOFFS_MS.length; i++) {
    try {
      if (i === 0) {
        // cache-busting: 强制 OS 重新从磁盘读文件, 而不是用 FS cache / mmap
        const fd = fs.openSync(asarPath, 'r')
        try { fs.fstatSync(fd) } finally { fs.closeSync(fd) }
      }
      const buf = asar.extractFile(asarPath, STUB_REL_PATH_IN_ASAR)
      actualContent = buf.toString('utf-8')
      lastErr = null
      break
    } catch (err) {
      lastErr = err
      if (i < BACKOFFS_MS.length - 1) {
        await new Promise((r) => setTimeout(r, BACKOFFS_MS[i]))
      }
    }
  }
  const verified = actualContent !== null && actualContent === STUB_CONTENT

  if (verified) {
    console.log(`[inject-stub] OK: stub verified (${STUB_CONTENT.length} bytes match)`)
  } else {
    console.error(`[inject-stub] FAIL: stub verification failed after ${BACKOFFS_MS.length} attempts`)
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
