/**
 * KNUTH-FEAT 2026-07-11: 批量生成 core/src 下所有 .js 的 .d.ts skeleton
 *
 * 扫描 packages/core/src 下所有 .js，读取 module.exports 形态，
 * 生成对应的 .d.ts（any 类型）让 TS 调用方能正确 type check。
 *
 * 用法：
 *   node scripts/gen-dts-skeletons.mjs            # 生成所有未存在 .d.ts 的
 *   node scripts/gen-dts-skeletons.mjs --force    # 覆盖已有 .d.ts
 *   node scripts/gen-dts-skeletons.mjs --dry-run  # 只列出会生成什么
 *
 * 输出形态（按 module.exports 形态分支）：
 *   1. module.exports = X              → export = X + declare class X { [k: string]: any }
 *   2. module.exports = X; X.Y = Y     → export = X + declare namespace X { Y: any }
 *   3. module.exports = { ... }        → export = { ... }
 *   4. 没找到 module.exports 形态       → export = any
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src')
const FORCE = process.argv.includes('--force')
const DRY_RUN = process.argv.includes('--dry-run')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      out.push(...walk(p))
    } else if (p.endsWith('.js')) {
      out.push(p)
    }
  }
  return out
}

/**
 * 分析 module.exports 形态
 * 返回 { kind: 'class' | 'namespace' | 'object' | 'unknown', name: string, members?: string[] }
 */
function analyzeExports(content) {
  // Pattern 1: module.exports = ClassName (单 class)
  const singleClass = content.match(/^module\.exports\s*=\s*([A-Z]\w*)\s*;?$/m)
  if (singleClass && !content.includes(`${singleClass[1]}.`)) {
    return { kind: 'class', name: singleClass[1] }
  }
  // Pattern 1b: module.exports = ClassName + module.exports.X = Y (class with attached)
  if (singleClass) {
    const attached = []
    const attMatch = content.matchAll(/^module\.exports\.(\w+)\s*=\s*(\w+)/gm)
    for (const m of attMatch) attached.push(m[1])
    if (attached.length > 0) {
      return { kind: 'class', name: singleClass[1], members: attached }
    }
  }

  // Pattern 2: module.exports = { A, B, C } (对象字面量)
  const objMatch = content.match(/^module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?\s*$/m)
  if (objMatch) {
    const keys = []
    const keyMatch = objMatch[1].matchAll(/^\s*(\w+)\s*[,=:]/gm)
    for (const m of keyMatch) keys.push(m[1])
    return { kind: 'object', name: keys[0] || 'Exports', members: keys }
  }

  // Pattern 3: 没找到 — fallback
  return { kind: 'unknown', name: 'Exports' }
}

function generateDts(jsPath, content) {
  const info = analyzeExports(content)
  const banner = `// KNUTH-FEAT 2026-07-11: 自动生成的 .d.ts skeleton。\n// 真实类型请逐步替换 (Phase 2b — 手工优化关键文件)。\n// 来源: ${relative(SRC, jsPath).replace(/\\/g, '/')}\n`
  const anyClass = '  [k: string]: unknown\n'

  switch (info.kind) {
    case 'class': {
      const ns = info.members
        ? info.members.map((m) => `  ${m}: unknown`).join('\n') + '\n'
        : ''
      return `${banner}declare class ${info.name} {\n${anyClass}}\ndeclare namespace ${info.name} {\n${ns}}\nexport = ${info.name}\n`
    }
    case 'object': {
      const fields = info.members.map((m) => `  ${m}: unknown`).join('\n')
      return `${banner}declare const _exports: {\n${fields}\n}\nexport = _exports\n`
    }
    default:
      return `${banner}declare const _default: { [k: string]: unknown }\nexport = _default\n`
  }
}

function main() {
  const files = walk(SRC)
  let generated = 0
  let skipped = 0
  for (const jsPath of files) {
    // 跳过 node_modules / dist / scripts
    if (jsPath.includes('node_modules') || jsPath.includes('dist') || jsPath.includes('scripts')) continue
    const dtsPath = jsPath.replace(/\.js$/, '.d.ts')
    if (existsSync(dtsPath) && !FORCE) {
      skipped++
      continue
    }
    const content = readFileSync(jsPath, 'utf8')
    // 跳过只有 module.exports 的纯数据文件（含 .esm.js wrappers）
    if (jsPath.endsWith('.esm.js')) continue
    const dts = generateDts(jsPath, content)
    if (DRY_RUN) {
      console.log(`[would gen] ${relative(SRC, dtsPath)}`)
    } else {
      writeFileSync(dtsPath, dts)
      console.log(`[generated] ${relative(SRC, dtsPath)}`)
    }
    generated++
  }
  console.log(`\nTotal: ${generated} generated, ${skipped} skipped`)
}

main()