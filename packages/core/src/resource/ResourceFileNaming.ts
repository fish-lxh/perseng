/**
 * Perseng 资源文件命名管理器
 * 统一管理所有资源文件的命名规范：[id].[tag].md
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 require 直接拿 class
 */
import fs from 'fs-extra'
import path from 'path'

class ResourceFileNaming {
  static readonly NAMING_PATTERN = /^(.+)\.(\w+)\.md$/

  static parseFileName(fileName: string): { id: string; tag: string } | null {
    const match = fileName.match(this.NAMING_PATTERN)
    if (match) {
      const id = match[1] ?? ''
      const tag = match[2] ?? ''
      return { id, tag }
    }
    return null
  }

  static generateFileName(id: string, tag: string): string {
    return `${id}.${tag}.md`
  }

  static isValidFileName(fileName: string): boolean {
    return this.NAMING_PATTERN.test(fileName)
  }

  static hasTag(fileName: string, expectedTag: string): boolean {
    const parsed = this.parseFileName(fileName)
    return Boolean(parsed && parsed.tag === expectedTag)
  }

  static extractResourceId(filePath: string, expectedTag: string): string | null {
    const fileName = path.basename(filePath)
    const parsed = this.parseFileName(fileName)

    if (parsed && parsed.tag === expectedTag) {
      return parsed.id
    }
    return null
  }

  static async scanTagFiles(directory: string, tag: string): Promise<string[]> {
    try {
      if (!(await fs.pathExists(directory))) {
        return []
      }

      const files = await fs.readdir(directory)
      const tagFiles: string[] = []

      for (const file of files) {
        if (this.hasTag(file, tag)) {
          tagFiles.push(path.join(directory, file))
        }
      }

      return tagFiles
    } catch {
      return []
    }
  }

  static getSupportedTags(): string[] {
    return ['role', 'thought', 'execution', 'knowledge']
  }
}

export = ResourceFileNaming