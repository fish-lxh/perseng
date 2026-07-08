/**
 * lifecycleState - RoleLifecycle 跨 ESM/CJS 实例共享的可变状态。
 *
 * 背景：
 * packages/core 是 CJS 输出。但 vitest 在 SSR ESM transform 下，会把 .js
 * 文件分别给 ESM `import` 和 CJS `require` 加载成两个 module instance，
 * 各自持有独立的 module 局部闭包 `_bridgeFactory`。dispatcher.ts（CJS require）
 * 和测试（ESM import）注入的 factory 会落到不同的 instance，导致 dispatcher
 * 内部 `require('../../rolex/RolexBridge')` 这条 fallback 路径被走到。
 *
 * 解决方案：把 `_bridgeFactory` 这种 mutable 状态独立出来，强制 ESM/CJS
 * 加载同一份真实 CJS 文件（用 .cjs 扩展名让 Node CJS resolver 始终走
 * require cache，不管谁调用都拿到同一份 instance）。
 *
 * 加载方式：
 *   ESM:  import lifecycleState from './lifecycleState.cjs'
 *   CJS:  const lifecycleState = require('./lifecycleState.cjs')
 *
 * Node 的 require cache 是按 绝对路径 索引的，无论从 ESM 还是 CJS 调用
 * `require('./lifecycleState.cjs')` 都拿到同一个 module instance。
 */

let _bridgeFactory = null

module.exports = {
  get bridgeFactory() {
    return _bridgeFactory
  },
  setBridgeFactory(factory) {
    _bridgeFactory = factory
  },
  resetBridgeFactory() {
    _bridgeFactory = null
  },
}
