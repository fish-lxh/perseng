// V-4 verification script: 直接调 MCP action tool handler，验证 fake role 返回 error JSON。
// 不依赖 IDE / Claude Desktop。
//
// 行为模拟：MCP server 外层 try/catch 包裹 handler，handler 抛错时走 MCPOutputAdapter.handleError
// 返回 { isError: true, content: [...] }。这里我们 inline 同样的 wrap 逻辑（与 MCPOutputAdapter.ts
// handleError 同步）。
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'packages', 'mcp-server', 'dist')

// tsup hash 化 chunk 文件名，动态找含 createActionTool 的
const chunkFile = readdirSync(distDir).find(
  f => f.startsWith('chunk-') && f.endsWith('.js') && readFileSync(join(distDir, f), 'utf8').includes('createActionTool'),
)
if (!chunkFile) {
  console.error('❌ no chunk containing createActionTool found')
  process.exit(1)
}
console.log('Found action chunk:', chunkFile)

const { allTools } = await import('file:///' + join(distDir, chunkFile).replace(/\\/g, '/'))
const tool = allTools.find(t => t.name === 'action')
if (!tool) {
  console.error('❌ action tool not found in allTools')
  process.exit(1)
}
console.log('Tool name:', tool.name)

// 模拟 MCP server 外层的 try/catch → MCPOutputAdapter.handleError 行为。
function handleMCPError(error) {
  const errorMessage = error?.message || 'Unknown error occurred'
  return {
    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
    isError: true,
  }
}

let result
try {
  result = await tool.handler({ role: 'jiang-shan-totally-fake' })
} catch (thrown) {
  result = handleMCPError(thrown)
}

console.log('---')
console.log('Result type:', result.content?.[0]?.type)
console.log('Result isError:', result.isError)
console.log('Result text (first 500 chars):')
console.log(result.content?.[0]?.text?.slice(0, 500))
console.log('---')
const passed = result.isError === true && result.content?.[0]?.text?.includes('jiang-shan-totally-fake')
console.log('V-4 验证：isError=' + result.isError + ' + 含错误 id → ' + (passed ? '✅ 通过' : '❌ 失败'))

// === Bonus: 验证 happy path 没被破坏 ===
console.log('\n=== Happy path 验证 (nuwa) ===')
let happyResult
try {
  happyResult = await tool.handler({ role: 'nuwa', roleResources: 'all' })
} catch (thrown) {
  happyResult = handleMCPError(thrown)
}
const happyPassed = happyResult.isError !== true && happyResult.content?.[0]?.text?.includes('nuwa')
console.log('Happy path isError:', happyResult.isError)
console.log('Happy path text (first 200 chars):')
console.log(happyResult.content?.[0]?.text?.slice(0, 200))
console.log('Happy path 验证：' + (happyPassed ? '✅ 通过 (未触发 isError)' : '❌ 失败'))
process.exit(passed && happyPassed ? 0 : 1)