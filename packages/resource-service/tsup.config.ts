import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  outDir: 'dist',
  splitting: false,
  // KNUTH-FEAT 2026-07-11 G2.2: shims 让 import.meta.url 在 CJS bundle 里也指向
  // 真实的 fileURL, createRequire(import.meta.url) 才能解析 @promptx/core/pouch
  shims: true,
  external: ['@promptx/core', '@promptx/core/pouch', 'fs-extra', 'node:os', 'node:path', 'node:fs/promises']
})
