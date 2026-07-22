/**
 * ToolX API 模块
 *
 * 统一导出所有工具运行时 API：ToolAPI + ToolEnvironment + ToolLogger。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 * 使用 self 对象 + `export = self` 模式挂载多个 class。
 */
import ToolAPIModule = require('./ToolAPI')
import ToolEnvironmentModule = require('./ToolEnvironment')
import ToolLoggerModule = require('./ToolLogger')

interface ApiIndexExport {
  ToolAPI: typeof ToolAPIModule
  ToolEnvironment: typeof ToolEnvironmentModule
  ToolLogger: typeof ToolLoggerModule
}

const self = {} as ApiIndexExport
self.ToolAPI = ToolAPIModule
self.ToolEnvironment = ToolEnvironmentModule
self.ToolLogger = ToolLoggerModule

export = self
