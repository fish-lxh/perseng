/**
 * 锦囊状态机管理器
 * 负责管理锦囊之间的状态转换
 *
 * P0 step 0B.4.1: 迁 .js → .ts. 跨目录 `~/project/ProjectManager` 和
 * `../../resource` 都仍在 .js（Phase 4.2/5 才迁），用 const+require
 * 避免 apps/cli TS6059 rootDir。
 */

import * as fs from 'fs-extra'
import * as path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const _projectManager = require('~/project/ProjectManager') as unknown as {
  isInitialized(): boolean
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _resourceModule = require('../../resource') as unknown as {
  getGlobalResourceManager(): {
    initialized: boolean
    initializeWithNewArchitecture(): Promise<void>
    protocols: Map<string, { resolvePath(p: string): Promise<string> }>
  }
}

/** PATEOAS 导航片段（仅取 machine 用到的字段） */
interface CommandPateoas {
  currentState?: string
}

/** 命令鸭子类型（machine 只在乎 setContext/execute） */
interface StateMachineCommand {
  setContext(context: StateContextData): void
  execute(args: unknown[]): Promise<CommandResult>
}

/** command.execute 的返回类型（仅取 machine 用到的字段） */
// KNUTH-FIX 0B.4.3: 导出给 PouchRegistry 用, 让 PouchCommandLike.execute 签名兼容
export interface CommandResult {
  pateoas?: CommandPateoas
  [key: string]: unknown
}

/** PouchStateMachine.context 的形状 */
export interface StateContextData {
  currentPouch: string
  history: string[]
  userProfile: Record<string, unknown>
  sessionData: Record<string, unknown>
  domainContext: Record<string, unknown>
}

/** 历史条目（保留 `to?` 为兼容 PouchStateMachine.transition 中的 `h.command || h.to` fallback） */
interface StateHistoryEntry {
  from: string
  command: string
  timestamp: string
  args: unknown[]
  to?: string
}

/** pouch.json 持久化的形状 */
interface PersistedPouchConfig {
  currentState?: string
  stateHistory?: StateHistoryEntry[]
  lastUpdated?: string
  [key: string]: unknown
}

/**
 * 锦囊状态机：管理锦囊之间的状态转换
 */
export class PouchStateMachine {
  currentState: string
  stateHistory: StateHistoryEntry[]
  context: StateContextData
  private commands: Map<string, StateMachineCommand>

  constructor() {
    this.currentState = 'initial'
    this.stateHistory = []
    this.context = {
      currentPouch: '',
      history: [],
      userProfile: {},
      sessionData: {},
      domainContext: {},
    }
    this.commands = new Map()
  }

  /**
   * 注册锦囊命令
   * @param name 命令名称
   * @param command 命令实例
   */
  registerCommand(name: string, command: StateMachineCommand): void {
    this.commands.set(name, command)
  }

  /**
   * 执行状态转换
   * @param commandName 命令名称
   * @param args 命令参数
   * @returns 执行结果
   */
  async transition(commandName: string, args: unknown[] = []): Promise<CommandResult> {
    // 获取命令对应的锦囊
    const command = this.commands.get(commandName)
    if (!command) {
      throw new Error(`未找到命令: ${commandName}`)
    }

    // 记录历史
    this.stateHistory.push({
      from: this.currentState,
      command: commandName,
      timestamp: new Date().toISOString(),
      args,
    })

    // 更新上下文
    this.context.currentPouch = commandName
    this.context.history = this.stateHistory.map((h) => h.command || h.to || commandName)

    // 设置命令上下文
    command.setContext(this.context)

    // 执行命令
    const result = await command.execute(args)

    // 根据 PATEOAS 导航更新状态
    if (result && result.pateoas && result.pateoas.currentState) {
      this.currentState = result.pateoas.currentState
    }

    // 保存状态
    await this.saveState()

    return result
  }

  /**
   * 获取当前状态
   * @returns 当前状态
   */
  getCurrentState(): string {
    return this.currentState
  }

  /**
   * 获取可用的状态转换
   * @returns 可转换的状态列表
   */
  getAvailableTransitions(): string[] {
    const transitions: Record<string, string[]> = {
      initial: ['init', 'discover'],
      initialized: ['discover', 'action', 'learn'],
      discovering: ['action', 'learn', 'init'],
      activated: ['learn', 'recall', 'discover'],
      learned: ['action', 'recall', 'discover'],
      recalled: ['action', 'learn', 'remember'],
    }

    // 根据当前状态的前缀匹配
    for (const [statePrefix, availableStates] of Object.entries(transitions)) {
      if (this.currentState.startsWith(statePrefix)) {
        return availableStates
      }
    }

    // 默认可转换状态
    return ['discover', 'init']
  }

  /**
   * 保存状态到文件
   */
  async saveState(): Promise<void> {
    try {
      // 检查项目是否已初始化，未初始化时跳过文件保存
      if (!_projectManager.isInitialized()) {
        // 项目未初始化，只保存在内存中，不持久化到文件
        return
      }

      // 使用 @project 协议获取 .perseng 目录（支持 HTTP 模式）
      const resourceManager = _resourceModule.getGlobalResourceManager()

      // 确保 ResourceManager 已初始化
      if (!resourceManager.initialized) {
        await resourceManager.initializeWithNewArchitecture()
      }

      const projectProtocol = resourceManager.protocols.get('project')
      if (!projectProtocol) {
        throw new Error('project protocol not registered on ResourceManager')
      }
      const persengDir = await projectProtocol.resolvePath('.perseng')
      const configPath = path.join(persengDir, 'pouch.json')

      // 确保 .perseng 目录存在
      await fs.ensureDir(persengDir)

      let config: PersistedPouchConfig = {}
      if (await fs.pathExists(configPath)) {
        config = (await fs.readJson(configPath)) as PersistedPouchConfig
      }

      config.currentState = this.currentState
      config.stateHistory = this.stateHistory.slice(-50) // 只保留最近 50 条记录
      config.lastUpdated = new Date().toISOString()

      await fs.writeJson(configPath, config, { spaces: 2 })
    } catch (error) {
      console.error('Failed to save state:', error as Error)
    }
  }

  /**
   * 从文件加载状态
   */
  async loadState(): Promise<void> {
    try {
      // 检查项目是否已初始化，未初始化时跳过文件加载
      if (!_projectManager.isInitialized()) {
        // 项目未初始化，使用默认内存状态
        return
      }

      // 使用 @project 协议获取 .perseng 目录（支持 HTTP 模式）
      const resourceManager = _resourceModule.getGlobalResourceManager()

      // 确保 ResourceManager 已初始化
      if (!resourceManager.initialized) {
        await resourceManager.initializeWithNewArchitecture()
      }

      const projectProtocol = resourceManager.protocols.get('project')
      if (!projectProtocol) {
        throw new Error('project protocol not registered on ResourceManager')
      }
      const persengDir = await projectProtocol.resolvePath('.perseng')
      const configPath = path.join(persengDir, 'pouch.json')

      if (await fs.pathExists(configPath)) {
        const config = (await fs.readJson(configPath)) as PersistedPouchConfig

        if (config.currentState) {
          this.currentState = config.currentState
        }

        if (config.stateHistory) {
          this.stateHistory = config.stateHistory
        }
      }
    } catch (error) {
      console.error('Failed to load state:', error as Error)
    }
  }

  /**
   * 重置状态机
   */
  reset(): void {
    this.currentState = 'initial'
    this.stateHistory = []
    this.context = {
      currentPouch: '',
      history: [],
      userProfile: {},
      sessionData: {},
      domainContext: {},
    }
  }
}

export default PouchStateMachine
