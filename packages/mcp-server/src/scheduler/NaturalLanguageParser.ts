/**
 * scheduler/NaturalLanguageParser.ts — 自然语言 → cron 表达式 (Phase 3 / Commit 8)
 *
 * KNUTH-FEAT 2026-07-18 (Phase 3 / Commit 8)
 *
 * 设计要点：
 *  - 零 LLM 依赖 — 纯字符串正则
 *  - 覆盖中文 15+ / 英文 10+ 高频 pattern
 *  - 未命中返回 needsLLM=true，让上层决定是否 fallback
 *  - 解析失败不抛错，只返回 parsed=null
 *
 * 输出结构：
 *   {
 *     parsed?: ParsedSchedule,
 *     needsLLM: boolean,         // true = 未命中，调用方可走 LLM
 *     confidence: number,       // 0..1
 *     matchedRules: string[],   // 命中的规则名（调试用）
 *     suggestions?: string[]    // 解析失败时给用户的建议语
 *   }
 */

import { DEFAULT_TIMEZONE } from './types.js'

// ============================================================================
// 输出类型
// ============================================================================

export interface ParsedSchedule {
  cronExpr: string
  timezone: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  name?: string
}

export interface NaturalLanguageParseResult {
  parsed: ParsedSchedule | null
  needsLLM: boolean
  confidence: number
  matchedRules: string[]
  suggestions?: string[]
}

export interface NaturalLanguageOptions {
  /** 默认 'zh-CN'；auto 同时尝试中英文（先 zh 再 en） */
  locale?: 'zh-CN' | 'en' | 'auto'
  /** 默认时区（没匹配到 timezone 时使用） */
  defaultTimezone?: string
  /** 已知工具列表（用于推断 toolName；缺省不强制） */
  knownTools?: string[]
}

// ============================================================================
// 内部 helpers
// ============================================================================

const WEEKDAY_MAP_ZH: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
}

const WEEKDAY_NAMES_ZH = ['日', '一', '二', '三', '四', '五', '六']

