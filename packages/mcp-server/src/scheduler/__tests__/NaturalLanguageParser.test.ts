/**
 * scheduler/__tests__/NaturalLanguageParser.test.ts (Phase 3 / Commit 8)
 *
 * 覆盖：
 *  - 中文高频 pattern：每天 / 工作日 / 周末 / 每周X / 每隔N分钟 / 每隔N小时 / 时间点
 *  - 英文高频 pattern：every day / weekdays / weekends / every monday / every N minutes
 *  - 边界 case：未识别输入 → needsLLM=true
 *  - 组合 case：toolName 推断 + role 提取
 */

import { describe, it, expect } from 'vitest'
import {
  parseNaturalLanguage,
  isLlmFallbackEnabled,
  parseNaturalLanguageViaLlm,
} from '../NaturalLanguageParser.js'

// ============================================================================
// 中文 patterns
// ============================================================================

describe('parseNaturalLanguage — 中文', () => {
  it('"每天早上 9 点" → 0 9 * * *', () => {
    const r = parseNaturalLanguage('每天早上 9 点')
    expect(r.parsed).not.toBeNull()
    expect(r.parsed!.cronExpr).toBe('0 9 * * *')
    expect(r.parsed!.timezone).toBe('Asia/Shanghai')
    expect(r.needsLLM).toBe(false)
    expect(r.confidence).toBeGreaterThan(0.5)
  })

  it('"每个工作日上午 10 点" → 0 10 * * 1-5', () => {
    const r = parseNaturalLanguage('每个工作日上午 10 点')
    expect(r.parsed?.cronExpr).toBe('0 10 * * 1-5')
  })

  it('"工作日早上 9 点" → 0 9 * * 1-5', () => {
    const r = parseNaturalLanguage('工作日早上 9 点')
    expect(r.parsed?.cronExpr).toBe('0 9 * * 1-5')
  })

  it('"每个周末晚上 8 点" → 0 20 * * 6,0', () => {
    const r = parseNaturalLanguage('每个周末晚上 8 点')
    expect(r.parsed?.cronExpr).toBe('0 20 * * 6,0')
  })

  it('"每周一上午 10 点" → 0 10 * * 1', () => {
    const r = parseNaturalLanguage('每周一上午 10 点')
    expect(r.parsed?.cronExpr).toBe('0 10 * * 1')
  })

  it('"每周日下午 3 点" → 0 15 * * 0', () => {
    const r = parseNaturalLanguage('每周日下午 3 点')
    expect(r.parsed?.cronExpr).toBe('0 15 * * 0')
  })

  it('"每隔 30 分钟" → */30 * * * *', () => {
    const r = parseNaturalLanguage('每隔 30 分钟')
    expect(r.parsed?.cronExpr).toBe('*/30 * * * *')
  })

  it('"每隔 2 小时" → 0 */2 * * *', () => {
    const r = parseNaturalLanguage('每隔 2 小时')
    expect(r.parsed?.cronExpr).toBe('0 */2 * * *')
  })

  it('"每天晚上 11 点" → 0 23 * * *', () => {
    const r = parseNaturalLanguage('每天晚上 11 点')
    expect(r.parsed?.cronExpr).toBe('0 23 * * *')
  })

  it('"每天中午 12 点" → 0 12 * * *', () => {
    const r = parseNaturalLanguage('每天中午 12 点')
    expect(r.parsed?.cronExpr).toBe('0 12 * * *')
  })

  it('"每天下午 3 点半" → 30 15 * * *', () => {
    const r = parseNaturalLanguage('每天下午 3 点半')
    expect(r.parsed?.cronExpr).toBe('30 15 * * *')
  })

  it('"每周一到周五早上 9 点" → 0 9 * * 1-5', () => {
    const r = parseNaturalLanguage('每周一到周五早上 9 点')
    expect(r.parsed?.cronExpr).toBe('0 9 * * 1-5')
  })

  it('"早上 9:30" → 30 9 * * *', () => {
    const r = parseNaturalLanguage('每天早上 9:30')
    expect(r.parsed?.cronExpr).toBe('30 9 * * *')
  })
})

// ============================================================================
// 英文 patterns
// ============================================================================

