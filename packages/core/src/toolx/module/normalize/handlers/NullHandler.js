/**
 * NullHandler - 空值处理器
 *
 * 处理 null 和 undefined 的模块
 * 优先级最高，因为空值不需要进一步处理
 */

const ModuleHandler = require('../base/ModuleHandler');

class NullHandler extends ModuleHandler {
  constructor() {
    super('NullHandler', 10); // 优先级10，最高
  }

  async process(module) {
    if (module === null || module === undefined) {
      return { handled: true, result: module };
    }
    return { handled: false };
  }
}

module.exports = NullHandler;