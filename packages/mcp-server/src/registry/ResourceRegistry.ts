/**
 * ResourceRegistry — MCP Resource 中心 (3.3 P1)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.3 / 批次 2)
 *
 * 把 core / events 暴露的静态资源（角色列表、事件统计、projection result）
 * 注册为 MCP Resource，让 AI 客户端可直接 resources/read 拉取，而不是经由工具间接调用。
 *
 * 不变量：
 * - 每个 provider 的 uri 必须 'perseng://' scheme
 * - register() idempotent (uri 重复抛错)
 * - read() 路由：未注册 uri 抛 ResourceNotFoundError
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'

export interface ResourceProvider {
  readonly uri: string                // 'perseng://roles' | 'perseng://events/stats'
  readonly name: string
  readonly description: string
  readonly mimeType: string
  read(args?: { sessionId?: string }): Promise<ReadResourceResult>
}

export class ResourceNotFoundError extends Error {
  constructor(public readonly uri: string) {
    super(`[ResourceRegistry] resource not found: ${uri}`)
    this.name = 'ResourceNotFoundError'
  }
}

export interface ResourceRegistry {
  register(provider: ResourceProvider): void
  get(uri: string): ResourceProvider | undefined
  listProviders(): ResourceProvider[]
  list(): Array<{ uri: string; name: string; description: string; mimeType: string }>
  read(uri: string, args?: { sessionId?: string }): Promise<ReadResourceResult>
  size(): number
  clear(): void
}

export class MapResourceRegistry implements ResourceRegistry {
  private readonly map = new Map<string, ResourceProvider>()

  register(provider: ResourceProvider): void {
    if (!provider.uri.startsWith('perseng://')) {
      throw new Error(
        `[ResourceRegistry] provider.uri must start with 'perseng://' (got '${provider.uri}')`,
      )
    }
    if (this.map.has(provider.uri)) {
      throw new Error(`[ResourceRegistry] duplicate registration for uri='${provider.uri}'`)
    }
    this.map.set(provider.uri, provider)
  }

  get(uri: string): ResourceProvider | undefined {
    return this.map.get(uri)
  }

  listProviders(): ResourceProvider[] {
    return Array.from(this.map.values())
  }

  list() {
    return this.listProviders().map((p) => ({
      uri: p.uri,
      name: p.name,
      description: p.description,
      mimeType: p.mimeType,
    }))
  }

  async read(uri: string, args?: { sessionId?: string }): Promise<ReadResourceResult> {
    const provider = this.map.get(uri)
    if (!provider) throw new ResourceNotFoundError(uri)
    return await provider.read(args)
  }

  size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}