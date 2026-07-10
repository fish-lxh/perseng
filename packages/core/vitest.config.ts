import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * vitest config for packages/core
 *
 * P0 step 0B.3:
 * - extensionAlias 让 .js 测试/import 解析到 .ts 源 (rolex/...)
 * - server.deps.inline 让 vi.mock('os') 拦截 RoleLifecycle.js (CJS) 的 require('os')
 *
 * KNUTH-FIX 2026-07-10: 加 ~ alias — 与 tsup.config.js 一致，
 * 把 src/resource/protocols/PackageProtocol.js 等里的
 * `require('~/utils/DirectoryService')` 在 vitest 里也解析到 packages/core/src。
 */
export default defineConfig({
  resolve: {
    alias: [
      // KNUTH-FIX 2026-07-10: 用数组形式（带 find/replacement）才能让 vite-node
      // 同时处理 ESM import 和 CJS require() 里的 ~ 前缀。对象形式只对 import 生效。
      { find: /^~\/(.*)$/, replacement: path.resolve(__dirname, 'src') + '/$1' },
      { find: /^~$/, replacement: path.resolve(__dirname, 'src') },
    ],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  test: {
    server: {
      deps: {
        inline: ['node:os', 'os'],
      },
    },
  },
})
