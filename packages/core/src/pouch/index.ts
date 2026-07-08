/**
 * 锦囊框架 (PATEOAS Framework)
 * Prompt as the Engine of Application State
 *
 * 这是一个革命性的AI-First CLI框架，通过锦囊串联实现AI的状态管理。
 * 每个锦囊都是独立的专家知识单元，通过PATEOAS导航实现状态转换。
 *
 * P0 step 0B.4.3: 迁 .js → .ts.
 * - PouchCLI / PouchRegistry / PouchStateMachine / BasePouchCommand / commands 全部 .ts
 * - 创建全局 CLI 实例, 保留 execute / help / status 便捷方法
 * - KNUTH-FIX 0B.4.3: 本文件是 packages/core/src/pouch 边界, 用 const+require
 *   防止 apps/cli (rootDir=apps/cli/src) 顺着 import 链把 packages/core/src/pouch/*
 *   拉进 program 触发 TS6059. KNUTH-FIX 0B.4.3b: cast 用 unknown 不带
 *   typeof import(...) 路径, 避免 cast 自身触发 TS6059.
 */

/** PouchCLI 构造器 (本地 interface, 不引用 import path) */
interface PouchCLIClass {
  new (): PouchCLIInstance
}
interface PouchCLIInstance {
  execute(commandName: string, args?: unknown[], silent?: boolean): Promise<unknown>
  getHelp(): string
  getStatus(): unknown
}
/** PouchRegistry 构造器 */
interface PouchRegistryClass {
  new (): unknown
}
/** PouchStateMachine 构造器 */
interface PouchStateMachineClass {
  new (): unknown
}
/** BasePouchCommand 构造器 */
interface BasePouchCommandClass {
  new (): unknown
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: PouchCLI } = require('./PouchCLI') as unknown as { default: PouchCLIClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: PouchRegistry } = require('./PouchRegistry') as unknown as { default: PouchRegistryClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: PouchStateMachine } = require('./state/PouchStateMachine') as unknown as { default: PouchStateMachineClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: BasePouchCommand } = require('./BasePouchCommand') as unknown as { default: BasePouchCommandClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const commands = require('./commands/index')

// 创建全局CLI实例
const cli = new PouchCLI()

export {
  // 主要导出
  PouchCLI,
  cli,

  // 框架组件
  PouchRegistry,
  PouchStateMachine,
  BasePouchCommand,

  // 内置命令
  commands,
}

/** 便捷方法：执行命令 */
export const execute = async (commandName: string, args: unknown[] = []): Promise<unknown> => {
  return await cli.execute(commandName, args)
}

/** 便捷方法：获取帮助 */
export const help = (): string => {
  return cli.getHelp()
}

/** 便捷方法：获取状态 */
export const status = () => {
  return cli.getStatus()
}

export default {
  PouchCLI,
  cli,
  PouchRegistry,
  PouchStateMachine,
  BasePouchCommand,
  commands,
  execute,
  help,
  status,
}
