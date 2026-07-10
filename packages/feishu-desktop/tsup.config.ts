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
  // agentxjs + @larksuiteoapi/node-sdk 都是运行时依赖, 留作 external
  external: ['agentxjs', '@larksuiteoapi/node-sdk']
})