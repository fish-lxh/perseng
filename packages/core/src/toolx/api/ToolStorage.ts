/**
 * ToolStorage - 工具级持久化存储
 *
 * 为每个工具提供独立的持久化存储能力。
 * 完全兼容 localStorage API，使用单个 JSON 文件存储。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs'
import path from 'path'
import logger from '@promptx/logger'

type StorageValue = string | number | boolean | object | null

interface StorageData {
  [k: string]: StorageValue
}

class ToolStorage {
  public toolId: string
  public sandboxPath: string
  public storageFile: string
  public _cache: StorageData | null
  public _maxSize: number

  constructor(toolId: string, sandboxPath: string) {
    this.toolId = toolId
    this.sandboxPath = sandboxPath
    this.storageFile = path.join(sandboxPath, 'storage.json')
    this._cache = null
    this._maxSize = 10 * 1024 * 1024 // 10MB 限制

    // 初始化存储
    this._init()
  }

  /**
   * 初始化存储文件
   */
  _init(): void {
    try {
      if (!fs.existsSync(this.storageFile)) {
        this._save({})
        logger.debug(`[ToolStorage:${this.toolId}] Created storage file`)
      }
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to init storage: ${(error as Error).message}`)
    }
  }

  /**
   * 读取存储数据
   */
  _load(): StorageData {
    if (this._cache !== null) {
      return this._cache
    }

    try {
      const content = fs.readFileSync(this.storageFile, 'utf8')
      this._cache = (JSON.parse(content || '{}') as StorageData) || {}
      return this._cache
    } catch (error) {
      logger.warn(`[ToolStorage:${this.toolId}] Failed to load storage, using empty: ${(error as Error).message}`)
      this._cache = {}
      return this._cache
    }
  }

  /**
   * 保存存储数据
   */
  _save(data: StorageData): void {
    try {
      const content = JSON.stringify(data, null, 2)

      // 检查大小限制
      const size = Buffer.byteLength(content, 'utf8')
      if (size > this._maxSize) {
        throw new Error(`Storage size ${size} exceeds limit ${this._maxSize}`)
      }

      fs.writeFileSync(this.storageFile, content, 'utf8')
      this._cache = data

      logger.debug(`[ToolStorage:${this.toolId}] Saved storage (${size} bytes)`)
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to save storage: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * 设置存储项
   */
  setItem(key: string, value: StorageValue): boolean {
    try {
      const data = this._load()

      // 如果是 undefined，转为 null（JSON 不支持 undefined）
      if (value === undefined) {
        value = null
      }

      data[key] = value
      this._save(data)

      logger.debug(`[ToolStorage:${this.toolId}] Set item: ${key}`)
      return true
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to set item: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * 获取存储项
   */
  getItem(key: string): StorageValue {
    try {
      const data = this._load()
      const value = data[key]

      logger.debug(`[ToolStorage:${this.toolId}] Get item: ${key}`)
      return value !== undefined ? value : null
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to get item: ${(error as Error).message}`)
      return null
    }
  }

  /**
   * 移除存储项
   */
  removeItem(key: string): boolean {
    try {
      const data = this._load()
      const exists = key in data

      if (exists) {
        delete data[key]
        this._save(data)
        logger.debug(`[ToolStorage:${this.toolId}] Removed item: ${key}`)
      }

      return exists
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to remove item: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * 清空所有存储
   */
  clear(): boolean {
    try {
      this._save({})
      logger.debug(`[ToolStorage:${this.toolId}] Cleared storage`)
      return true
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to clear storage: ${(error as Error).message}`)
      throw error
    }
  }

  /**
   * 获取指定索引的键名
   */
  key(index: number): string | null {
    try {
      const data = this._load()
      const keys = Object.keys(data)
      return keys[index] || null
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to get key: ${(error as Error).message}`)
      return null
    }
  }

  /**
   * 获取存储项数量
   */
  get length(): number {
    try {
      const data = this._load()
      return Object.keys(data).length
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to get length: ${(error as Error).message}`)
      return 0
    }
  }

  /**
   * 获取所有键名
   */
  keys(): string[] {
    try {
      const data = this._load()
      return Object.keys(data)
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to get keys: ${(error as Error).message}`)
      return []
    }
  }

  /**
   * 获取所有键值对
   */
  getAll(): StorageData {
    try {
      const data = this._load()
      logger.debug(`[ToolStorage:${this.toolId}] Get all items (${Object.keys(data).length} items)`)
      return { ...data } // 返回副本，避免直接修改
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to get all: ${(error as Error).message}`)
      return {}
    }
  }

  /**
   * 检查键是否存在
   */
  hasItem(key: string): boolean {
    try {
      const data = this._load()
      return key in data
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to check item: ${(error as Error).message}`)
      return false
    }
  }

  /**
   * 获取存储文件大小
   */
  getSize(): number {
    try {
      if (fs.existsSync(this.storageFile)) {
        const stats = fs.statSync(this.storageFile)
        return stats.size
      }
      return 0
    } catch (error) {
      logger.error(`[ToolStorage:${this.toolId}] Failed to get size: ${(error as Error).message}`)
      return 0
    }
  }

  /**
   * 获取存储文件路径
   */
  getStoragePath(): string {
    return this.storageFile
  }
}

export = ToolStorage
