import { defineConfig } from 'vitest/config'

/**
 * vitest config for @promptx/mcp-workspace-host
 *
 * KNUTH-FEAT 2026-07-11 G2.1: extensionAlias 让测试里的 .js import
 * 解析到 .ts 源 (跟 packages/core 一致模式)。
 */
export default defineConfig({
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
})
