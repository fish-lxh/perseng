/**
 * 模块规范化系统入口
 *
 * 提供默认配置的 ModuleNormalizer 实例，
 * 以及所有处理器的导出，便于自定义配置。
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式让 tsup cjsInterop 不包成 namespace。
 * 使用 self 对象 + `export = self` 模式挂载多个 class (避免 namespace 内 export 受限)。
 */
import ModuleNormalizerModule = require('./ModuleNormalizer')
import ModuleHandlerModule = require('./base/ModuleHandler')

// 7 个 handler 构造器都无参；用 `new () => unknown` + `as any cast` 适配
// ModuleNormalizer.addHandler 的鸭子类型接口。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerCtor = new () => any

// 导入所有 handler 模块（class 都用 export =）
import NullHandlerModule = require('./handlers/NullHandler')
import FunctionHandlerModule = require('./handlers/FunctionHandler')
import ESModuleHandlerModule = require('./handlers/ESModuleHandler')
import SmartDefaultHandlerModule = require('./handlers/SmartDefaultHandler')
import MultiExportHandlerModule = require('./handlers/MultiExportHandler')
import SingleExportHandlerModule = require('./handlers/SingleExportHandler')
import DefaultExportHandlerModule = require('./handlers/DefaultExportHandler')
import PrimitiveHandlerModule = require('./handlers/PrimitiveHandler')

interface NormalizeIndexExport {
  // 主类
  ModuleNormalizer: typeof ModuleNormalizerModule
  ModuleHandler: typeof ModuleHandlerModule

  // 处理器
  NullHandler: HandlerCtor
  FunctionHandler: HandlerCtor
  ESModuleHandler: HandlerCtor
  SmartDefaultHandler: HandlerCtor
  MultiExportHandler: HandlerCtor
  SingleExportHandler: HandlerCtor
  DefaultExportHandler: HandlerCtor
  PrimitiveHandler: HandlerCtor

  // 工厂函数
  createDefaultNormalizer: () => InstanceType<typeof ModuleNormalizerModule>
}

const self = {} as NormalizeIndexExport

// 主类
self.ModuleNormalizer = ModuleNormalizerModule
self.ModuleHandler = ModuleHandlerModule

// 处理器（cast 到 HandlerCtor）
self.NullHandler = NullHandlerModule as unknown as HandlerCtor
self.FunctionHandler = FunctionHandlerModule as unknown as HandlerCtor
self.ESModuleHandler = ESModuleHandlerModule as unknown as HandlerCtor
self.SmartDefaultHandler = SmartDefaultHandlerModule as unknown as HandlerCtor
self.MultiExportHandler = MultiExportHandlerModule as unknown as HandlerCtor
self.SingleExportHandler = SingleExportHandlerModule as unknown as HandlerCtor
self.DefaultExportHandler = DefaultExportHandlerModule as unknown as HandlerCtor
self.PrimitiveHandler = PrimitiveHandlerModule as unknown as HandlerCtor

// 工厂函数
self.createDefaultNormalizer = (): InstanceType<typeof ModuleNormalizerModule> => {
  const normalizer = new ModuleNormalizerModule() as InstanceType<typeof ModuleNormalizerModule>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = (cls: HandlerCtor): any => new cls()

  // 按优先级添加默认处理器
  normalizer.addHandlers([
    cast(self.NullHandler),          // 10 - 空值最先处理
    cast(self.FunctionHandler),      // 20 - 函数类型
    cast(self.ESModuleHandler),      // 30 - ES Module
    cast(self.SmartDefaultHandler),  // 35 - 智能 default 处理（新增）
    cast(self.MultiExportHandler),   // 40 - 多导出对象（lodash、nodemailer）
    cast(self.SingleExportHandler),  // 50 - 单一导出
    cast(self.DefaultExportHandler), // 60 - default 导出（兜底）
    cast(self.PrimitiveHandler),     // 100 - 原始类型和兜底
  ])

  return normalizer
}

export = self
