/**
 * PersonaProtocol 单元测试
 *
 * 覆盖：
 * - validatePath：接受合法 id，拒绝空字符串和特殊字符
 * - resolve：registry 命中 → 返回内容；未命中 → 抛含可用列表的错误
 */

import { describe, it, expect, beforeEach } from 'vitest'
import PersonaProtocol from '../PersonaProtocol.js'

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

describe('PersonaProtocol', () => {
  let protocol

  beforeEach(() => {
    protocol = new PersonaProtocol()
  })

  describe('validatePath', () => {
    it('接受合法 id', () => {
      expect(protocol.validatePath('nuwa')).toBe(true)
      expect(protocol.validatePath('sean')).toBe(true)
      expect(protocol.validatePath('jiang-shan')).toBe(true)
    })

    it('拒绝空字符串', () => {
      expect(protocol.validatePath('')).toBe(false)
    })

    it('拒绝包含特殊字符的 id', () => {
      expect(protocol.validatePath('nu wa')).toBe(false)
      expect(protocol.validatePath('foo@bar')).toBe(false)
      expect(protocol.validatePath('foo/bar')).toBe(false)
    })
  })

  describe('resolve', () => {
    it('registry 命中时返回内容', async () => {
      const manager = makeFakeManager(
        [{ id: 'nuwa', protocol: 'persona', reference: '@package://resources/persona/nuwa/nuwa.persona.md' }],
        { '@package://resources/persona/nuwa/nuwa.persona.md': '<persona>NUWA</persona>' },
      )
      protocol.setRegistryManager(manager)

      const result = await protocol.resolve('nuwa')
      expect(result).toBe('<persona>NUWA</persona>')
    })

    it('registry 未命中时抛含可用列表的错误', async () => {
      const manager = makeFakeManager([
        { id: 'nuwa', protocol: 'persona', reference: '@package://.../nuwa.persona.md' },
        { id: 'sean', protocol: 'persona', reference: '@package://.../sean.persona.md' },
      ])
      protocol.setRegistryManager(manager)

      await expect(protocol.resolve('jiang-shan')).rejects.toThrow(/人格 'jiang-shan' 未找到.*可用人格: nuwa, sean/)
    })

    it('registry 完全为空时抛"可用人格: (空)"', async () => {
      const manager = makeFakeManager([])
      protocol.setRegistryManager(manager)

      await expect(protocol.resolve('any')).rejects.toThrow(/\(空\)/)
    })

    it('错误信息包一层 PersonaProtocol 前缀', async () => {
      const manager = makeFakeManager([])
      protocol.setRegistryManager(manager)

      await expect(protocol.resolve('any')).rejects.toThrow(/PersonaProtocol\.resolve failed/)
    })

    it('registryManager 未设置时抛错', async () => {
      await expect(protocol.resolve('nuwa')).rejects.toThrow()
    })

    it('getProtocolInfo 报告 persona', () => {
      const info = protocol.getProtocolInfo()
      expect(info.name).toBe('persona')
      expect(info.examples).toContain('persona://nuwa')
    })
  })
})
