/**
 * 锦囊命令导出
 *
 * P0 step 0B.4.3: 迁 .js → .ts. 8 个 commands 在本 step 内逐个迁 .ts.
 * 聚合形式保持 module.exports 形态以兼容现有 PouchCLI.initialize 消费者.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ProjectCommand = require('./ProjectCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DiscoverCommand = require('./DiscoverCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ActionCommand = require('./ActionCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LearnCommand = require('./LearnCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RecallCommand = require('./RecallCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RememberCommand = require('./RememberCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ThinkCommand = require('./ThinkCommand')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ToolCommand = require('./ToolCommand')

export {
  ProjectCommand,
  DiscoverCommand,
  ActionCommand,
  LearnCommand,
  RecallCommand,
  RememberCommand,
  ThinkCommand,
  ToolCommand,
}

export default {
  ProjectCommand,
  DiscoverCommand,
  ActionCommand,
  LearnCommand,
  RecallCommand,
  RememberCommand,
  ThinkCommand,
  ToolCommand,
}
