/**
 * SkillProtocol 单元测试
 *
 * 覆盖：
 * - validatePath：接受合法 id，拒绝空字符串和特殊字符
 * - resolve：registry 命中 → 返回内容；未命中 → 抛含可用列表的错误
 * - 错误路径：registryManager 为 null 时优雅抛错
 */

import { describe, it, expect, beforeEach } from 'vitest'
import SkillProtocol from '../SkillProtocol.js'

function makeFakeRegistry(entries) {
  return {
    findResourceById: (id, protocol) => {
      if (!protocol) {
        return entries.find((e) => e.id === id) || null
      }
      return entries.find((e) => e.id === id && e.protocol === protocol) || null
    },
    getResourcesByProtocol: (protocol) =>
      entries.filter((e) => e.protocol === protocol),
  }
}

function makeFakeManager(entries, contentByRef) {
  return {
    registryData: makeFakeRegistry(entries),
    loadResourceByProtocol: async (ref) => {
      if (contentByRef && contentByRef[ref] !== undefined) {
        return contentByRef[ref]
      }
      return `[stub] ${ref}`
    },
  }
}

describe('SkillProtocol', () => {
  let protocol

  beforeEach(() => {
    protocol = new SkillProtocol()
  })

  describe('validatePath', () => {
    it('接受合法 id', () => {
      expect(protocol.validatePath('story-weaving')).toBe(true)
      expect(protocol.validatePath('character_improvisation')).toBe(true)
      expect(protocol.validatePath('DPML-2026')).toBe(true)
    })

    it('拒绝空字符串', () => {
      expect(protocol.validatePath('')).toBe(false)
    })

    it('拒绝包含特殊字符的 id', () => {
      expect(protocol.validatePath('story weaving')).toBe(false)
      expect(protocol.validatePath('foo/bar')).toBe(false)
      expect(protocol.validatePath('foo@bar')).toBe(false)
    })
  })

  describe('resolve', () => {
    it('registry 命中时返回内容', async () => {
      const manager = makeFakeManager(
        [{ id: 'story-weaving', protocol: 'skill', reference: '@package://resources/skill/story-weaving/story-weaving.skill.md' }],
        { '@package://resources/skill/story-weaving/story-weaving.skill.md': '<skill>STORY</skill>' },
      )
      protocol.setRegistryManager(manager)

      const result = await protocol.resolve('story-weaving')
      expect(result).toBe('<skill>STORY</skill>')
    })

    it('registry 未命中时抛含可用列表的错误', async () => {
      const manager = makeFakeManager([
        { id: 'story-weaving', protocol: 'skill', reference: '@package://.../story-weaving.skill.md' },
        { id: 'dpml-composition', protocol: 'skill', reference: '@package://.../dpml-composition.skill.md' },
      ])
      protocol.setRegistryManager(manager)

      await expect(protocol.resolve('missing')).rejects.toThrow(/技能 'missing' 未找到.*可用技能: story-weaving, dpml-composition/)
    })

    it('registry 完全为空时抛"可用技能: (空)"', async () => {
      const manager = makeFakeManager([])
      protocol.setRegistryManager(manager)

      await expect(protocol.resolve('any')).rejects.toThrow(/\(空\)/)
    })

    it('错误信息包一层 SkillProtocol 前缀', async () => {
      const manager = makeFakeManager([])
      protocol.setRegistryManager(manager)

      await expect(protocol.resolve('any')).rejects.toThrow(/SkillProtocol\.resolve failed/)
    })

    it('registryManager 未设置时抛错', async () => {
      await expect(protocol.resolve('story-weaving')).rejects.toThrow()
    })

    it('getProtocolInfo 报告 skill', () => {
      const info = protocol.getProtocolInfo()
      expect(info.name).toBe('skill')
      expect(info.examples).toContain('skill://story-weaving')
    })
  })
})
