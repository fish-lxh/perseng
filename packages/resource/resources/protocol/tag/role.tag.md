# DPML#角色提示单元 框架

> **TL;DR:** DPML#角色提示单元 框架定义了基于三组件架构的完整#AI角色构建方法，通过#思维模式(personality)、#行为原则(principle) 和#专业知识(knowledge) 的组合来创建自包含的#AI角色。

### 目的与功能

DPML#角色提示单元 框架提供了构建#AI角色的标准化方法，主要功能包括：
- 基于三组件架构构建完整的#AI角色定义
- 确保#角色定义 的自包含性和完整性
- 支持不同领域#AI角色 的灵活定制
- 与Perseng锦囊串联系统完美集成

## 📝 语法定义

```ebnf
(* EBNF形式化定义 *)
role_element ::= '<role' attributes? '>' role_content '</role>'
role_content ::= personality_element principle_element knowledge_element

(* 三大核心组件 *)
personality_element ::= '<personality' attributes? '>' personality_content '</personality>'
principle_element ::= '<principle' attributes? '>' principle_content '</principle>'
knowledge_element ::= '<knowledge' attributes? '>' knowledge_content '</knowledge>'

(* 内容定义 *)
personality_content ::= markdown_content
principle_content ::= markdown_content
knowledge_content ::= markdown_content

attributes ::= (' ' attribute)+ | ''
attribute ::= name '="' value '"'
name ::= [a-zA-Z][a-zA-Z0-9_-]*
value ::= [^"]*

markdown_content ::= (* 符合Markdown语法的内容 *)
```

## 🧩 语义说明

`<role>`标签是DPML中定义#AI角色 的核心#角色提示单元，基于三组件架构构建完整的#AI角色定义。每个#角色 都是自包含的，包含了AI变身为特定领域专家所需的全部信息。

### 三组件架构说明

#### 1. #思维模式(Personality)
- **核心功能**：定义AI角色的思维特征和认知模式
- **内容范围**：核心思维特征、认知偏好、思考方式、价值观倾向
- **设计目标**：确保AI能够以角色特定的思维方式分析和理解问题
- **实现方式**：通过`promptx learn personality://role-id`加载

#### 2. #行为原则(Principle)  
- **核心功能**：定义AI角色的行为准则和工作原则
- **内容范围**：核心原则、行为规范、决策标准、工作流程
- **设计目标**：确保AI能够按照角色特定的原则执行任务和做出决策
- **实现方式**：通过`promptx learn principle://role-id`加载

#### 3. #专业知识(Knowledge)
- **核心功能**：提供AI角色的领域知识和技能体系
- **内容范围**：专业知识框架、技能清单、工具使用、最佳实践
- **设计目标**：确保AI具备角色所需的专业能力和知识背景
- **实现方式**：通过`promptx learn knowledge://role-id`加载

### #角色生命周期

#### 角色激活流程
1. **发现角色** - `promptx hello` 浏览可用角色
2. **制定计划** - `promptx action role-id` 生成学习计划
3. **学习组件** - 按序学习personality、principle、knowledge
4. **开始工作** - 运用角色能力解决实际问题

#### 系统级支持
- **记忆管理** - `promptx remember` 存储经验
- **经验回忆** - `promptx recall` 检索相关记忆  
- **角色切换** - 随时切换到其他专业角色

### 设计理念

#### 锦囊串联架构
- 每个角色是一个完整的"智慧锦囊"
- 支持"AI use CLI get prompt for AI"的核心理念
- 实现AI即时专家化的能力获取

#### 简化原则
- **三组件自包含** - 移除复杂的资源引用机制
- **系统级操作** - 复杂功能通过CLI命令实现
- **清晰分离** - 角色定义与系统功能明确分工

> **注意**：基于简化设计原则，`experience`和`action`组件已迁移为系统级命令（`promptx recall`和`promptx action`），角色文件专注于三个核心组件的定义。