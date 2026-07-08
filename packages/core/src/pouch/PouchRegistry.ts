/**
 * 锦囊命令注册器
 * 负责管理和注册所有锦囊命令
 *
 * P0 step 0B.4.1: 迁 .js → .ts, 给 BasePouchCommand 类型一个轻量的鸭子类型
 *
 * KNUTH-FIX 0B.4.3: 不 import type StateContextData (避免引用 import path 触发
 * apps/cli TS6059). 用本地 interface 代替.
 */

/** StateContextData 本地镜像 (与 state/PouchStateMachine.StateContextData 同形) */
interface StateContextData {
  currentState: string
  history: string[]
  userProfile: Record<string, unknown>
  sessionData: Record<string, unknown>
  domainContext: Record<string, unknown>
  [key: string]: unknown
}

/** 命令鸭子类型：PouchRegistry 不依赖具体命令类，只在乎 execute() 契约。 */
// KNUTH-FIX 0B.4.3: 加 setContext 兼容 PouchStateMachine 的 StateMachineCommand 契约
// (BasePouchCommand 已实现 setContext, 全部 command 子类都有, 所以设为 required)
export interface PouchCommandLike {
  execute(args?: unknown[]): Promise<unknown>
  getPurpose?(): string
  setContext(context: StateContextData): void
}

export interface PouchCommandDetails {
  name: string
  purpose: string
  className: string
}

/** 命令构造函数的形状（registerBatch 接受 Class ref 也接受 instance，用 unknown 承接） */
export type PouchCommandConstructorLike = new () => PouchCommandLike

export class PouchRegistry {
  private commands: Map<string, PouchCommandLike>

  constructor() {
    this.commands = new Map()
  }

  /**
   * 注册锦囊命令
   * @param name 命令名称
   * @param command 命令实例
   */
  register(name: string, command: PouchCommandLike): void {
    if (!name || typeof name !== 'string') {
      throw new Error('命令名称必须是非空字符串')
    }

    if (!command || typeof command.execute !== 'function') {
      throw new Error('命令必须实现 execute 方法')
    }

    this.commands.set(name.toLowerCase(), command)
  }

  /**
   * 获取锦囊命令
   * @param name 命令名称
   * @returns 命令实例（不存在返回 undefined）
   */
  get(name: string): PouchCommandLike | undefined {
    return this.commands.get(name.toLowerCase())
  }

  /**
   * 列出所有已注册的命令
   * @returns 命令名称列表
   */
  list(): string[] {
    return Array.from(this.commands.keys())
  }

  /**
   * 验证命令是否存在
   * @param name 命令名称
   * @returns 是否存在
   */
  validate(name: string): boolean {
    return this.commands.has(name.toLowerCase())
  }

  /**
   * 获取命令详情
   * @returns 命令详情列表
   */
  getCommandDetails(): PouchCommandDetails[] {
    const details: PouchCommandDetails[] = []

    for (const [name, command] of this.commands) {
      details.push({
        name,
        purpose: command.getPurpose ? command.getPurpose() : '未定义',
        className: command.constructor.name,
      })
    }

    return details
  }

  /**
   * 清空注册器
   */
  clear(): void {
    this.commands.clear()
  }

  /**
   * 批量注册命令
   * @param commandMap 命令映射对象（值为可实例化的构造函数）
   */
  registerBatch(commandMap: Record<string, PouchCommandConstructorLike>): void {
    for (const [name, CommandClass] of Object.entries(commandMap)) {
      if (typeof CommandClass === 'function') {
        const instance = new CommandClass()
        this.register(name.toLowerCase(), instance)
      }
    }
  }
}

export default PouchRegistry
