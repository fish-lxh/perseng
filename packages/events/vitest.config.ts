import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * vitest config for @promptx/events
 *
 * 给 src/* 提供 `~/` alias，匹配 tsup 构建时的处理（一致行为）。
 */
export default defineConfig({
  resolve: {
    alias: [
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
        inline: ['better-sqlite3'],
      },
    },
  },
})
