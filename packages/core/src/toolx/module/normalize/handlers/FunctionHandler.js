/**
 * FunctionHandler - 函数处理器
 *
 * 处理函数类型的模块
 * 例如：express、moment 等直接导出函数的模块
 */

const ModuleHandler = require('../base/ModuleHandler');

class FunctionHandler extends ModuleHandler {
  constructor() {
    super('FunctionHandler', 20); // 优先级20
  }

  async process(module) {
    if (typeof module === 'function') {
      return { handled: true, result: module };
    }
    return { handled: false };
  }
}

module.exports = FunctionHandler;