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
  // KNUTH-FIX 2026-07-09: createPackage 后 listPackage 偶发读到旧 asar
  // (race condition: 文件已经原子 rename 过去, 但 Node FS cache / Windows
  // mmap 还没刷新)。最多重试 5 次, 每次间隔 100ms。
  const stubBackVerify = STUB_REL_PATH_IN_ASAR.replace(/\//g, '\\')
  const stubTargetVerify = '\\' + stubBackVerify
  let verified = false
  for (let i = 0; i < 5; i++) {
    const verifyList = asar.listPackage(asarPath, { isPack: true })
    verified = verifyList.some(
      (p) => p === stubTargetVerify || p.endsWith(' ' + stubTargetVerify) || p.endsWith(':' + stubTargetVerify)
    )
    if (verified) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (verified) {
    console.log('[inject-stub] OK: stub verified in repacked asar at', stubTargetVerify)
  } else {
    console.error('[inject-stub] FAIL: stub missing after repack.')
    const verifyList = asar.listPackage(asarPath, { isPack: true })
    const sample = verifyList.filter((p) => p.includes('@promptx')).slice(0, 10)
    console.error('[inject-stub]   sample @promptx entries:', sample)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('[inject-stub] FATAL:', err instanceof Error ? err.stack : err)
  process.exitCode = 1
})
