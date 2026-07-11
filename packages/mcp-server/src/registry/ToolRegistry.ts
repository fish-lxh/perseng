/**
 * ToolRegistry — 工具声明式装配层 (3.1 P0)
 *
 * KNUTH-FEAT 2026-07-11 (批次 1 / RFC 目标 3.1)
 *
 * 把硬编码 ToolWithHandler[] 升级为声明式 registry：
 * - ToolManifest：工具元数据（name / version / capabilities / dependencies / schemaVersion）
 * - ToolRegistration：manifest + handler + 可选 setEventBus / setContext 注入器
 * - ToolRegistry interface：register / get / list / filterByCapability
 * - MapToolRegistry：内存实现
 *
 * 向后兼容：createAllTools() 返回值仍为 ToolWithHandler[]；
 * PersengMCPServer 通过 registry.list() 解构 ToolWithHandler 喂给 server.registerTool。
 */

import type { JSONSchema7 } from 'json-schema'
import type { ToolHandler, ToolWithHandler } from '~/interfaces/MCPServer.js'

// ============================================================================
// Types
// ============================================================================

export interface ToolManifest {
  /** 工具唯一名（与 MCP tool.name 一致） */
  readonly name: string
  /** 工具版本（semver，与 package.json / producerVersion 同步） */
  readonly version: string
  /** 能力标签（如 'role:activate' / 'role:born' / 'timeline:query'） */
  readonly capabilities: readonly string[]
  /** 显式声明的 workspace 依赖（仅声明，不强制 import） */
  readonly dependencies: readonly string[]
  /** input schema version（与 EventEnvelope.schemaVersion 解耦；纯 schema 演进用） */
  readonly schemaVersion: number
  /** MCP 输入 schema（与 Tool.inputSchema 同形） */
  readonly inputSchema: JSONSchema7
}

export interface ToolRegistration {
  readonly manifest: ToolManifest
  readonly handler: ToolHandler
  /** 3.2 预留：注入 ToolContext（trace / envelope builder / logger / eventBus） */
  readonly setContext?: (ctx: unknown) => void
  /** M4 已落地：注入 EventBus */
  readonly setEventBus?: (bus: unknown) => void
}

export interface ToolRegistry {
  register(reg: ToolRegistration): void
  get(name: string): ToolRegistration | undefined
  /** 按注册顺序返回；调用方负责二次排序 */
  list(): ToolRegistration[]
  filterByCapability(cap: string): ToolRegistration[]
  /** 注册数量（测试 / 仪表盘用） */
  size(): number
  /** 清空（测试 / 热重载用） */
  clear(): void
}

// ============================================================================
// MapToolRegistry — 内存实现
// ============================================================================

export class MapToolRegistry implements ToolRegistry {
  private readonly map = new Map<string, ToolRegistration>()

  register(reg: ToolRegistration): void {
    if (this.map.has(reg.manifest.name)) {
      throw new Error(
        `[ToolRegistry] duplicate registration for name='${reg.manifest.name}'`,
      )
    }
    this.map.set(reg.manifest.name, reg)
  }

  get(name: string): ToolRegistration | undefined {
    return this.map.get(name)
  }

  list(): ToolRegistration[] {
    return Array.from(this.map.values())
  }

  filterByCapability(cap: string): ToolRegistration[] {
    return this.list().filter((reg) => reg.manifest.capabilities.includes(cap))
  }

  size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}

// ============================================================================
// 适配器：ToolRegistration → ToolWithHandler（保持向后兼容）
// ============================================================================

/**
 * 把 ToolRegistration 拆解成 ToolWithHandler，给 PersengMCPServer.registerTool 喂。
 *
 * ToolRegistration 自带的 setEventBus / setContext 在装配阶段由 PersengMCPServer
 * 通过 registry.list() 后统一注入；这里只返回基础 ToolWithHandler。
 */
export function toToolWithHandler(reg: ToolRegistration): ToolWithHandler {
  const tool: ToolWithHandler = {
    name: reg.manifest.name,
    description: deriveDescription(reg.manifest),
    inputSchema: reg.manifest.inputSchema as unknown as ToolWithHandler['inputSchema'],
    handler: reg.handler,
  }
  // KNUTH-FEAT 2026-07-11 (批次 1)：把 setEventBus 透传到 ToolWithHandler；
  // server 端组装时 PersengMCPServer 调用 setEventBus(bus) 注入总线。
  if (reg.setEventBus) {
    ;(tool as unknown as { setEventBus: ToolWithHandler['setEventBus'] }).setEventBus =
      reg.setEventBus as ToolWithHandler['setEventBus']
  }
  // 3.2 预留 setContext 透传；ToolContext 引入后实现
  if (reg.setContext) {
    ;(tool as unknown as { setContext: (ctx: unknown) => void }).setContext = reg.setContext
  }
  return tool
}

/**
 * 从 manifest 派生 description。MCP tool 必须有 description 字段，
 * 工具当前 description 是大段 markdown（写在 tools/<name>.ts 内）；
 * manifest 不强制复制 description，但需要给个非空 fallback。
 */
function deriveDescription(manifest: ToolManifest): string {
  return `MCP tool '${manifest.name}' (capabilities: ${manifest.capabilities.join(', ')})`
}