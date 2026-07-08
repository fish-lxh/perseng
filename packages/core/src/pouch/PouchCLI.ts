/**
 * 锦囊CLI主入口
 * 提供命令行接口和统一的执行入口
 *
 * P0 step 0B.4.3: 迁 .js → .ts. PouchStateMachine / PouchRegistry 全部 .ts;
 * commands/index.ts 在本 step 内聚合导出;  ~/constants 仍 .js 走 const+require.
 * KNUTH-FIX 0B.4.3: PouchStateMachine / PouchRegistry 也走 const+require,
 * 避免 apps/cli (rootDir=apps/cli/src) 顺着 import 链把 packages/core/src
 * 拉进 program 触发 TS6059.
 */

import * as logger from '@promptx/logger'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: PouchStateMachine } = require('./state/PouchStateMachine') as unknown as { default: PouchStateMachineClass }
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { default: PouchRegistry } = require('./PouchRegistry') as unknown as { default: PouchRegistryClass }

/** PouchStateMachine 构造器类型 (本地 interface, 不引用 import path) */
interface PouchStateMachineClass {
  new (): PouchStateMachineInstance
}
interface PouchStateMachineInstance {
  loadState(): Promise<void>
  transition(command: string, args: unknown[]): Promise<unknown>
  getCurrentState(): string
  getAvailableTransitions(): string[]
  context: unknown
  registerCommand(name: string, command: PouchStateMachineCommand): void
}
interface PouchStateMachineCommand {
  setContext(context: unknown): void
  execute(args: unknown[]): Promise<unknown>
}

/** PouchRegistry 构造器类型 */
interface PouchRegistryClass {
  new (): PouchRegistryInstance
}
interface PouchRegistryInstance {
  registerBatch(map: Record<string, new () => unknown>): void
  list(): string[]
  get(name: string): unknown
  validate(name: string): boolean
  getCommandDetails(): Array<{ name: string; purpose: string }>
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { COMMANDS } = require('~/constants') as { COMMANDS: Record<string, string> }

// 命令类（延迟 require commands/index.ts 以避免循环依赖）
// KNUTH-FIX 0B.4.3: PouchCLI 顶层 require commands 会形成循环
// (PouchCLI → commands → BasePouchCommand → ... → PouchStateMachine? PouchRegistry?)
// 实际无循环，但延迟加载让依赖更显式
// KNUTH-FIX 0B.4.3b: PouchCommandConstructorLike 是 PouchRegistry 导出的 type, 也走
// 本地 interface, 避免 import type 路径触发 TS6059.
type PouchCommandConstructorLike = new () => unknown

interface CommandsModule {
  ProjectCommand: PouchCommandConstructorLike
  DiscoverCommand: PouchCommandConstructorLike
  ActionCommand: PouchCommandConstructorLike
  LearnCommand: PouchCommandConstructorLike
  RecallCommand: PouchCommandConstructorLike
  RememberCommand: PouchCommandConstructorLike
  ThinkCommand: PouchCommandConstructorLike
  ToolCommand: PouchCommandConstructorLike
}

export class PouchCLI {
  private stateMachine: PouchStateMachineInstance
  private registry: PouchRegistryInstance
  private initialized: boolean

  constructor() {
    this.stateMachine = new PouchStateMachine()
    this.registry = new PouchRegistry()
    this.initialized = false
  }

