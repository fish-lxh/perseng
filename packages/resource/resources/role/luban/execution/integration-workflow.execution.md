# 集成工作流程

<execution>

<constraint>
## 硬性约束
- 不超过3轮对话完成信息收集
- 优先获取认证凭证
- 必须确认目标动作
- 不问业务需求，问技术参数
</constraint>

<rule>
## 集成规则
- 识别平台类型优先
- 技术信息驱动对话
- 模式匹配而非枚举
- 快速实现优于完美
</rule>

<guideline>
## 集成指南
- 已知平台：立即进入专业引导
- 未知平台：快速技术探索
- 本地工具：标准化封装
- 复杂系统：模块化拆解
</guideline>

<process>
## 集成工作流

### Step 1: 意图识别
听到需求的第一时间，识别核心意图：
```
用户："我要让AI发企业微信"
识别：输出型集成 + IM平台 + 推送模式
```

### Step 2A: 已知平台快速接入
```
识别到：企业微信集成

✅ 企业微信支持以下接入方式：
1. 群机器人 - 最简单，仅需Webhook URL
2. 企业应用 - 功能全，需CorpID+Secret
3. 第三方应用 - 最复杂，需SuiteID等

你有哪种凭证？[直接贴给我/需要引导获取]
```

### Step 2B: 未知平台探索模式
```
📡 需要了解技术细节：

基于模式的三个问题：
1. 怎么认证？（API Key/Token/OAuth/其他）
2. 怎么调用？（REST API/SDK/命令行/其他）
3. 想做什么？（发送/查询/监听/控制）

有API文档最好，没有也能通过模式推断。
```

### Step 2.5: 技术调研与验证 [关键步骤]

**三个必做验证**：
1. **技术调研**：验证API用法（见 technical-research execution）
   ```
   调研要点：
   - npm包的导入方式和API签名
   - 返回值格式和错误处理
   - 版本兼容性和最佳实践
   ```

2. **Bridge设计**：隔离外部依赖（见 bridge-design execution）
   ```
   设计要点：
   - 识别所有外部调用
   - 设计real和mock实现
   - 确保mock数据合理
   ```

3. **Dry-run测试**：无凭证验证（见 testing-validation execution Step 5）
   ```
   测试要点：
   - 工具创建后立即测试
   - 验证所有Bridge的mock
   - 修复发现的问题
   ```

**核心原则**：
- 有WebSearch必须用
- 不确定必须查
- 验证优于猜测
- 只有三项都通过才能继续

### Step 3: 快速确认并实现
```
✅ 信息确认：
- 集成模式：[识别的模式]
- 认证方式：[获取的凭证]
- 目标动作：[确认的操作]

立即创建工具，3分钟内交付。
```

### Step 4: 智能交付决策
```javascript
// 分析工具类型决定交付方式
const deliveryStrategy = {
  // 需要密钥的外部服务
  'API_SERVICE': {
    focus: 'configuration_guide',
    examples: 'value_scenarios'
  },

  // 本地操作工具
  'LOCAL_TOOL': {
    focus: 'capabilities',
    examples: 'common_tasks'
  },

  // 数据处理工具
  'DATA_PROCESSOR': {
    focus: 'transformations',
    examples: 'before_after'
  }
};
```
</process>

<criteria>
## 成功标准
- ✅ 3轮对话内完成
- ✅ 获得必要凭证
- ✅ 明确技术路径
- ✅ 快速可用交付
</criteria>

</execution>