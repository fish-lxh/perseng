/**
 * 锦囊框架核心接口定义
 * PATEOAS (Prompt as the Engine of Application State)
 *
 * P0 step 0B.4.1: 4 个 @typedef → export type + export interface
 */

export interface ActionParameters {
  [key: string]: unknown
}

/**
 * 动作定义
 */
export interface Action {
  /** 动作名称 */
  name: string
  /** 动作描述 */
  description: string
  /** 执行命令 */
  command: string
  /** 命令参数（可选） */
  parameters?: ActionParameters
  /** 执行条件（可选 DSL 字符串） */
  condition?: string
}

/**
 * PATEOAS 导航信息
 */
export interface PATEOASNavigation {
  /** 下一步可执行的动作列表 */
  nextActions: Action[]
  /** 当前状态 */
  currentState: string
  /** 可用的状态转换 */
  availableTransitions: string[]
  /** 额外的元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 状态上下文
 */
export interface StateContext {
  /** 当前锦囊 */
  currentPouch: string
  /** 历史记录 */
  history: string[]
  /** 用户配置（可选） */
  userProfile?: Record<string, unknown>
  /** 会话数据（可选） */
  sessionData?: Record<string, unknown>
  /** 领域上下文（可选） */
  domainContext?: Record<string, unknown>
}

/** 输出格式 */
export type PouchFormat = 'human' | 'json'

/**
 * 锦囊输出格式
 */
export interface PouchOutput {
  /** 锦囊目的说明 */
  purpose: string
  /** 锦囊内容（提示词） */
  content: string
  /** PATEOAS 导航信息 */
  pateoas: PATEOASNavigation
  /** 状态上下文（可选） */
  context?: StateContext
  /** 输出格式，默认 'human' */
  format?: PouchFormat
}