  /**
   * 初始化CLI
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    // KNUTH-FIX 0B.4.3: 延迟 require，避免在 PouchCLI 加载时立即解析所有 commands
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const commands: CommandsModule = require('./commands')

    // 批量注册所有命令
    this.registry.registerBatch({
      project: commands.ProjectCommand,
      discover: commands.DiscoverCommand,
      action: commands.ActionCommand,
      learn: commands.LearnCommand,
      recall: commands.RecallCommand,
      remember: commands.RememberCommand,
      think: commands.ThinkCommand,
      toolx: commands.ToolCommand,
    })

    // 将命令注册到状态机
    for (const name of this.registry.list()) {
      const command = this.registry.get(name)
      // KNUTH-FIX 0B.4.3: validate(commandName) 已在上方通过, 此处 get 必非空
      // cast 到 StateMachineCommand: PouchCommandLike.execute 返回 Promise<unknown>
      // 而 StateMachineCommand.execute 期望 Promise<CommandResult>, 实际 command
      // 返回的 unknown 总兼容 CommandResult (PouchStateMachine 只用 pateoas 字段)
      if (command) {
        this.stateMachine.registerCommand(name, command as unknown as Parameters<typeof this.stateMachine.registerCommand>[1])
      }
    }

    // 加载历史状态
    await this.stateMachine.loadState()

    this.initialized = true
  }

  /**
   * 执行命令
   * @param commandName 命令名称
   * @param args 命令参数
   * @param silent 静默模式，不输出到console（用于MCP）
   */
  async execute(commandName: string, args: unknown[] = [], silent: boolean = false): Promise<unknown> {
    // 确保已初始化
    if (!this.initialized) {
      await this.initialize()
    }

    // 验证命令是否存在
    if (!this.registry.validate(commandName)) {
      throw new Error(`未知命令: ${commandName}\n使用 '${COMMANDS.HELP}' 查看可用命令`)
    }

    try {
      // 通过状态机执行命令
      const result = await this.stateMachine.transition(commandName, args)

      // 只在非静默模式下输出（避免干扰MCP协议）
      if (!silent) {
        // 如果结果有 toString 方法，打印人类可读格式
        if (result && typeof (result as { toString?: () => string }).toString === 'function') {
          // KNUTH-FIX 0B.4.3: logger.log(level, msg, ...args) 需 level 首位, 改用 info
          logger.info((result as { toString(): string }).toString())
        } else {
          logger.info(JSON.stringify(result, null, 2))
        }
      }

      return result
    } catch (error) {
      // 错误输出始终使用stderr，不干扰MCP协议
      if (!silent) {
        logger.error(`执行命令出错: ${(error as Error).message}`)
      }
      throw error
    }
  }

  /**
   * 获取帮助信息
   */
  getHelp(): string {
    const commands = this.registry.getCommandDetails()
    const currentState = this.stateMachine.getCurrentState()
    const availableTransitions = this.stateMachine.getAvailableTransitions()

    let help = `
🎯 Perseng 锦囊系统帮助
========================

当前状态: ${currentState}
可用转换: ${availableTransitions.join(', ')}

📋 可用命令:
`

    for (const cmd of commands) {
      help += `\n  ${cmd.name.padEnd(12)} - ${cmd.purpose}`
    }

    help += `

💡 使用示例:
        ${COMMANDS.INIT}              # 初始化工作环境
        ${COMMANDS.DISCOVER}          # 发现可用角色
        ${COMMANDS.ACTION} copywriter # 激活文案专家
        ${COMMANDS.LEARN} scrum       # 学习敏捷知识
        ${COMMANDS.RECALL} frontend   # 检索前端记忆

🔄 PATEOAS 导航:
每个命令执行后都会提供下一步的建议操作，
按照提示即可完成完整的工作流程。

📚 更多信息请访问: https://github.com/yourusername/promptx
`

    return help
  }

  /**
   * 获取当前状态信息
   */
  getStatus(): {
    currentState: string
    availableCommands: string[]
    availableTransitions: string[]
    context: unknown
    initialized: boolean
  } {
    return {
      currentState: this.stateMachine.getCurrentState(),
      availableCommands: this.registry.list(),
      availableTransitions: this.stateMachine.getAvailableTransitions(),
      context: this.stateMachine.context,
      initialized: this.initialized,
    }
  }

  /**
   * 解析命令行输入
   * @param input 用户输入
   */
  parseCommand(input: string): { command: string; args: string[] } {
    const parts = input.trim().split(/\s+/)
    const command = parts[0] ?? ''
    const args = parts.slice(1)

    return {
      command,
      args,
    }
  }

  /**
   * 运行交互式CLI
   */
  async runInteractive(): Promise<void> {
    logger.info(' 欢迎使用 Perseng 锦囊系统！')
    logger.info('输入 "help" 查看帮助，"exit" 退出\n')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const readline = require('readline') as typeof import('readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'promptx> ',
    })

    rl.prompt()

    rl.on('line', async (line: string) => {
      const input = line.trim()

      if (input === 'exit' || input === 'quit') {
        logger.info('再见！')
        rl.close()
        return
      }

      if (input === 'help') {
        logger.info(this.getHelp())
      } else if (input === 'status') {
        logger.info(JSON.stringify(this.getStatus(), null, 2))
      } else if (input) {
        const { command, args } = this.parseCommand(input)
        try {
          await this.execute(command, args)
        } catch (error) {
          logger.error((error as Error).message)
        }
      }

      rl.prompt()
    })

    rl.on('close', () => {
      process.exit(0)
    })
  }
}

export default PouchCLI
