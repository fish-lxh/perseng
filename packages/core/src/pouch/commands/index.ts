/**
 * 锦囊命令导出
 *
 * P0 step 0B.4.3: 迁 .js → .ts. 8 个 commands 在本 step 内逐个迁 .ts.
 * 聚合形式保持 module.exports 形态以兼容现有 PouchCLI.initialize 消费者.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: ProjectCommand } = require('./ProjectCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: DiscoverCommand } = require('./DiscoverCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: ActionCommand } = require('./ActionCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: LearnCommand } = require('./LearnCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: RecallCommand } = require('./RecallCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: RememberCommand } = require('./RememberCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: ThinkCommand } = require('./ThinkCommand') as { default: unknown }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: ToolCommand } = require('./ToolCommand') as { default: unknown }

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
