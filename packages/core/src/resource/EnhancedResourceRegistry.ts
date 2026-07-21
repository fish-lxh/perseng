/**
 * EnhancedResourceRegistry - 增强的资源注册表
 *
 * 按照DPML协议架构文档设计，支持：
 * 1. 资源元数据管理（source, priority, timestamp）
 * 2. 智能合并策略（优先级和时间戳）
 * 3. 发现源优先级管理
 * 4. 批量操作支持
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 require 直接拿 class
 */
import { warn as logWarn } from '@promptx/logger'

class EnhancedResourceRegistry {
  public index: Map<string, string> = new Map()
  public metadata: Map<string, { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown }> = new Map()
  public sourcePriority: Record<string, number> = {
    USER: 1,
    PROJECT: 2,
    PACKAGE: 3,
    INTERNET: 4,
  }

  register(resource: {
    id: string
    reference: string
    metadata: { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown }
  }): void {
    this._validateResource(resource)

    const { id, reference, metadata } = resource

    if (this.has(id)) {
      const existingMetadata = this.metadata.get(id)
      if (existingMetadata && !this._shouldOverride(existingMetadata, metadata)) {
        return
      }
    }

    this.index.set(id, reference)
    this.metadata.set(id, { ...metadata })
  }

  registerBatch(resources: Array<{
    id: string
    reference: string
    metadata: { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown }
  }>): void {
    if (!Array.isArray(resources)) {
      throw new Error('Resources must be an array')
    }

    for (const resource of resources) {
      try {
        if (resource && typeof resource === 'object') {
          this.register(resource)
        }
      } catch (error) {
        logWarn(`[EnhancedResourceRegistry] Failed to register resource: ${(error as Error).message}`)
      }
    }
  }

  merge(otherRegistry: EnhancedResourceRegistry): void {
    if (!(otherRegistry instanceof EnhancedResourceRegistry)) {
      throw new Error('Can only merge with another EnhancedResourceRegistry instance')
    }

    const otherResources = otherRegistry.list().map((id) => {
      const reference = otherRegistry.resolve(id)
      const metadata = otherRegistry.getMetadata(id) ?? { source: 'UNKNOWN', priority: 999 }
      return {
        id,
        reference,
        metadata,
      }
    })

    this.registerBatch(otherResources)
  }

  resolve(resourceId: string): string {
    const direct = this.index.get(resourceId)
    if (direct !== undefined) {
      return direct
    }

    const protocols = ['role', 'thought', 'execution', 'memory']

    for (const protocol of protocols) {
      const fullId = `${protocol}:${resourceId}`
      const found = this.index.get(fullId)
      if (found !== undefined) {
        return found
      }
    }

    throw new Error(`Resource '${resourceId}' not found`)
  }

  has(resourceId: string): boolean {
    try {
      this.resolve(resourceId)
      return true
    } catch {
      return false
    }
  }

  getMetadata(resourceId: string): { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown } | null {
    const direct = this.metadata.get(resourceId)
    if (direct) {
      return { ...direct }
    }

    const protocols = ['role', 'thought', 'execution', 'memory']

    for (const protocol of protocols) {
      const fullId = `${protocol}:${resourceId}`
      const found = this.metadata.get(fullId)
      if (found) {
        return { ...found }
      }
    }

    return null
  }

  list(protocol: string | null = null): string[] {
    const allIds = Array.from(this.index.keys())

    if (!protocol) {
      return allIds
    }

    return allIds.filter((id) => id.startsWith(`${protocol}:`))
  }

  size(): number {
    return this.index.size
  }

  clear(): void {
    this.index.clear()
    this.metadata.clear()
  }

  remove(resourceId: string): void {
    if (this.index.has(resourceId)) {
      this.index.delete(resourceId)
      this.metadata.delete(resourceId)
      return
    }

    const protocols = ['role', 'thought', 'execution', 'memory']

    for (const protocol of protocols) {
      const fullId = `${protocol}:${resourceId}`
      if (this.index.has(fullId)) {
        this.index.delete(fullId)
        this.metadata.delete(fullId)
        return
      }
    }
  }

  loadFromDiscoveryResults(discoveryResults: Array<{
    id: string
    reference: string
    metadata: { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown }
  }>): void {
    if (!Array.isArray(discoveryResults)) {
      logWarn('[EnhancedResourceRegistry] Discovery results must be an array')
      return
    }

    this.registerBatch(discoveryResults)
  }

  private _validateResource(resource: {
    id: string
    reference: string
    metadata: { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown }
  }): void {
    if (!resource || typeof resource !== 'object') {
      throw new Error('Resource must be an object')
    }

    if (!resource.id || !resource.reference) {
      throw new Error('Resource must have id and reference')
    }

    if (!resource.metadata || typeof resource.metadata !== 'object') {
      throw new Error('Resource must have metadata with source and priority')
    }

    if (!resource.metadata.source || typeof resource.metadata.priority !== 'number') {
      throw new Error('Resource must have metadata with source and priority')
    }

    if (typeof resource.id !== 'string' || !resource.id.includes(':')) {
      throw new Error('Resource id must be in format "protocol:resourcePath"')
    }

    if (typeof resource.reference !== 'string' || !resource.reference.startsWith('@')) {
      throw new Error('Resource reference must be in DPML format "@protocol://path"')
    }
  }

  private _shouldOverride(
    existingMetadata: { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown },
    newMetadata: { source: string; priority: number; timestamp?: Date | string; [k: string]: unknown },
  ): boolean {
    const existingSourcePriority = this.sourcePriority[existingMetadata.source] ?? 999
    const newSourcePriority = this.sourcePriority[newMetadata.source] ?? 999

    if (newSourcePriority < existingSourcePriority) return true
    if (newSourcePriority > existingSourcePriority) return false

    if (newMetadata.priority < existingMetadata.priority) return true
    if (newMetadata.priority > existingMetadata.priority) return false

    const existingTime = existingMetadata.timestamp ? new Date(existingMetadata.timestamp).getTime() : 0
    const newTime = newMetadata.timestamp ? new Date(newMetadata.timestamp).getTime() : 0

    return newTime >= existingTime
  }
}

export = EnhancedResourceRegistry