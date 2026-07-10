/**
 * 公共 API（编程调用）
 */

import { extractRefs, type ExtractOptions } from './extract.js'
import { loadRegistry, resolveRefs } from './resolve.js'
import { buildReport, renderText, renderJson } from './report.js'
import type { ValidateReport } from './types.js'

export interface ValidateCliOptions {
  /** 工作根目录（默认 process.cwd()） */
  rootDir?: string
  /** 资源目录（相对 rootDir），默认 packages/resource/resources */
  resourcesDir?: string
  /** registry JSON 路径（相对 rootDir），默认 packages/resource/dist/registry.json */
  registryPath?: string
  /** 严格模式：任何 unresolved 退出码 1 */
  strict?: boolean
  /** 警告模式：unknown-protocol 警告而非失败（迁移期用） */
  warnUnknownProtocol?: boolean
}

/**
 * 主入口：扫描 + 解析 + 报告
 *
 * 返回 ValidateReport，调用方自行决定如何渲染/退出。
 */
export async function validate(opts: ValidateCliOptions = {}): Promise<ValidateReport> {
  const rootDir = opts.rootDir ?? process.cwd()
  const resourcesDir = opts.resourcesDir ?? 'packages/resource/resources'
  const registryPath = opts.registryPath ?? 'packages/resource/dist/registry.json'

  const refs = await extractRefs({ rootDir, dir: resourcesDir })
  const registry = await loadRegistry(registryPath)
  const results = resolveRefs(refs, registry)
  const report = buildReport(refs, results, rootDir)

  // warn-unknown-protocol 模式：把所有 unknown-protocol 降级为 ok
  if (opts.warnUnknownProtocol) {
    const newResults = report.results.map((r, i) => {
      if (r && r.kind === 'unknown-protocol') {
        const ref = report.refs[i]
        return { kind: 'ok' as const, protocol: r.protocol, entry: { id: ref?.id ?? '', reference: '' } }
      }
      return r
    })
    report.results = newResults
    // 重算摘要
    const ok = newResults.filter((r) => r && r.kind === 'ok').length
    const unknownProtocols = 0
    const unknownIds = newResults.filter((r) => r && r.kind === 'unknown-id').length
    const syntaxErrors = newResults.filter((r) => r && r.kind === 'syntax-error').length
    const parseErrors = newResults.filter((r) => r && r.kind === 'parse-error').length
    const unresolved = unknownIds + syntaxErrors + parseErrors
    report.ok = unresolved === 0
    report.summary = {
      total: report.refs.length,
      ok,
      syntaxErrors,
      unknownProtocols,
      unknownIds,
      parseErrors,
    }
  }

  return report
}

export { renderText, renderJson }
export type { ValidateReport }
export type { ExtractOptions }