/** "早上 9 点" / "下午 3 点半" / "晚上 11:30" → [hour, minute] */
function parseChineseTime(s: string): [number, number] | null {
  // 半点的特殊处理
  const halfMatch = s.match(/(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*半/)
  if (halfMatch) {
    const period = halfMatch[1] ?? '早上'
    const h = parseInt(halfMatch[2]!, 10)
    return [adjustChineseHour(h, period), 30]
  }
  // HH:MM 形式
  const colonMatch = s.match(/(早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})/)
  if (colonMatch) {
    const period = colonMatch[1] ?? '早上'
    return [adjustChineseHour(parseInt(colonMatch[2]!, 10), period), parseInt(colonMatch[3]!, 10)]
  }
  // "X 点" 形式
  const hourMatch = s.match(/(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点/)
  if (hourMatch) {
    const period = hourMatch[1] ?? '早上'
    return [adjustChineseHour(parseInt(hourMatch[2]!, 10), period), 0]
  }
  return null
}

/** 中文时段 → 24h 小时偏移 */
function adjustChineseHour(h: number, period: string): number {
  if (period === '下午' || period === '晚上') {
    if (h < 12) return h + 12
    if (h === 12) return 12
    return h // 已经是 13+
  }
  if (period === '中午') return h === 12 ? 12 : h
  // 早上 / 上午
  if (h === 12) return 0
  return h
}

/** "at 9am" / "at 3pm" / "at 23:30" / "at noon" → [hour, minute] */
function parseEnglishTime(s: string): [number, number] | null {
  const ampm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (ampm) {
    let h = parseInt(ampm[1]!, 10)
    const m = ampm[2] ? parseInt(ampm[2], 10) : 0
    const isPm = ampm[3]!.toLowerCase() === 'pm'
    if (isPm && h < 12) h += 12
    if (!isPm && h === 12) h = 0
    return [h, m]
  }
  const noon = s.match(/\b(noon|midnight)\b/i)
  if (noon) {
    return noon[1]!.toLowerCase() === 'noon' ? [12, 0] : [0, 0]
  }
  const colon = s.match(/\b(\d{1,2}):(\d{2})\b/)
  if (colon) {
    return [parseInt(colon[1]!, 10), parseInt(colon[2]!, 10)]
  }
  return null
}

// ============================================================================
// 中文 pattern 列表（顺序敏感：先匹配复合 pattern）
// ============================================================================

interface ZhRule {
  name: string
  regex: RegExp
  build: (match: RegExpMatchArray, fullInput: string) => ParsedSchedule | null
}

const ZH_RULES: ZhRule[] = [
  // "每隔 30 分钟"
  {
    name: 'zh:interval-minute',
    regex: /每隔\s*(\d+)\s*分钟/,
    build: (m) => {
      const n = parseInt(m[1]!, 10)
      if (n < 1 || n > 59) return null
      return {
        cronExpr: `*/${n} * * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: `每${n}分钟`,
      }
    },
  },
  // "每隔 2 小时"
  {
    name: 'zh:interval-hour',
    regex: /每隔\s*(\d+)\s*小时/,
    build: (m) => {
      const n = parseInt(m[1]!, 10)
      if (n < 1 || n > 23) return null
      return {
        cronExpr: `0 */${n} * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: `每${n}小时`,
      }
    },
  },
  // "每周一到周五早上 9 点" / "周一到周五早上 9 点" / "每周三到周五"
  {
    name: 'zh:weekday-range-time',
    regex:
      /周([一二三四五六日天])到(?:周)?([一二三四五六日天])\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半)?/,
    build: (m, full) => {
      const fromDay = WEEKDAY_MAP_ZH[m[1]!]
      const toDay = WEEKDAY_MAP_ZH[m[2]!]
      if (fromDay === undefined || toDay === undefined) return null
      const t = parseChineseTime(full)
      if (!t) return null
      const cronDayRange = `${fromDay}-${toDay}`
      return {
        cronExpr: `${t[1]} ${t[0]} * * ${cronDayRange}`,
        timezone: DEFAULT_TIMEZONE,
        name: `工作时间段`,
      }
    },
  },
  // "每个工作日上午 10 点" / "工作日早上 9 点"
  {
    name: 'zh:workday-time',
    regex: /(每个)?工作日\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半)?/,
    build: (m, full) => {
      const t = parseChineseTime(full)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * 1-5`,
        timezone: DEFAULT_TIMEZONE,
        name: '工作日任务',
      }
    },
  },
  // "每个周末晚上 8 点"
  {
    name: 'zh:weekend-time',
    regex: /(每个)?周末\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半)?/,
    build: (m, full) => {
      const t = parseChineseTime(full)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * 6,0`,
        timezone: DEFAULT_TIMEZONE,
        name: '周末任务',
      }
    },
  },
  // "每周一上午 10 点"
  {
    name: 'zh:weekday-time',
    regex:
      /每周([一二三四五六日天])\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半)?/,
    build: (m, full) => {
      const day = WEEKDAY_MAP_ZH[m[1]!]
      if (day === undefined) return null
      const t = parseChineseTime(full)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * ${day}`,
        timezone: DEFAULT_TIMEZONE,
        name: `每周${WEEKDAY_NAMES_ZH[day]}任务`,
      }
    },
  },
  // "每天晚上 11 点" / "每天下午 3 点半"
  {
    name: 'zh:daily-time',
    regex: /(每天|每日)\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半)?/,
    build: (m, full) => {
      const t = parseChineseTime(full)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: '每日任务',
      }
    },
  },
  // "每天早上 9:30" / "每天晚上 23:15"（HH:MM 形式，无"点"）
  {
    name: 'zh:daily-colon-time',
    regex: /(每天|每日)\s*(早上|上午|中午|下午|晚上)?\s*(\d{1,2}):(\d{2})/,
    build: (m) => {
      const period = m[2] ?? '早上'
      const h = adjustChineseHour(parseInt(m[3]!, 10), period)
      const min = parseInt(m[4]!, 10)
      return {
        cronExpr: `${min} ${h} * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: '每日任务',
      }
    },
  },
  // "每天" 单独（无时间）
  {
    name: 'zh:daily',
    regex: /^每天$|^每日$/,
    build: () => ({
      cronExpr: '0 9 * * *',
      timezone: DEFAULT_TIMEZONE,
      name: '每日任务',
    }),
  },
]

// ============================================================================
// 英文 pattern 列表
// ============================================================================

interface EnRule {
  name: string
  regex: RegExp
  build: (match: RegExpMatchArray) => ParsedSchedule | null
}

