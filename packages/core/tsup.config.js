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
    toolx: 'src/toolx/index.ts'
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
    // 复制 ESM wrapper 文件
    console.log('Copying ESM wrapper...')
    fs.copyFileSync('./src/index.esm.js', './dist/index.mjs')
    console.log('ESM wrapper copied to dist/index.mjs')
  }
})