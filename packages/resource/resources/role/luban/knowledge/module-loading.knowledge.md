# 模块加载

<knowledge>

## api.importx智能加载

### 基本用法
通过工具API提供的importx方法加载模块
```javascript
async execute(params) {
  const { api } = this;  // 获取注入的API实例
  
  // 智能加载任何类型的模块
  const lodash = await api.importx('lodash');      // CommonJS
  const chalk = await api.importx('chalk');        // ES Module  
  const fs = await api.importx('fs');              // Node内置
  const axios = await api.importx('axios');        // 第三方包
  
  // 直接使用，自动处理模块格式差异
  const merged = lodash.merge({}, params);
  const colored = chalk.green('Success!');
  const data = await fs.promises.readFile('file.txt');
  const response = await axios.get(url);
}
```

### 批量加载
```javascript
async execute(params) {
  const { api } = this;
  
  // 并行加载多个模块提高性能
  const [lodash, axios, chalk] = await Promise.all([
    api.importx('lodash'),
    api.importx('axios'),
    api.importx('chalk')
  ]);
}
```

### 智能特性
- **格式自适应**：自动处理CommonJS/ES Module差异
- **降级策略**：智能识别default导出、函数导出、对象导出
- **缓存优化**：模块缓存机制，重复加载速度极快（0ms）
- **预装包优先**：优先使用系统预装包，减少安装时间
- **使用兼容性**：模块经过规范化后，使用方式保持不变

### 常见错误
```javascript
// ❌ 错误：直接使用importx（旧方式）
const chalk = await importx('chalk');

// ❌ 错误：使用require（不支持ES Module）
const chalk = require('chalk'); 

// ✅ 正确：使用api.importx（新架构）
const { api } = this;
const chalk = await api.importx('chalk');
```

### 重要：按照npm文档使用模块

使用 api.importx 导入的模块，直接按照该模块的npm文档使用即可：

```javascript
// lodash - 按文档使用其方法
const _ = await api.importx('lodash');
_.merge(obj1, obj2);
_.get(obj, 'a.b.c');
_([1, 2, 3]).sum();  // 链式调用

// express - 创建应用和使用中间件
const express = await api.importx('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));
const router = express.Router();

// date-fns v3 - 使用命名导出
const dateFns = await api.importx('date-fns');
dateFns.format(new Date(), 'yyyy-MM-dd');
dateFns.addDays(new Date(), 7);
// 或解构使用
const { format, addDays } = await api.importx('date-fns');

// nodemailer - 创建传输器发送邮件
const nodemailer = await api.importx('nodemailer');
const transporter = nodemailer.createTransport(config);
await transporter.sendMail(mailOptions);

// axios - HTTP请求
const axios = await api.importx('axios');
await axios.get(url);
await axios.post(url, data);

// moment - 日期处理
const moment = await api.importx('moment');
moment().format('YYYY-MM-DD');
moment().add(7, 'days');
```

### 架构说明
```
工具 → api.importx() → ToolAPI → ToolModuleImport → 责任链规范化
                                         ↓
                                   SmartDefaultHandler (智能default处理)
                                   MultiExportHandler (多导出保持)
                                   ESModuleHandler (ES Module处理)
                                         ↓
                                   返回兼容的模块对象
```

### 使用原则
1. **按文档使用** - 导入后直接按照npm文档的示例使用
2. **无需特殊处理** - 不必关心CommonJS还是ES Module
3. **智能兼容** - 责任链自动处理各种模块格式
4. **性能优先** - 自动缓存和使用预装包

</knowledge>