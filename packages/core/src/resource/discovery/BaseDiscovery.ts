/**
 * BaseDiscovery - 资源发现基础抽象类
 *
 * 按照DPML协议架构文档设计，提供统一的资源发现接口
 * 所有具体的Discovery实现都应该继承这个基类
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace，
 * 旧 .js 子类 (DiscoveryManager.js, FilePatternDiscovery.js, PackageDiscovery.js,
 * UserDiscovery.js) 直接 `require('./BaseDiscovery')` 当 class 继承。
 */
import { debug as logDebug } from '@promptx/logger'

abstract class BaseDiscovery {
  public source: string
  public priority: number
  public cache: Map<string, unknown>

  constructor(source: string, priority: number = 0) {
    if (!source) {
      throw new Error('Discovery source is required')
    }

    this.source = source
    this.priority = priority
    this.cache = new Map()
  }

  // KNUTH-FIX 2026-07-21: 不强制 abstract discover — 旧 .js 子类
// (FilePatternDiscovery.js) 没实现 discover(), 用 generateRegistry 替代。
// 改成 throw stub 让子类按需 override。
  discover(): Promise<Array<{
    id: string
    reference: string
    metadata: Record<string, unknown>
  }>> {
    throw new Error('discover() must be implemented by subclass')
  }

  getDiscoveryInfo(): { source: string; priority: number; description: string } {
    return {
      source: this.source,
      priority: this.priority,
      description: `${this.source} resource discovery`,
    }
  }

  validateResource(resource: {
    id?: string
    reference?: string
    metadata?: Record<string, unknown>
  }): void {
    if (!resource || typeof resource !== 'object') {
      throw new Error('Resource must be an object')
    }

    if (!resource.id || !resource.reference) {
      throw new Error('Resource must have id and reference')
    }

    if (typeof resource.id !== 'string' || !resource.id.includes(':')) {
      throw new Error('Resource id must be in format "protocol:resourcePath"')
    }

    if (typeof resource.reference !== 'string' || !resource.reference.startsWith('@')) {
      throw new Error('Resource reference must be in DPML format "@protocol://path"')
    }
  }

  normalizeResource(resource: {
    id: string
    reference: string
    metadata?: Record<string, unknown>
  }): {
    id: string
    reference: string
    metadata: Record<string, unknown>
  } {
    this.validateResource(resource)

    const normalized = {
      id: resource.id,
      reference: resource.reference,
      metadata: {
        source: this.source,
        priority: this.priority,
        timestamp: new Date(),
        ...(resource.metadata ?? {}),
      },
    }

    logDebug(`[BaseDiscovery] Normalized resource`, { id: resource.id })

    return normalized
  }

  clearCache(): void {
    this.cache.clear()
  }

  getCacheSize(): number {
    return this.cache.size
  }

  getFromCache<T = unknown>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined
  }

  setCache(key: string, value: unknown): void {
    this.cache.set(key, value)
  }
}

export = BaseDiscovery