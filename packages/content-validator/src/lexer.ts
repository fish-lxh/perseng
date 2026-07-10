/**
 * DPML 引用 lexer
 *
 * 与 packages/core/src/resource/resourceProtocolParser.js 保持一致的语法：
 * - @protocol://path         DEFAULT loading
 * - @!protocol://path        HOT_LOAD (eager)
 * - @?protocol://path        LAZY_LOAD
 *
 * Regex (与 core 第 15 行同步):
 *   /^(@[!?]?|@)([a-zA-Z][a-zA-Z0-9_-]*):(.+)$/
 */

import type { Ref, LoadingSemantic } from './types.js'

/**
 * 完整 regex —— 不带 $ 锚点。
 *
 * 原因：我们在 `line.substring(at).match(...)` 里调用，正则锚定的 ^ 是 substring
 * 起点，$ 是 substring 终点。如果带 $，那 `执行能力：见 @!skill://foo @!skill://bar`
 * 这种多 ref 行就匹配不上（因为 \S+ 后面还有 inline 文本）。不带 $ 让 \S+ 尽量吃掉
 * 后续非空白，然后由 parseRef 用 [a-zA-Z0-9_-]+ 截断 id。
 */
const RESOURCE_REF_REGEX = /^(@[!?]?|@)([a-zA-Z][a-zA-Z0-9_-]*):(\S+)/

/**
 * 把一行内的 markdown code span / fenced code 段标记为不可信区间
 * 返回一个布尔数组 + 下一行是否仍在 fenced code block 内
 *
 * 简化处理：
 * - 单个反引号 ... 反引号 视为 inline code
 * - 三个反引号且行首（或前面仅空白）视为 fenced code 的开始 / 结束
 */
function maskCodeSpans(line: string, inFencedCode: boolean): { mask: boolean[]; nextInFenced: boolean } {
  const mask = new Array<boolean>(line.length).fill(false)
  const trimmed = line.trim()

  // 状态 1：当前行处于 fenced code block 内
  if (inFencedCode) {
    // 整行都是 code
    for (let k = 0; k < line.length; k++) mask[k] = true
    // fence 关闭条件：本行有 ``` 且本行除了 ``` 外没有其他字符（允许 ```language 形式）
    // 简化判断：trim 后以 ``` 开头或结尾
    if (trimmed.startsWith('```')) {
      return { mask, nextInFenced: false }
    }
    return { mask, nextInFenced: true }
  }

  // 状态 2：当前行不在 fenced code 内
  // 先扫一遍看是否进入 fenced code
  let i = 0
  let enteredFence = false
  while (i < line.length) {
    if (line[i] === '`' && line[i + 1] === '`' && line[i + 2] === '`') {
      // 检查前面是否只有空白
      const before = line.substring(0, i).trim()
      if (before === '') {
        // 这是 fence 开头
        for (let k = i; k < line.length; k++) mask[k] = true
        enteredFence = true
        break
      }
    }
    i++
  }
  if (enteredFence) return { mask, nextInFenced: true }

  // 没有 fenced，扫 inline code spans
  i = 0
  while (i < line.length) {
    if (line[i] === '`') {
      // inline code span
      let j = i + 1
      while (j < line.length && line[j] !== '`') j++
      const end = j < line.length ? j : line.length - 1
      for (let k = i; k <= end && k < line.length; k++) mask[k] = true
      if (j >= line.length) break
      i = j + 1
    } else {
      i++
    }
  }
  return { mask, nextInFenced: false }
}

/**
 * 解析单行文本中的所有 DPML 引用
 * @param line 单行文本（不含换行）
 * @param inFencedCode 是否在 fenced code block 内（多行延续状态）
 * @returns 解析到的引用片段（含 raw 字符串与 1-based 列号），以及下一行是否仍在 fenced 内
 */
export function findRefsInLine(
  line: string,
  inFencedCode: boolean = false,
): { refs: Array<{ raw: string; col: number }>; nextInFenced: boolean } {
  const hits: Array<{ raw: string; col: number }> = []
  const trimmed = line.trim()

  // 跳过注释行（DPML 风格：# 开头）
  if (trimmed.startsWith('#')) return { refs: hits, nextInFenced: inFencedCode }

  // 标记 markdown code span（这些区间里的 @ 不是 DPML 引用）
  const { mask, nextInFenced } = maskCodeSpans(line, inFencedCode)

  // 在一行内扫描所有可能的 @ 起点
  let from = 0
  while (true) {
    const at = line.indexOf('@', from)
    if (at < 0) break

    // 跳过 code span 内的 @
    if (mask[at]) {
      from = at + 1
      continue
    }

    // 必须满足 RESOURCE_REF_REGEX 才算合法引用
    const tail = line.substring(at)
    const m = tail.match(RESOURCE_REF_REGEX)
    if (m) {
      hits.push({ raw: m[0], col: at + 1 }) // 1-based
      from = at + m[0].length
    } else {
      // 不是引用，继续往后找下一个 @
      from = at + 1
    }
  }

  return { refs: hits, nextInFenced }
}

/**
 * 解析单条 raw 引用为结构化 Ref
 * @param raw 例如 "@!role://nuwa"
 */
export function parseRef(raw: string): {
  loadingSemantic: LoadingSemantic
  protocol: string
  id: string
} | null {
  const m = raw.match(RESOURCE_REF_REGEX)
  if (!m) return null

  const prefix = m[1]
  const protocol = m[2]
  const tail = m[3]
  // 去掉 :// 或 :
  const pathAndParams = tail.startsWith('//') ? tail.substring(2) : tail
  // 去掉 query params
  const queryIdx = pathAndParams.indexOf('?')
  // 去掉尾部中文/全角标点（如 `，mode: execute` 这种误把中文逗号当分隔符的情况）
  const idRaw = queryIdx >= 0 ? pathAndParams.substring(0, queryIdx) : pathAndParams
  // id 必须是 ascii letter+digit+_-，遇到非 ascii 字符就截断
  const idMatch = idRaw.match(/^[a-zA-Z0-9_-]+/)
  const id = idMatch ? idMatch[0] : idRaw

  let loadingSemantic: LoadingSemantic = 'DEFAULT'
  if (prefix === '@!') loadingSemantic = 'HOT_LOAD'
  else if (prefix === '@?') loadingSemantic = 'LAZY_LOAD'

  return { loadingSemantic, protocol, id }
}

/**
 * 便利函数：把 findRefsInLine 的结果转成 Ref 列表
 * @param inFencedCode 上一行是否处于 fenced code block 内（首行传 false）
 * @returns Ref 列表 + 下一行是否仍在 fenced 内
 */
export function extractRefsFromLine(
  line: string,
  lineNo: number,
  file: string,
  inFencedCode: boolean,
): { refs: Ref[]; nextInFenced: boolean } {
  const { refs, nextInFenced } = findRefsInLine(line, inFencedCode)
  const out: Ref[] = []
  for (const hit of refs) {
    const parsed = parseRef(hit.raw)
    if (!parsed) continue
    out.push({
      raw: hit.raw,
      protocol: parsed.protocol,
      loadingSemantic: parsed.loadingSemantic,
      id: parsed.id,
      source: { file, line: lineNo },
    })
  }
  return { refs: out, nextInFenced }
}
