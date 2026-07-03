# DPML#工具提示单元 框架

> **TL;DR:** DPML#工具提示单元 框架定义了基于四组件架构的完整#AI工具构建方法，通过#用途说明(purpose)、#使用方法(usage)、#参数定义(parameter) 和#预期结果(outcome) 的组合来创建自包含的#AI工具指导。

### 目的与功能

DPML#工具提示单元 框架提供了构建#AI工具的标准化方法，主要功能包括：
- 基于四组件架构构建完整的#AI工具定义
- 确保#工具定义 的自包含性和完整性
- 支持不同领域#AI工具 的灵活定制
- 与Perseng工具执行系统完美集成

## 📝 语法定义

```ebnf
(* EBNF形式化定义 *)
tool_element ::= '<tool' attributes? '>' tool_content '</tool>'
tool_content ::= purpose_element usage_element parameter_element outcome_element

(* 四大核心组件 *)
purpose_element ::= '<purpose' attributes? '>' purpose_content '</purpose>'
usage_element ::= '<usage' attributes? '>' usage_content '</usage>'
parameter_element ::= '<parameter' attributes? '>' parameter_content '</parameter>'
outcome_element ::= '<outcome' attributes? '>' outcome_content '</outcome>'

(* 内容定义 *)
purpose_content ::= markdown_content
usage_content ::= markdown_content
parameter_content ::= markdown_content
outcome_content ::= markdown_content

attributes ::= (' ' attribute)+ | ''
attribute ::= name '="' value '"'
name ::= [a-zA-Z][a-zA-Z0-9_-]*
value ::= [^"]*

markdown_content ::= (* 符合Markdown语法的内容 *)
```

## 🧩 语义说明

`<tool>`标签是DPML中定义#AI工具 的核心#工具提示单元，基于四组件架构构建完整的#AI工具定义。每个#工具 都是自包含的，包含了AI正确使用特定工具所需的全部指导信息。

### 四组件架构说明

#### 1. #用途说明(Purpose)
- **核心功能**：明确工具解决什么问题，适用什么场景
- **内容范围**：问题定义、解决方案、应用领域、核心价值
- **设计目标**：让AI清楚知道什么时候应该使用这个工具
- **关键要素**：问题描述、价值主张、应用边界

#### 2. #使用方法(Usage)
- **核心功能**：详细说明如何正确使用工具
- **内容范围**：操作步骤、使用流程、注意事项、最佳实践
- **设计目标**：确保AI能够按照正确的方式使用工具
- **关键要素**：步骤说明、时机判断、风险提示、优化建议

#### 3. #参数定义(Parameter)
- **核心功能**：明确工具需要什么输入信息
- **内容范围**：必需参数、可选参数、参数格式、默认值、验证规则
- **设计目标**：确保AI能够提供正确的工具调用参数
- **关键要素**：参数列表、类型定义、示例值、约束条件

#### 4. #预期结果(Outcome)
- **核心功能**：描述工具执行后的预期输出和效果
- **内容范围**：返回格式、成功标准、错误处理、结果解读
- **设计目标**：帮助AI理解和验证工具执行结果
- **关键要素**：输出格式、成功指标、异常情况、后续动作

### #工具生命周期

#### 工具使用流程
1. **识别需求** - AI判断当前任务是否需要使用工具
2. **选择工具** - 根据purpose确定合适的工具
3. **准备参数** - 按照parameter要求准备调用参数
4. **执行工具** - 通过`promptx_tool`执行具体工具
5. **处理结果** - 根据outcome验证和处理执行结果

#### 系统级支持
- **工具执行** - `promptx_tool`执行工具代码
- **错误处理** - 系统级异常捕获和处理
- **结果验证** - 自动验证工具执行结果

### 设计理念

#### 指导与执行分离
- 工具定义专注于使用指导，不包含具体代码实现
- 代码执行通过MCP工具系统实现
- 实现"指导-执行-验证"的完整闭环

#### 简化原则
- **四组件自包含** - 覆盖工具使用的全生命周期
- **系统级执行** - 复杂的代码执行通过MCP系统实现
- **清晰分离** - 工具定义与系统功能明确分工

> **注意**：基于指导与执行分离的设计原则，工具文件专注于使用指导，具体的代码实现和执行通过`promptx_tool` MCP工具完成。