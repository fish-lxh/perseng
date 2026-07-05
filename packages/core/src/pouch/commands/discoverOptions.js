/**
 * discoverOptions - discover 命令的参数解析
 *
 * 独立文件以便单测：避免引入 DiscoverCommand 的依赖链（fs / ProjectManager 等）。
 *
 * KNUTH-FEAT 2026-07-04：三参支持 --all / --include-archived / --archived
 * 优先级（互斥）：--archived > --all/--include-archived > 默认（只显示 active）
 */

function parseDiscoverOptions (args) {
  const opts = { all: false, includeArchived: false, archived: false }
  if (Array.isArray(args) && args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
    const o = args[0]
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

module.exports = { parseDiscoverOptions }
