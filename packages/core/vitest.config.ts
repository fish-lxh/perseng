import { defineConfig } from 'vitest/config'

/**
 * vitest config for packages/core
 *
 * P0 step 0B.3:
 * - extensionAlias 让 .js 测试/import 解析到 .ts 源 (rolex/...)
 * - server.deps.inline 让 vi.mock('os') 拦截 RoleLifecycle.js (CJS) 的 require('os')
 */
export default defineConfig({
  resolve: {
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
