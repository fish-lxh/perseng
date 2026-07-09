/**
 * create-namespace-stub.cjs
 *
 * 在 node_modules/@promptx/ 下创建一个 stub package.json，让 Node.js require.resolve()
 * 在 packaged app.asar 里能正确 walk up 找父级 package.json。
 *
 * 背景：
 *   pnpm（含 shamefully-hoist=true）不创建 namespace-level 的 package.json。
 *   npm 会自动创建（每个 @scope 目录下一个空 package.json），但 pnpm 不会。
 *   后果：asar 里 node_modules/@promptx/ 目录没有 package.json，
 *   Node.js 解析 @promptx/core / @promptx/resource 时，
 *   createRequire() / require.resolve() 走 parent package.json lookup 失败，
 *   报 ENOENT node_modules\@promptx\package.json，
 *   触发 "Failed to initialize server"。
 *
 * 解决：
 *   在 prebuild 阶段（pnpm build 之前）创建 stub。
 *   1. dev 模式：Vite 的 resolver 不需要这个 stub，但创建了无副作用。
 *   2. packaged 模式：electron-builder files: glob 包含 node_modules/，
 *      stub 会被物化进 app.asar 的 node_modules/@promptx/package.json。
 *
 * KNUTH-FIX 2026-07-09: 修 packaged EXE 启动 ENOENT 报错的根因。
 */

const fs = require('node:fs')
const path = require('node:path')

const STUB_DIR = path.join(__dirname, '..', 'node_modules', '@promptx')
const STUB_FILE = path.join(STUB_DIR, 'package.json')

const STUB_CONTENT = {
  name: '@promptx',
  version: '0.0.0',
  private: true,
  description:
    'Stub package.json for the @promptx namespace folder. ' +
    'Required for Node.js require.resolve() to walk up correctly inside ' +
    'packaged app.asar. pnpm does not generate this stub; npm does.',
}

function main() {
  try {
    fs.mkdirSync(STUB_DIR, { recursive: true })
    // 不要覆盖真实内容（防御性：如果有真实 package.json，跳过）
    if (fs.existsSync(STUB_FILE)) {
      const existing = JSON.parse(fs.readFileSync(STUB_FILE, 'utf-8'))
      if (existing.name === '@promptx' && !existing.private) {
        // 真实 package.json，跳过
        console.log(
          `[create-namespace-stub] Real @promptx/package.json exists, skipping stub.`,
        )
        return
      }
    }
    fs.writeFileSync(STUB_FILE, JSON.stringify(STUB_CONTENT, null, 2) + '\n')
    console.log(
      `[create-namespace-stub] Wrote stub: ${path.relative(process.cwd(), STUB_FILE)}`,
    )
  } catch (err) {
    console.error(
      `[create-namespace-stub] FAILED: ${err instanceof Error ? err.message : err}`,
    )
    // 不 throw：dev 模式有 stub 也行（vite 不需要），packaged 模式有 stub 才不挂。
    // 这里 fail-open 让 build 继续，由 packaged EXE 启动时再发现缺 stub。
  }
}

main()