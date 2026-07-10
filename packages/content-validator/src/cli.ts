#!/usr/bin/env node
/**
 * validate-content CLI
 *
 * 用法：
 *   validate-content                       扫描 packages/resource/resources，对照 packages/resource/dist/registry.json
 *   validate-content --strict              任何 unresolved 退出码 1
 *   validate-content --warn-unknown-protocol  迁移期：unknown-protocol 降级为 warning
 *   validate-content --json                输出 JSON 给 CI
 *   validate-content --root <dir>          指定工作根目录
 */

import { Command } from 'commander'

import { validate, renderText, renderJson } from './index.js'

const program = new Command()

program
  .name('validate-content')
  .description('Validate DPML content references against the registry')
  .option('--strict', 'exit 1 on any unresolved reference', false)
  .option('--warn-unknown-protocol', 'downgrade unknown-protocol errors to warnings (migration mode)', false)
  .option('--json', 'output machine-readable JSON instead of text')
  .option('--root <dir>', 'working root directory', process.cwd())
  .option('--resources <dir>', 'resources directory (relative to root)', 'packages/resource/resources')
  .option('--registry <path>', 'registry JSON path (relative to root)', 'packages/resource/dist/registry.json')
  .action(async (opts) => {
    try {
      const report = await validate({
        rootDir: opts.root,
        resourcesDir: opts.resources,
        registryPath: opts.registry,
        strict: opts.strict,
        warnUnknownProtocol: opts.warnUnknownProtocol,
      })

      const output = opts.json ? renderJson(report) : renderText(report)
      console.log(output)

      // 退出码：
      // - strict + unresolved → 1
      // - 默认模式只输出，不 block（适合人眼 review）
      if (opts.strict && !report.ok) {
        process.exit(1)
      }
    } catch (err: any) {
      console.error('validate-content failed:', err?.message ?? err)
      process.exit(2)
    }
  })

program.parseAsync(process.argv).catch((err) => {
  console.error('validate-content crashed:', err)
  process.exit(2)
})
