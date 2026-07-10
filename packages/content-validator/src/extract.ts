/**
 * 资源文件扫描器
 *
 * 递归读取 resources/ 目录下所有 .md 文件，按行 lexer 出 Ref。
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { extractRefsFromLine } from './lexer.js'
import type { Ref } from './types.js'

/** 默认扫描的文件后缀 */
const DEFAULT_EXTENSIONS = ['.md']

/**
 * 递归扫描目录，返回所有目标文件的相对路径列表
 */
async function walkDir(
  absDir: string,
  rootDir: string,
  extensions: string[],
): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const abs = join(absDir, entry.name)
    if (entry.isDirectory()) {
      const children = await walkDir(abs, rootDir, extensions)
      out.push(...children)
    } else if (entry.isFile()) {
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(relative(rootDir, abs))
      }
    }
  }
  return out
}

/**
 * 从单个文件中提取所有 Ref
 */
async function extractFromFile(filePath: string, rootDir: string): Promise<Ref[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return []
  }
  // 统一换行
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const relFile = relative(rootDir, filePath).replace(/\\/g, '/')
  const refs: Ref[] = []
  let inFencedCode = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const result = extractRefsFromLine(line, i + 1, relFile, inFencedCode)
    refs.push(...result.refs)
    inFencedCode = result.nextInFenced
  }
  return refs
}

/**
 * 提取扫描选项
 */
export interface ExtractOptions {
  /** 工作根目录（默认 process.cwd()） */
  rootDir?: string
  /** 要扫描的目录（相对 rootDir） */
  dir: string
  /** 文件后缀过滤，默认 ['.md'] */
  extensions?: string[]
}

/**
 * 扫描目录，返回所有 Ref
 */
export async function extractRefs(opts: ExtractOptions): Promise<Ref[]> {
  const rootDir = opts.rootDir ?? process.cwd()
  const extensions = opts.extensions ?? DEFAULT_EXTENSIONS
  const absDir = join(rootDir, opts.dir)

  // 确认目录存在
  try {
    const s = await stat(absDir)
    if (!s.isDirectory()) return []
  } catch {
    return []
  }

  const files = await walkDir(absDir, rootDir, extensions)
  const allRefs: Ref[] = []
  for (const relFile of files) {
    if (!relFile) continue
    const absFile = join(rootDir, relFile)
    const refs = await extractFromFile(absFile, rootDir)
    allRefs.push(...refs)
  }
  return allRefs
}
