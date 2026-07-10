/**
 * 类型定义
 */

/** 加载语义 */
export type LoadingSemantic = 'DEFAULT' | 'HOT_LOAD' | 'LAZY_LOAD'

/** 单个解析到的引用 */
export interface Ref {
  /** 原始字符串，如 @!role://nuwa */
  raw: string
  /** 协议名（小写） */
  protocol: string
  /** 加载语义 */
  loadingSemantic: LoadingSemantic
  /** 资源 id（不含 ?params） */
  id: string
  /** 源位置 */
  source: {
    /** 相对工作目录的文件路径 */
    file: string
    /** 1-based 行号 */
    line: number
  }
}

/** 单条引用的解析结果 */
export type ResolveResult =
  | { kind: 'ok'; protocol: string; entry: { id: string; reference: string } }
  | { kind: 'syntax-error'; reason: string }
  | { kind: 'unknown-protocol'; protocol: string; registered: string[] }
  | { kind: 'unknown-id'; protocol: string; availableIds: string[] }
  | { kind: 'parse-error'; reason: string }

/** 校验报告 */
export interface ValidateReport {
  /** 是否通过（无 unresolved 视为通过） */
  ok: boolean
  /** 提取到的所有引用 */
  refs: Ref[]
  /** 解析结果，与 refs 一一对应 */
  results: ResolveResult[]
  /** 摘要统计 */
  summary: {
    total: number
    ok: number
    syntaxErrors: number
    unknownProtocols: number
    unknownIds: number
    parseErrors: number
  }
  /** 报告生成时间 */
  generatedAt: string
  /** 工作目录 */
  rootDir: string
}

/** registry JSON 顶层结构（仅取我们需要的子集） */
export interface RegistryJson {
  version: string
  source: string
  metadata?: { resourceCount?: number }
  resources: RegistryEntry[]
  /** v1 旧格式有 stats，新格式从 resources 推 */
  stats?: { byProtocol?: Record<string, number> }
}

export interface RegistryEntry {
  id: string
  protocol: string
  reference: string
  source?: string
  metadata?: Record<string, unknown>
}
