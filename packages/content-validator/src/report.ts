/**
 * 报告渲染：人类可读文本 + 机器可读 JSON
 */

import type { Ref, ResolveResult, ValidateReport } from './types.js'

/**
 * 计算报告摘要
 */
export function summarize(refs: Ref[], results: ResolveResult[]): ValidateReport['summary'] {
  let ok = 0, syntaxErrors = 0, unknownProtocols = 0, unknownIds = 0, parseErrors = 0
  for (const r of results) {
    switch (r.kind) {
      case 'ok': ok++; break
      case 'syntax-error': syntaxErrors++; break
      case 'unknown-protocol': unknownProtocols++; break
      case 'unknown-id': unknownIds++; break
      case 'parse-error': parseErrors++; break
    }
  }
  return { total: refs.length, ok, syntaxErrors, unknownProtocols, unknownIds, parseErrors }
}

/**
 * 生成 ValidateReport
 */
export function buildReport(
  refs: Ref[],
  results: ResolveResult[],
  rootDir: string,
): ValidateReport {
  const summary = summarize(refs, results)
  const unresolved = summary.syntaxErrors + summary.unknownProtocols + summary.unknownIds + summary.parseErrors
  return {
    ok: unresolved === 0,
    refs,
    results,
    summary,
    generatedAt: new Date().toISOString(),
    rootDir,
  }
}

/**
 * 人类可读文本报告
 */
export function renderText(report: ValidateReport): string {
  const lines: string[] = []

  // 头部
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('  Content Contract Validation')
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  lines.push('')

  // 摘要
  const s = report.summary
  lines.push(`  Total refs:        ${s.total}`)
  lines.push(`  OK:                ${s.ok}`)
  lines.push(`  Syntax errors:     ${s.syntaxErrors}`)
  lines.push(`  Unknown protocols: ${s.unknownProtocols}`)
  lines.push(`  Unknown ids:       ${s.unknownIds}`)
  lines.push(`  Parse errors:      ${s.parseErrors}`)
  lines.push('')

  // 按文件分组 unresolved
  const unresolved: Array<{ ref: Ref; result: ResolveResult }> = []
  for (let i = 0; i < report.refs.length; i++) {
    const r = report.results[i]
    const ref = report.refs[i]
    if (r && ref && r.kind !== 'ok') unresolved.push({ ref, result: r })
  }

  if (unresolved.length === 0) {
    lines.push('  ✅ All references resolve correctly.')
  } else {
    lines.push(`  ✗ ${unresolved.length} unresolved reference${unresolved.length === 1 ? '' : 's'}`)
    lines.push('')

    // 按文件分组
    const byFile = new Map<string, Array<{ ref: Ref; result: ResolveResult }>>()
    for (const item of unresolved) {
      const f = item.ref.source.file
      if (!byFile.has(f)) byFile.set(f, [])
      byFile.get(f)!.push(item)
    }
    for (const [file, items] of byFile) {
      lines.push(`  ${file}`)
      items.sort((a, b) => a.ref.source.line - b.ref.source.line)
      for (const { ref, result } of items) {
        const tag =
          result.kind === 'unknown-protocol' ? 'UNKNOWN PROTOCOL' :
          result.kind === 'unknown-id' ? 'UNKNOWN ID' :
          result.kind === 'syntax-error' ? 'SYNTAX ERROR' :
          result.kind === 'parse-error' ? 'PARSE ERROR' :
          'UNKNOWN'
        lines.push(`    :${ref.source.line}  ${ref.raw.padEnd(40)}  →  ${tag}`)
        if (result.kind === 'unknown-protocol') {
          lines.push(`        protocols available: ${result.registered.join(', ')}`)
        } else if (result.kind === 'unknown-id') {
          lines.push(`        available ids: ${result.availableIds.slice(0, 8).join(', ')}${result.availableIds.length > 8 ? ', ...' : ''}`)
        }
      }
      lines.push('')
    }
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  return lines.join('\n')
}

/**
 * 机器可读 JSON（CI 用）
 */
export function renderJson(report: ValidateReport): string {
  return JSON.stringify(report, null, 2)
}
