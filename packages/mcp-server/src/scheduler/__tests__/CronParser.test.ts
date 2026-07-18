/**
 * scheduler/__tests__/CronParser.test.ts
 *
 * 覆盖 spike 跑过的 5 个场景 + validate() 单独路径。
 */

import { describe, it, expect } from 'vitest'
import { parse, validate, nextRunFor } from '../CronParser.js'

describe('CronParser', () => {
  describe('parse', () => {
    it('parses "0 9 * * 1-5" and returns a Date', () => {
      const r = parse('0 9 * * 1-5')
      expect(r.valid).toBe(true)
      expect(r.nextRun).toBeInstanceOf(Date)
      expect([1, 2, 3, 4, 5]).toContain((r.nextRun as Date).getDay())
      expect((r.nextRun as Date).getHours()).toBe(9)
    })

    it('respects Asia/Shanghai timezone', () => {
      const r = parse('0 9 * * 1-5', 'Asia/Shanghai')
      expect(r.valid).toBe(true)
      const utcHour = (r.nextRun as Date).getUTCHours()
      // 09:00 CST = 01:00 UTC
      expect(utcHour).toBe(1)
    })

    it('returns invalid for malformed expression', () => {
      const r = parse('not-a-cron')
      expect(r.valid).toBe(false)
      expect(r.error).toBeTruthy()
      expect(r.nextRun).toBeNull()
    })

    it('handles multiple distinct cron instances', () => {
      const c1 = parse('0 9 * * 1-5', 'Asia/Shanghai')
      const c2 = parse('*/5 * * * *', 'Asia/Shanghai') // every 5 min
      const c3 = parse('0 0 1 1 *', 'Asia/Shanghai') // Jan 1
      expect(c1.valid).toBe(true)
      expect(c2.valid).toBe(true)
      expect(c3.valid).toBe(true)
      expect(c2.nextRun).toBeInstanceOf(Date)
      expect(c3.nextRun).toBeInstanceOf(Date)
    })
  })

  describe('validate', () => {
    it('validates a valid expression', () => {
      expect(validate('0 9 * * 1-5')).toEqual({ valid: true })
    })

    it('rejects an invalid expression with error message', () => {
      const r = validate('totally broken')
      expect(r.valid).toBe(false)
      expect(r.error).toBeTruthy()
    })

    it('accepts 6-field expressions (with seconds)', () => {
      expect(validate('0 0 9 * * 1-5').valid).toBe(true)
    })
  })

  describe('nextRunFor', () => {
    it('returns a Date for valid expression', () => {
      expect(nextRunFor('0 9 * * 1-5')).toBeInstanceOf(Date)
    })

    it('returns null for invalid expression (no throw)', () => {
      expect(nextRunFor('not-a-cron')).toBeNull()
    })
  })
})