const EN_RULES: EnRule[] = [
  // "every 30 minutes"
  {
    name: 'en:interval-minute',
    regex: /\bevery\s+(\d+)\s+minutes?\b/i,
    build: (m) => {
      const n = parseInt(m[1]!, 10)
      if (n < 1 || n > 59) return null
      return {
        cronExpr: `*/${n} * * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: `every-${n}-min`,
      }
    },
  },
  // "every 2 hours"
  {
    name: 'en:interval-hour',
    regex: /\bevery\s+(\d+)\s+hours?\b/i,
    build: (m) => {
      const n = parseInt(m[1]!, 10)
      if (n < 1 || n > 23) return null
      return {
        cronExpr: `0 */${n} * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: `every-${n}-h`,
      }
    },
  },
  // "weekdays at 9am"
  {
    name: 'en:weekdays-time',
    regex: /\bweekdays?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|\d{1,2}:\d{2})\b/i,
    build: (m) => {
      const t = parseEnglishTime(m[0]!)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * 1-5`,
        timezone: DEFAULT_TIMEZONE,
        name: 'weekdays-task',
      }
    },
  },
  // "weekends at 3pm"
  {
    name: 'en:weekends-time',
    regex: /\bweekends?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|\d{1,2}:\d{2})\b/i,
    build: (m) => {
      const t = parseEnglishTime(m[0]!)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * 6,0`,
        timezone: DEFAULT_TIMEZONE,
        name: 'weekends-task',
      }
    },
  },
  // "every monday at 10am"
  {
    name: 'en:weekly-day-time',
    regex:
      /\b(?:every\s+)?(mon|tues|wednes|thurs|fri|satur|sun)(?:day)?\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|\d{1,2}:\d{2})\b/i,
    build: (m) => {
      const dayMap: Record<string, number> = {
        sun: 0,
        mon: 1,
        tue: 2,
        tues: 2,
        wed: 3,
        wednes: 3,
        thu: 4,
        thur: 4,
        thurs: 4,
        fri: 5,
        sat: 6,
        satur: 6,
      }
      const d = dayMap[m[1]!.toLowerCase()]
      if (d === undefined) return null
      const t = parseEnglishTime(m[0]!)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * ${d}`,
        timezone: DEFAULT_TIMEZONE,
        name: `weekly-${m[1]}-task`,
      }
    },
  },
  // "every day at 9am" / "daily at 9am" / "every day at 9:30"
  {
    name: 'en:daily-time',
    regex:
      /\b(?:every\s+day|daily)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon|midnight|\d{1,2}:\d{2})\b/i,
    build: (m) => {
      const t = parseEnglishTime(m[0]!)
      if (!t) return null
      return {
        cronExpr: `${t[1]} ${t[0]} * * *`,
        timezone: DEFAULT_TIMEZONE,
        name: 'daily-task',
      }
    },
  },
  // "every day" 单独（无时间）→ 默认 9am
  {
    name: 'en:daily',
    regex: /^every\s+day$|^daily$/i,
    build: () => ({
      cronExpr: '0 9 * * *',
      timezone: DEFAULT_TIMEZONE,
      name: 'daily-task',
    }),
  },
]

// ============================================================================
// 工具名 / 角色名提取（中文 + 英文通用）
// ============================================================================

/** 从 input 抽 toolName（已知工具列表中匹配） */
function extractToolName(input: string, knownTools?: string[]): string | undefined {
  if (!knownTools || knownTools.length === 0) return undefined
  for (const t of knownTools) {
    // 中英文都是 "工具名前后是空白或边界"
    const re = new RegExp(`(^|\\s|[^a-zA-Z])${escapeRegex(t)}($|\\s|[^a-zA-Z])`)
    if (re.test(input)) return t
  }
  return undefined
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "给 sean 角色" → toolArgs.role = 'sean' */
function extractRole(input: string): string | undefined {
  const m = input.match(/(?:给|to)\s+([a-zA-Z][a-zA-Z0-9_-]{1,30})\s*(?:角色|role)?/i)
  return m ? m[1] : undefined
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 解析自然语言为 schedule 参数。
 * 命中 pattern → 返回 parsed；未命中 → needsLLM=true + 建议列表。
 */
export function parseNaturalLanguage(
  input: string,
  options: NaturalLanguageOptions = {},
): NaturalLanguageParseResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return {
      parsed: null,
      needsLLM: false,
      confidence: 0,
      matchedRules: [],
      suggestions: ['请输入要调度执行的描述'],
    }
  }

  const locale = options.locale ?? 'auto'
  const tz = options.defaultTimezone ?? DEFAULT_TIMEZONE

  const rules: ZhRule[] | EnRule[] =
    locale === 'zh-CN' ? ZH_RULES : locale === 'en' ? EN_RULES : [...ZH_RULES, ...EN_RULES]

  const matchedRules: string[] = []
  for (const rule of rules) {
    const m = trimmed.match(rule.regex)
    if (m) {
      const built = (rule as ZhRule).build(m as RegExpMatchArray, trimmed)
      if (built) {
        // options.defaultTimezone 始终覆盖 rule 内置 timezone
        built.timezone = tz
        // 抽取 toolName（如果 rule 没产出）
        if (!built.toolName) {
          const tn = extractToolName(trimmed, options.knownTools)
          if (tn) built.toolName = tn
        }
        // 抽取 role（如果还没 toolArgs）
        if (!built.toolArgs) {
          const role = extractRole(trimmed)
          if (role) {
            built.toolArgs = { role }
          }
        }
        matchedRules.push(rule.name)
        return {
          parsed: built,
          needsLLM: false,
          confidence: 0.85,
          matchedRules,
        }
      }
    }
  }

  return {
    parsed: null,
    needsLLM: true,
    confidence: 0,
    matchedRules: [],
    suggestions: [
      '请尝试更具体的描述',
      '例如：每个工作日早上 9 点',
      '或者：every weekday at 9am',
      '或者：每隔 30 分钟',
    ],
  }
}

// ============================================================================
// LLM fallback hook（Phase 3 暂 stub，后续 commit 接入）
// ============================================================================

/** 是否启用 LLM fallback（env 控制） */
export function isLlmFallbackEnabled(): boolean {
  return process.env['PERSENG_LLM_NL_SCHEDULE'] === '1'
}

/**
 * LLM fallback 入口 — 当前 stub 实现，抛 "not implemented"。
 * 后续 commit 接入 @promptx/core 或独立 LLM client。
 */
export async function parseNaturalLanguageViaLlm(
  _input: string,
): Promise<NaturalLanguageParseResult> {
  throw new Error(
    'LLM natural language fallback not yet implemented — ' +
      'set PERSENG_LLM_NL_SCHEDULE=1 only after integrating an LLM client in a future commit.',
  )
}