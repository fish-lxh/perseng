/**
 * discoverOptions - discover 命令的参数解析
 *
 * 独立文件以便单测：避免引入 DiscoverCommand 的依赖链（fs / ProjectManager 等）。
 *
 * KNUTH-FEAT 2026-07-04：三参支持 --all / --include-archived / --archived
 * 优先级（互斥）：--archived > --all/--include-archived > 默认（只显示 active）
 *
 * P0 step 0B.4.1: 迁 .js → .ts, 给 args/opts 强类型
 */

export interface DiscoverOptions {
  all: boolean
  includeArchived: boolean
  archived: boolean
}

/** CLI 透传的 options 对象（包含未识别字段不要紧，只挑关注的三参） */
export interface DiscoverArgsOptions {
  all?: unknown
  includeArchived?: unknown
  archived?: unknown
}

/**
 * 解析 discover 命令参数（多个 boolean 选项互斥）
 *
 * @param args 命令行参数（约定：CLI 内部保证第一个元素是 options object）
 * @returns 三个 boolean 标记
 */
export function parseDiscoverOptions(args: unknown[] | undefined): DiscoverOptions {
  const opts: DiscoverOptions = { all: false, includeArchived: false, archived: false }
  if (
    Array.isArray(args) &&
    args.length > 0 &&
    typeof args[0] === 'object' &&
    args[0] !== null
  ) {
    const o = args[0] as DiscoverArgsOptions
    opts.all = !!o.all
    opts.includeArchived = !!o.includeArchived
    opts.archived = !!o.archived
  }
  // 互斥：--archived 覆盖 --all
  if (opts.archived) {
    opts.all = false
    opts.includeArchived = false
  }
  return opts
}

export default { parseDiscoverOptions }
