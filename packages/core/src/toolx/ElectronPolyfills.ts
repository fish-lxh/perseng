/**
 * ElectronPolyfills - 为 Electron 环境提供缺失的全局对象
 *
 * 职责：
 * - 检测运行环境（Node.js vs Electron）
 * - 提供安全的 polyfill 实现
 * - 只注入必要且安全的 API
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import logger from '@promptx/logger'

type PolyfillMap = Record<string, unknown>

class ElectronPolyfills {
  public polyfills: PolyfillMap
  public isElectron: boolean

  constructor() {
    this.polyfills = {}
    this.isElectron = this.detectElectronEnvironment()
  }

  /**
   * 检测是否在 Electron 环境中运行
   */
  detectElectronEnvironment(): boolean {
    // 多种方式检测 Electron 环境
    const checks: Array<() => boolean> = [
      // 检查 process.versions.electron
      () => typeof process !== 'undefined' && !!(process as unknown as { versions?: { electron?: string } }).versions?.electron,
      // 检查 process.type
      () => {
        const p = process as unknown as { type?: string }
        return typeof p.type === 'string' && (p.type === 'renderer' || p.type === 'browser')
      },
      // 检查 window.process
      () => {
        const w = (globalThis as unknown as { window?: { process?: { type?: string } } }).window
        return typeof w !== 'undefined' && !!(w.process && w.process.type)
      },
      // 检查 navigator.userAgent
      () => {
        const n = (globalThis as unknown as { navigator?: { userAgent?: string } }).navigator
        return typeof n !== 'undefined' && !!n.userAgent && n.userAgent.includes('Electron')
      },
    ]

    return checks.some((check) => {
      try {
        return check()
      } catch {
        return false
      }
    })
  }

  /**
   * 获取所有需要的 polyfills
   */
  getPolyfills(): PolyfillMap {
    logger.info('[ElectronPolyfills] getPolyfills called')
    const polyfills: PolyfillMap = {}

    // 1. URL 相关 API
    this.addURLPolyfills(polyfills)
    // 2. 文本编码 API
    this.addTextEncodingPolyfills(polyfills)
    // 3. Base64
    this.addBase64Polyfills(polyfills)
    // 4. File/Blob API（最小化）
    logger.info('[ElectronPolyfills] Calling addFileAPIPolyfills')
    this.addFileAPIPolyfills(polyfills)

    logger.info(`[ElectronPolyfills] Polyfills ready, keys: ${Object.keys(polyfills).join(', ')}`)
    return polyfills
  }

  /**
   * 添加 URL 相关的 polyfills
   */
  addURLPolyfills(polyfills: PolyfillMap): void {
    try {
      if (typeof URL === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { URL, URLSearchParams } = require('url')
        polyfills.URL = URL
        polyfills.URLSearchParams = URLSearchParams
        logger.debug('[ElectronPolyfills] Added URL and URLSearchParams')
      }
    } catch (error) {
      logger.warn(`[ElectronPolyfills] Failed to add URL polyfills: ${(error as Error).message}`)
    }
  }

  /**
   * 添加文本编码相关的 polyfills
   */
  addTextEncodingPolyfills(polyfills: PolyfillMap): void {
    try {
      if (typeof TextEncoder === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { TextEncoder, TextDecoder } = require('util')
        polyfills.TextEncoder = TextEncoder
        polyfills.TextDecoder = TextDecoder
        logger.debug('[ElectronPolyfills] Added TextEncoder and TextDecoder')
      }
    } catch (error) {
      logger.warn(`[ElectronPolyfills] Failed to add text encoding polyfills: ${(error as Error).message}`)
    }
  }

  /**
   * 添加 Base64 编码 polyfills
   */
  addBase64Polyfills(polyfills: PolyfillMap): void {
    try {
      if (typeof btoa === 'undefined') {
        polyfills.btoa = (str: string) => Buffer.from(str, 'binary').toString('base64')
        polyfills.atob = (str: string) => Buffer.from(str, 'base64').toString('binary')
        logger.debug('[ElectronPolyfills] Added btoa and atob')
      }
    } catch (error) {
      logger.warn(`[ElectronPolyfills] Failed to add base64 polyfills: ${(error as Error).message}`)
    }
  }

  /**
   * 添加 File 和 Blob API polyfills
   */
  addFileAPIPolyfills(polyfills: PolyfillMap): void {
    logger.info('[ElectronPolyfills] addFileAPIPolyfills called')
    try {
      // File polyfill
      class FilePolyfill {
        public name: string
        public lastModified: number
        public type: string
        public size: number
        private _buffer: Buffer

        constructor(chunks: unknown[], filename: string, options: { lastModified?: number; type?: string } = {}) {
          this.name = filename
          this.lastModified = options.lastModified || Date.now()
          this.type = options.type || 'application/octet-stream'

          let buffer: Buffer
          if (chunks.length === 0) {
            buffer = Buffer.alloc(0)
          } else if (Buffer.isBuffer(chunks[0])) {
            buffer = Buffer.concat(chunks as Buffer[])
          } else if (typeof chunks[0] === 'string') {
            buffer = Buffer.from((chunks as string[]).join(''))
          } else if (chunks[0] instanceof ArrayBuffer) {
            buffer = Buffer.from(chunks[0] as ArrayBuffer)
          } else {
            buffer = Buffer.from(String(chunks[0]))
          }

          this.size = buffer.length
          this._buffer = buffer
        }

        async arrayBuffer(): Promise<ArrayBuffer> {
          return this._buffer.buffer.slice(
            this._buffer.byteOffset,
            this._buffer.byteOffset + this._buffer.byteLength,
          ) as ArrayBuffer
        }

        async text(): Promise<string> {
          return this._buffer.toString('utf-8')
        }

        stream(): NodeJS.ReadableStream {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { Readable } = require('stream')
          return Readable.from(this._buffer)
        }

        slice(start = 0, end: number = this.size, contentType?: string): FilePolyfill {
          const sliced = this._buffer.slice(start, end)
          return new FilePolyfill([sliced], this.name, {
            type: contentType || this.type,
            lastModified: this.lastModified,
          })
        }
      }

      polyfills.File = FilePolyfill
      logger.info('[ElectronPolyfills] Added File polyfill')

      // Blob polyfill
      class BlobPolyfill {
        public type: string
        public size: number
        private _buffer: Buffer

        constructor(parts: unknown[] = [], options: { type?: string } = {}) {
          this.type = options.type || ''

          let buffer: Buffer
          if (parts.length === 0) {
            buffer = Buffer.alloc(0)
          } else if (Buffer.isBuffer(parts[0])) {
            buffer = Buffer.concat(parts as Buffer[])
          } else if (typeof parts[0] === 'string') {
            buffer = Buffer.from((parts as string[]).join(''))
          } else if (parts[0] instanceof ArrayBuffer) {
            buffer = Buffer.from(parts[0] as ArrayBuffer)
          } else if (parts[0] && typeof (parts[0] as { _buffer?: Buffer })._buffer !== 'undefined') {
            // 处理其他 Blob/File 对象
            buffer = (parts[0] as { _buffer: Buffer })._buffer
          } else {
            buffer = Buffer.from(String(parts[0]))
          }

          this.size = buffer.length
          this._buffer = buffer
        }

        async arrayBuffer(): Promise<ArrayBuffer> {
          return this._buffer.buffer.slice(
            this._buffer.byteOffset,
            this._buffer.byteOffset + this._buffer.byteLength,
          ) as ArrayBuffer
        }

        async text(): Promise<string> {
          return this._buffer.toString('utf-8')
        }

        stream(): NodeJS.ReadableStream {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { Readable } = require('stream')
          return Readable.from(this._buffer)
        }

        slice(start = 0, end: number = this.size, contentType?: string): BlobPolyfill {
          const sliced = this._buffer.slice(start, end)
          return new BlobPolyfill([sliced], { type: contentType || this.type })
        }
      }

      polyfills.Blob = BlobPolyfill
      logger.info('[ElectronPolyfills] Added Blob polyfill')

      // FormData polyfill（简单实现，仅满足基本需求）
      class FormDataPolyfill {
        private _data: Map<string, Array<{ value: unknown; filename?: string }>>

        constructor() {
          this._data = new Map()
        }

        append(name: string, value: unknown, filename?: string): void {
          if (!this._data.has(name)) {
            this._data.set(name, [])
          }
          this._data.get(name)!.push({ value, filename })
        }

        get(name: string): unknown {
          const values = this._data.get(name)
          return values ? values[0]!.value : null
        }

        getAll(name: string): unknown[] {
          const values = this._data.get(name)
          return values ? values.map((v) => v.value) : []
        }

        has(name: string): boolean {
          return this._data.has(name)
        }

        delete(name: string): boolean {
          return this._data.delete(name)
        }

        set(name: string, value: unknown, filename?: string): void {
          this._data.set(name, [{ value, filename }])
        }

        entries(): IterableIterator<[string, unknown]> {
          const entries: Array<[string, unknown]> = []
          for (const [name, values] of this._data) {
            for (const { value } of values) {
              entries.push([name, value])
            }
          }
          return entries[Symbol.iterator]() as IterableIterator<[string, unknown]>
        }

        keys(): IterableIterator<string> {
          return this._data.keys()
        }

        values(): IterableIterator<unknown> {
          const values: unknown[] = []
          for (const valueList of this._data.values()) {
            values.push(...valueList.map((v) => v.value))
          }
          return values[Symbol.iterator]() as IterableIterator<unknown>
        }
      }

      polyfills.FormData = FormDataPolyfill
      logger.info('[ElectronPolyfills] Added FormData polyfill')
    } catch (error) {
      logger.warn(`[ElectronPolyfills] Failed to add File API polyfills: ${(error as Error).message}`)
    }
  }

  /**
   * 获取环境信息
   */
  getEnvironmentInfo(): Record<string, unknown> {
    const p = process as unknown as {
      type?: string
      versions?: { electron?: string; node?: string; v8?: string }
    }
    return {
      isElectron: this.isElectron,
      isRenderer: typeof p.type === 'string' && p.type === 'renderer',
      isBrowser: typeof p.type === 'string' && p.type === 'browser',
      electronVersion: p.versions?.electron ?? null,
      nodeVersion: p.versions?.node ?? null,
      v8Version: p.versions?.v8 ?? null,
    }
  }
}

export = ElectronPolyfills
