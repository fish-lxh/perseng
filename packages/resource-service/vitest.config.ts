import { defineConfig } from 'vitest/config'

/**
 * vitest config for @promptx/resource-service
 *
 * KNUTH-FEAT 2026-07-11 G2.2: extensionAlias 让 .js 解析到 .ts, 跟
 * packages/core 一致模式。
 */
export default defineConfig({
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
  test: {
    // ResourceListWindow 等大文件的真实集成不需要在这里跑
    // 单测只验证 Repository 与 Service 的纯逻辑分支
    environment: 'node',
  },
})
