import { defineConfig } from 'tsup'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cognition: 'src/cognition/index.ts',
    resource: 'src/resource/index.ts',
    toolx: 'src/toolx/index.ts',
    // KNUTH-FEAT 2026-07-11: 暴露子路径给 apps/desktop + 后续 ESM 消费者
    pouch: 'src/pouch/index.ts',
    rolex: 'src/rolex/index.ts',
    // KNUTH-FEAT 2026-07-11: Phase 3d — 迁 .js → .ts, tsup entry 跟 pouch/rolex 风格一致。
    project: 'src/project/index.ts',
    actAs: 'src/actAs.ts'
  },
  format: ['cjs'], // 只构建 CommonJS
  dts: true, // P0 step 0B.6: packages/core 全部 .ts, 启用类型声明
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: true, // 自动添加 __dirname, __filename, import.meta.url 等 shims
  cjsInterop: true, // 更好的 CJS/ESM 互操作性
  platform: 'node', // 重要：指定平台为 node
  target: 'node14',
  external: [
    '@modelcontextprotocol/sdk',
    '@promptx/logger',
    '@promptx/events',
    '@promptx/resource',
    'chevrotain',
    'chalk',
    'js-yaml',
    'mermaid',
    'zod',
    'fastmcp',
    'fs-extra',
    'rolexjs',
    '@rolexjs/core',
    '@rolexjs/local-platform',
    '@rolexjs/parser',
    '@rolexjs/prototype',
    '@rolexjs/system',
    'resourcexjs',
    // ... 其他外部依赖
  ],
  noExternal: [], // 不强制打包任何模块
  esbuildOptions(options) {
    options.alias = {
      '~': path.resolve(__dirname, 'src')
    }
  },
  onSuccess: async () => {
    // KNUTH-FEAT 2026-07-11: 通用 ESM wrapper 复制 — 对所有 entry 尝试找 {name}.esm.js
    const entries = ['index', 'cognition', 'resource', 'toolx', 'pouch', 'rolex', 'project', 'actAs']
    for (const name of entries) {
      const wrapper = `./src/${name}.esm.js`
      if (fs.existsSync(wrapper)) {
        fs.copyFileSync(wrapper, `./dist/${name}.mjs`)
        console.log(`ESM wrapper copied: dist/${name}.mjs`)
      }
    }
  }
})