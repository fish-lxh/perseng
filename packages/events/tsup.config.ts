import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/EventBus.ts',
    'src/EventStore.ts',
    'src/EventStoreAttacher.ts',
    'src/types.ts',
    'src/Projection.ts',
    'src/replay.ts',
    'src/audit.ts',
    'src/ipc-contract.ts',
    'src/instance.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  outDir: 'dist',
  splitting: false,
  // workspace 依赖和原生模块 — 运行时由宿主解析
  external: [
    '@promptx/logger',
    'better-sqlite3',
    'mitt',
  ],
})
