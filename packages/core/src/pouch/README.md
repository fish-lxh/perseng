# 锦囊框架 (Pouch Framework)

基于 PATEOAS (Prompt as the Engine of Application State) 理念的 AI-First CLI 框架。

## 🎯 核心理念

锦囊框架实现了"诸葛锦囊"的设计模式，每个锦囊都是：
- **自包含的专家知识单元**：独立执行，不依赖上下文
- **状态驱动的导航系统**：通过 PATEOAS 引导下一步操作
- **AI 友好的接口设计**：专为 AI 使用而优化

## 🏗️ 架构设计

```
锦囊框架
├── BasePouchCommand      # 基础命令抽象类
├── PouchCLI             # CLI 主入口
├── PouchRegistry        # 命令注册器
├── PouchStateMachine    # 状态机管理器
└── Commands/            # 五个核心锦囊
    ├── InitCommand      # 初始化锦囊
    ├── WelcomeCommand     # 角色发现锦囊
    ├── ActionCommand    # 角色激活锦囊
    ├── LearnCommand     # 领域学习锦囊
    └── RecallCommand    # 记忆检索锦囊
```

## 📦 快速开始

### 1. 引入框架

```javascript
const { cli } = require('./lib/core/pouch');

// 或者引入完整框架
const { PouchCLI, BasePouchCommand } = require('./lib/core/pouch');
```

### 2. 执行命令

```javascript
// 初始化环境
await cli.execute('init');

// 发现可用角色
await cli.execute('welcome');

// 激活特定角色
await cli.execute('action', ['copywriter']);

// 学习领域知识
await cli.execute('learn', ['scrum']);

// 检索记忆
await cli.execute('recall', ['frontend']);
```

### 3. 获取状态

```javascript
// 获取当前状态
const status = cli.getStatus();

// 获取帮助信息
const help = cli.getHelp();
```

## 🔧 创建自定义锦囊

### 1. 继承 BasePouchCommand

```javascript
const BasePouchCommand = require('./lib/core/pouch/BasePouchCommand');

class CustomCommand extends BasePouchCommand {
  getPurpose() {
    return '自定义锦囊的目的说明';
  }

  async getContent(args) {
    // 返回锦囊的核心内容（提示词）
    return `这是自定义锦囊的内容...`;
  }

  getPATEOAS(args) {
    // 返回 PATEOAS 导航信息
    return {
      currentState: 'custom-state',
      availableTransitions: ['next-command'],
      nextActions: [
        {
          name: '下一步操作',
          description: '操作描述',
          command: 'promptx next-command'
        }
      ]
    };
  }
}
```

### 2. 注册命令

```javascript
const registry = new PouchRegistry();
registry.register('custom', new CustomCommand());
```

## 🌟 核心特性

### 三层输出结构

每个锦囊都输出三层信息：

1. **Purpose（目的）**：说明锦囊的作用
2. **Content（内容）**：核心提示词或知识
3. **PATEOAS（导航）**：下一步操作指引

### 状态机管理

- 自动记录状态历史
- 持久化状态到 `.perseng.json`
- 支持状态回溯和恢复

### 灵活的输出格式

```javascript
// 设置为 JSON 格式
command.setOutputFormat('json');

// 设置为人类可读格式（默认）
command.setOutputFormat('human');
```

## 📋 命令列表

| 命令 | 说明 | 示例 |
|------|------|------|
| init | 初始化工作环境 | `promptx init` |
| welcome | 发现可用角色 | `promptx welcome` |
| action | 激活特定角色 | `promptx action copywriter` |
| learn | 学习领域知识 | `promptx learn scrum` |
| recall | 检索相关记忆 | `promptx recall test` |

## 🚀 进阶用法

### 交互式模式

```javascript
const cli = new PouchCLI();
await cli.runInteractive();
```

### 批量执行

```javascript
const commands = [
  { name: 'init', args: [] },
  { name: 'welcome', args: [] },
  { name: 'action', args: ['frontend'] }
];

for (const cmd of commands) {
  await cli.execute(cmd.name, cmd.args);
}
```

## 🤝 贡献指南

欢迎贡献新的锦囊命令！请确保：

1. 继承 `BasePouchCommand`
2. 实现三个核心方法
3. 提供清晰的 PATEOAS 导航
4. 编写测试用例

## �� 许可证

MIT License 