describe('parseNaturalLanguage — 英文', () => {
  it('"every day at 9am" → 0 9 * * *', () => {
    const r = parseNaturalLanguage('every day at 9am')
    expect(r.parsed?.cronExpr).toBe('0 9 * * *')
  })

  it('"daily at 3pm" → 0 15 * * *', () => {
    const r = parseNaturalLanguage('daily at 3pm')
    expect(r.parsed?.cronExpr).toBe('0 15 * * *')
  })

  it('"weekdays at 9am" → 0 9 * * 1-5', () => {
    const r = parseNaturalLanguage('weekdays at 9am')
    expect(r.parsed?.cronExpr).toBe('0 9 * * 1-5')
  })

  it('"weekends at 3pm" → 0 15 * * 6,0', () => {
    const r = parseNaturalLanguage('weekends at 3pm')
    expect(r.parsed?.cronExpr).toBe('0 15 * * 6,0')
  })

  it('"every monday at 10am" → 0 10 * * 1', () => {
    const r = parseNaturalLanguage('every monday at 10am')
    expect(r.parsed?.cronExpr).toBe('0 10 * * 1')
  })

  it('"every sunday at 11pm" → 0 23 * * 0', () => {
    const r = parseNaturalLanguage('every sunday at 11pm')
    expect(r.parsed?.cronExpr).toBe('0 23 * * 0')
  })

  it('"every 30 minutes" → */30 * * * *', () => {
    const r = parseNaturalLanguage('every 30 minutes')
    expect(r.parsed?.cronExpr).toBe('*/30 * * * *')
  })

  it('"every 2 hours" → 0 */2 * * *', () => {
    const r = parseNaturalLanguage('every 2 hours')
    expect(r.parsed?.cronExpr).toBe('0 */2 * * *')
  })

  it('"daily at noon" → 0 12 * * *', () => {
    const r = parseNaturalLanguage('daily at noon')
    expect(r.parsed?.cronExpr).toBe('0 12 * * *')
  })

  it('"every day at 23:30" → 30 23 * * *', () => {
    const r = parseNaturalLanguage('every day at 23:30')
    expect(r.parsed?.cronExpr).toBe('30 23 * * *')
  })
})

// ============================================================================
// 边界 / 组合
// ============================================================================

describe('parseNaturalLanguage — 边界 / 组合', () => {
  it('未识别输入 → parsed=null + needsLLM=true + suggestions 非空', () => {
    const r = parseNaturalLanguage('在某个神秘时刻做某事')
    expect(r.parsed).toBeNull()
    expect(r.needsLLM).toBe(true)
    expect(r.suggestions).toBeDefined()
    expect(r.suggestions!.length).toBeGreaterThan(0)
  })

  it('空字符串 → parsed=null + 友好提示', () => {
    const r = parseNaturalLanguage('   ')
    expect(r.parsed).toBeNull()
    expect(r.suggestions?.[0]).toContain('请输入')
  })

  it('locale=zh-CN 强制只匹配中文', () => {
    const r = parseNaturalLanguage('every day at 9am', { locale: 'zh-CN' })
    expect(r.parsed).toBeNull()
    expect(r.needsLLM).toBe(true)
  })

  it('locale=en 强制只匹配英文', () => {
    const r = parseNaturalLanguage('每天早上 9 点', { locale: 'en' })
    expect(r.parsed).toBeNull()
  })

  it('knownTools 推断 toolName', () => {
    const r = parseNaturalLanguage('每天早上 9 点用 remember 工具', {
      knownTools: ['remember', 'recall', 'action'],
    })
    expect(r.parsed?.toolName).toBe('remember')
  })

  it('"给 sean 角色" 提取 role 到 toolArgs', () => {
    const r = parseNaturalLanguage('每天早上 9 点给 sean 角色发简报')
    expect(r.parsed?.toolArgs?.role).toBe('sean')
  })

  it('defaultTimezone 透传', () => {
    const r = parseNaturalLanguage('每天早上 9 点', {
      defaultTimezone: 'America/New_York',
    })
    expect(r.parsed?.timezone).toBe('America/New_York')
  })

  it('matchedRules 含命中的规则名（调试用）', () => {
    const r = parseNaturalLanguage('每天早上 9 点')
    expect(r.matchedRules.length).toBeGreaterThan(0)
    expect(r.matchedRules[0]).toMatch(/zh:/)
  })
})

// ============================================================================
// LLM fallback hooks
// ============================================================================

describe('LLM fallback hooks', () => {
  it('isLlmFallbackEnabled 默认 false', () => {
    expect(isLlmFallbackEnabled()).toBe(false)
  })

  it('parseNaturalLanguageViaLlm 当前 stub → throw', async () => {
    await expect(parseNaturalLanguageViaLlm('test')).rejects.toThrow(/not yet implemented/)
  })
})