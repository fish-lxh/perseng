/**
 * 模块规范化系统入口
 *
 * 提供默认配置的 ModuleNormalizer 实例
 * 以及所有处理器的导出，便于自定义配置
 */

const ModuleNormalizer = require('./ModuleNormalizer');
const ModuleHandler = require('./base/ModuleHandler');

// 导入所有处理器
const NullHandler = require('./handlers/NullHandler');
const FunctionHandler = require('./handlers/FunctionHandler');
const ESModuleHandler = require('./handlers/ESModuleHandler');
const SmartDefaultHandler = require('./handlers/SmartDefaultHandler');
const MultiExportHandler = require('./handlers/MultiExportHandler');
const SingleExportHandler = require('./handlers/SingleExportHandler');
const DefaultExportHandler = require('./handlers/DefaultExportHandler');
const PrimitiveHandler = require('./handlers/PrimitiveHandler');

/**
 * 创建默认配置的规范化器
 * @returns {ModuleNormalizer}
 */
function createDefaultNormalizer() {
  const normalizer = new ModuleNormalizer();

  // 按优先级添加默认处理器
  normalizer.addHandlers([
    new NullHandler(),           // 10 - 空值最先处理
    new FunctionHandler(),       // 20 - 函数类型
    new ESModuleHandler(),       // 30 - ES Module
    new SmartDefaultHandler(),    // 35 - 智能 default 处理（新增）
    new MultiExportHandler(),    // 40 - 多导出对象（lodash、nodemailer）
    new SingleExportHandler(),   // 50 - 单一导出
    new DefaultExportHandler(),  // 60 - default 导出（兜底）
    new PrimitiveHandler()       // 100 - 原始类型和兜底
  ]);

  return normalizer;
}

// 导出
module.exports = {
  // 主类
  ModuleNormalizer,
  ModuleHandler,

  // 处理器
  NullHandler,
  FunctionHandler,
  ESModuleHandler,
  SmartDefaultHandler,
  MultiExportHandler,
  SingleExportHandler,
  DefaultExportHandler,
  PrimitiveHandler,

  // 工厂函数
  createDefaultNormalizer
};