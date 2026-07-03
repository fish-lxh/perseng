/**
 * PrimitiveHandler - 原始类型处理器
 *
 * 处理字符串、数字、布尔值等原始类型
 * 优先级最低，作为兜底处理
 */

const ModuleHandler = require('../base/ModuleHandler');

class PrimitiveHandler extends ModuleHandler {
  constructor() {
    super('PrimitiveHandler', 100); // 优先级100，最低
  }

  async process(module) {
    const type = typeof module;

    // 原始类型直接返回
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'symbol' || type === 'bigint') {
      return { handled: true, result: module };
    }

    // 对象类型在前面的处理器应该已经处理了
    // 如果到这里还是对象，说明是普通对象，直接返回
    if (type === 'object' && module !== null) {
      return { handled: true, result: module };
    }

    return { handled: false };
  }
}

module.exports = PrimitiveHandler;