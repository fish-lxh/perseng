# 测试验证流程

<execution>

<constraint>
## 测试约束
- 必须测试正常情况
- 必须测试错误情况
- 必须测试边界情况
- 成功率必须>95%
</constraint>

<rule>
## 测试规则
- 先手动测试再自动化
- 先功能测试再性能测试
- 先单元测试再集成测试
- 出错立即修复再继续
</rule>

<guideline>
## 测试指南
- 准备测试数据
- 执行测试用例
- 验证返回结果
- 记录测试结果
</guideline>

<process>
## 测试步骤

### Step 1: 基础功能测试
```javascript
// 测试正常输入
const result1 = await tool.execute({
  input: "正常数据"
});
console.log("正常情况:", result1.success === true);

// 测试空输入
const result2 = await tool.execute({});
console.log("空输入:", result2.success === false);

// 测试错误输入
const result3 = await tool.execute({
  input: null
});
console.log("错误输入:", result3.success === false);
```

### Step 2: 错误处理测试
```javascript
// 测试参数验证
const validation = tool.validate(null);
console.log("参数验证:", validation.valid === false);

// 测试异常捕获
try {
  await tool.execute({ input: "会触发错误的输入" });
} catch (error) {
  console.log("异常捕获:", error.message);
}
```

### Step 3: 边界情况测试
```javascript
// 测试最小输入
// 测试最大输入
// 测试特殊字符
// 测试并发调用
```

### Step 4: 集成测试
```bash
# 在Perseng环境中测试
promptx_toolx tool_resource='@tool://tool-name' mode='execute' parameters='{"input":"test"}'
```

### Step 5: Dry-run验证 [新增必须步骤]

工具创建后必须执行dry-run测试，验证基本逻辑无需真实凭证：

```javascript
// 执行dry-run测试
const testResult = await sandbox.dryRun({
  action: 'test',
  input: 'sample data'
});

// 检查结果
if (!testResult.success) {
  // 分析并修复错误
  console.log('Dry-run失败:', testResult.error);
  await analyzeAndFix(testResult.error);
}

// Bridge批量测试
if (testResult.bridgeTests) {
  console.log(`Bridge测试: ${testResult.bridgeTests.summary.success}/${testResult.bridgeTests.summary.total} 通过`);

  const failed = Object.entries(testResult.bridgeTests.results)
    .filter(([op, result]) => !result.success);

  if (failed.length > 0) {
    console.log('失败的Bridge:', failed.map(([op]) => op));
    // 修复失败的Bridge
    for (const [op, result] of failed) {
      console.log(`修复Bridge: ${op}`);
      console.log('错误信息:', result.error);
      await fixBridge(op, result.error);
    }
  }
}
```

**常见错误自动修复**：
- `Cannot find module` → 调研正确导入方式
- `is not iterable` → 修正解构语法（如mysql2返回[rows, fields]）
- `undefined is not a function` → 验证API方法存在
- `MISSING_ENV_VAR` → 检查环境变量配置
- `Invalid parameters` → 修正参数结构

**Dry-run成功标准**：
- 所有Bridge的mock都能执行
- 基本逻辑流程能跑通
- 无未捕获的异常
- 返回数据结构合理

### Step 6: 请求测试配置 [新增]

Dry-run通过后，向用户请求真实测试配置：

```javascript
// 分析需要的配置
const schema = tool.getSchema();
const envVars = schema.environment?.properties || {};

// 向用户请求
console.log(`
✅ 工具已通过dry-run测试

现在需要真实环境测试，请提供以下配置：
${Object.entries(envVars).map(([key, spec]) =>
  `- ${key}: ${spec.description}`
).join('\n')}

可以通过以下方式提供：
1. 直接告诉我配置值
2. 或使用: promptx_toolx tool_resource='@tool://tool-name' mode='configure' parameters='{"KEY":"value"}'
`);
```

### Step 7: 真实集成测试 [新增]

使用用户配置进行真实测试：

```javascript
// 设置真实配置
console.log('正在配置环境变量...');
await configureEnvironment(userConfig);

// 切换到真实模式
console.log('开始真实集成测试...');
const realTest = await toolx('@tool://tool-name', {
  mode: 'execute',
  parameters: testParams
});

if (realTest.success) {
  console.log('✅ 真实测试通过！工具已准备就绪。');
} else {
  console.log('❌ 真实测试失败，开始诊断...');
  // 进入诊断修复循环
  await diagnoseAndFix(realTest);
}
```

### Step 8: 诊断修复循环 [新增]

测试失败时的标准处理流程：

```javascript
async function diagnoseAndFix(testResult) {
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`诊断尝试 ${attempts}/${maxAttempts}`);

    // 1. 添加详细日志
    console.log('Step 1: 增加调试日志...');
    await addDebugLogs();

    // 2. 查看执行日志
    console.log('Step 2: 分析错误日志...');
    const logs = await toolx('@tool://tool-name', {
      mode: 'log',
      parameters: { action: 'tail', lines: 100 }
    });
    console.log('错误特征:', extractErrorPattern(logs));

    // 3. 分析错误模式
    const errorPattern = analyzeError(logs);
    console.log('错误类型:', errorPattern);

    // 4. 判断是否应该放弃
    if (shouldAbandon(errorPattern)) {
      console.log(`
❌ 工具实现不可行，原因：
${getAbandonReason(errorPattern)}

建议：寻找替代方案或调整需求
      `);
      return false;
    }

    // 5. 搜索解决方案
    console.log('Step 3: 搜索解决方案...');
    const solution = await WebSearch({
      query: `${errorPattern} npm solution fix`
    });

    // 6. 实施修复
    console.log('Step 4: 应用修复...');
    await implementFix(solution);

    // 7. 重新测试
    console.log('Step 5: 重新测试...');
    const retryResult = await executeRealTest();

    if (retryResult.success) {
      console.log('✅ 问题已修复，测试通过！');
      return true;
    }
  }

  console.log('❌ 超过最大尝试次数，请人工介入');
  return false;
}

// 判断是否应该放弃
function shouldAbandon(errorPattern) {
  const abandonPatterns = [
    'EACCES: permission denied, /etc/',  // 需要系统权限
    'Python required',                    // 脱离npm生态
    'C++ compilation failed',             // 需要编译环境
    'Private registry required',          // 私有包依赖
    'Operating system not supported',     // 系统不兼容
    'Hardware device required'            // 需要硬件设备
  ];

  return abandonPatterns.some(pattern =>
    errorPattern.includes(pattern)
  );
}
```

**诊断要点**：
- 先看日志找错误特征
- 用WebSearch找类似问题的解决方案
- 修复后立即重测
- 最多尝试5次
- 识别不可行的情况及时放弃

**放弃条件**（技术不可行）：
- 需要系统级权限（如修改/etc）
- 脱离npm生态（如需要Python、Go、Rust）
- 依赖不可用（如私有包、内网服务）
- 需要特殊环境（如GPU、特定硬件）
- 平台不兼容（如仅限Windows的COM组件）
</process>

<criteria>
## 测试通过标准
- ✅ Dry-run测试100%通过
- ✅ 真实集成测试成功
- ✅ 所有错误正确处理
- ✅ 无未捕获异常
- ✅ 日志清晰可追踪
- ✅ 用户确认功能符合预期
</criteria>

</execution>