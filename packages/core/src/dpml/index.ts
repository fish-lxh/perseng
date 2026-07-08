/**
 * Perseng DPML Module
 * DPML协议解析和内容处理模块
 *
 * 提供DPML语法解析、标签处理、语义结构构建功能
 */

import { DPMLContentParser } from './DPMLContentParser'

export { DPMLContentParser }

// 便捷方法 - 创建解析器实例
export function createParser(): DPMLContentParser {
  return new DPMLContentParser()
}

// 便捷方法 - 快速解析标签内容
export function parseTagContent(content: string, tagName: string) {
  const parser = new DPMLContentParser()
  return parser.parseTagContent(content, tagName)
}

// 便捷方法 - 快速解析角色文档
export function parseRoleDocument(roleContent: string) {
  const parser = new DPMLContentParser()
  return parser.parseRoleDocument(roleContent)
}

// 便捷方法 - 提取引用
export function extractReferences(content: string) {
  const parser = new DPMLContentParser()
  return parser.extractReferences(content)
}
