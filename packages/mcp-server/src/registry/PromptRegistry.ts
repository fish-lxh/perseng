/**
 * PromptRegistry — MCP Prompt 中心 (3.4 P2)
 *
 * KNUTH-FEAT 2026-07-11 (RFC 目标 3.4 / 批次 3)
 *
 * 把 welcome.ts / discover / recall 的提示文案重构成 MCP Prompt，
 * 让 AI 客户端通过 prompts/get 获取结构化提示模板。
 *
 * 不变量：
 * - 每个 provider 的 name 唯一（重复抛错）
 * - PromptRegistry.get(name, args) → 路由到 provider.get(args)
 * - 未注册 name 抛 PromptNotFoundError
 */

import type { GetPromptResult, Prompt, PromptArgument } from '@modelcontextprotocol/sdk/types.js'

export interface PromptProvider {
  readonly name: string                          // 'role-activation'
  readonly description: string
  readonly arguments?: readonly PromptArgument[]
  get(args: Record<string, string>): Promise<GetPromptResult>
}

export class PromptNotFoundError extends Error {
  constructor(public readonly name: string) {
    super(`[PromptRegistry] prompt not found: ${name}`)
    this.name = 'PromptNotFoundError'
  }
}

export interface PromptRegistry {
  register(provider: PromptProvider): void
  get(name: string): PromptProvider | undefined
  listProviders(): PromptProvider[]
  /** 列出 MCP Prompt 形状（用于 server.listPrompts()） */
  list(): Prompt[]
  /** 路由到 provider.get() */
  getPrompt(name: string, args: Record<string, string>): Promise<GetPromptResult>
  size(): number
  clear(): void
}

export class MapPromptRegistry implements PromptRegistry {
  private readonly map = new Map<string, PromptProvider>()

  register(provider: PromptProvider): void {
    if (!provider.name || typeof provider.name !== 'string') {
      throw new Error(`[PromptRegistry] provider.name must be non-empty string`)
    }
    if (this.map.has(provider.name)) {
      throw new Error(`[PromptRegistry] duplicate registration for name='${provider.name}'`)
    }
    this.map.set(provider.name, provider)
  }

  get(name: string): PromptProvider | undefined {
    return this.map.get(name)
  }

  listProviders(): PromptProvider[] {
    return Array.from(this.map.values())
  }

  list(): Prompt[] {
    return this.listProviders().map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments ? [...p.arguments] : undefined,
    }))
  }

  async getPrompt(name: string, args: Record<string, string>): Promise<GetPromptResult> {
    const provider = this.map.get(name)
    if (!provider) throw new PromptNotFoundError(name)
    return await provider.get(args)
  }

  size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}