<knowledge id="dpml-spec">

## DPML 协议规范（Deepractice Prompt Markup Language）

Perseng 角色定义的统一格式。本文件是 verifier 角色合规检测的规范基线。

### 一、目录结构规范

```
<role-id>/
├── <role-id>.role.md           # 主文件（必需）
├── profile.png                  # 头像（可选，建议有）
├── thought/
│   └── <name>.thought.md        # 思维文件（可多个）
├── execution/
│   └── <name>.execution.md      # 执行文件（可多个）
└── knowledge/
    └── <name>.knowledge.md      # 知识文件（可多个）
```

**命名规范**：
- 目录名：`<role-id>`，ASCII 友好（推荐 pinyin 或英文）
- 主文件名：`<role-id>.role.md`
- 子文件命名：`<kebab-case-name>.<type>.md`
- 引用 ID：与文件 stem 一致（不含扩展名）

### 二、主文件 DPML 标签规范

```xml
<role id="<role-id>">

<personality>
  <!-- 必填：五维模型的内容 -->
  <!-- 子引用：@!thought://<name> -->
</personality>

<principle>
  <!-- 必填：硬性规则、协作边界 -->
  <!-- 子引用：@!execution://<name> -->
</principle>

<knowledge>
  <!-- 必填：知识库引用 -->
  <!-- 子引用：@!knowledge://<name> -->
</knowledge>

</role>
```

### 三、必需标签清单

| 标签 | 必需 | 说明 |
|------|------|------|
| `<role>` | ✅ | 根标签，必须有 `id` 属性 |
| `<personality>` | ✅ | 五维模型 + 人格描述 |
| `<principle>` | ✅ | 硬性规则 + 协作边界 |
| `<knowledge>` | ✅ | 知识库引用 |

### 四、引用语法规范

**思维引用**（在 personality 内）：
```
@!thought://<thought-stem>
```

**执行引用**（在 principle 内）：
```
@!execution://<execution-stem>
```

**知识引用**（在 knowledge 内）：
```
@!knowledge://<knowledge-stem>
```

**引用规则**：
- ✅ 引用必须存在对应文件（`thought/<stem>.thought.md` 等）
- ❌ 不允许引用不存在的文件（死链）
- ❌ 不允许循环引用（A → B → A）

### 五、子文件格式规范

#### thought 文件

```xml
<thought id="<name>">
  <exploration>
    ## 本质探索
    [内容]
  </exploration>
  
  <reasoning>
    ## 推理方法
    [内容]
  </reasoning>
  
  <challenge>
    ## 应用关键点
    [内容]
  </challenge>
  
  <plan>
    ## 执行策略
    [内容]
  </plan>
</thought>
```

#### execution 文件

```xml
<execution id="<name>">
  <constraint>
    ## 约束
    [内容]
  </constraint>
  
  <rule>
    ## 规则
    [内容]
  </rule>
  
  <guideline>
    ## 指导
    [内容]
  </guideline>
  
  <process>
    ## 流程
    [内容]
  </process>
  
  <criteria>
    ## 评价标准
    [内容]
  </criteria>
</execution>
```

#### knowledge 文件

```xml
<knowledge id="<name>">
  ## 标题
  [内容]
  
  ### 子章节
  [内容]
</knowledge>
```

### 六、五维模型规范（personality 必填）

每个角色必须在 personality 中覆盖五维：

| 维度 | 必填内容 |
|------|---------|
| **本质定位** | 一句话定位 + 核心使命 + 协作边界 |
| **能力体系** | 核心能力清单（≥ 3 项） |
| **认知模式** | 思维链路 / 决策树 / 推理方法 |
| **价值系统** | 价值观清单（≥ 3 项） |
| **表达风格** | 语言风格 / 语气 / 表达偏好 |

### 七、硬性规则规范（principle 必填）

硬性规则必须：
- ✅ 使用 🔒 标记或"硬性规则"字样
- ✅ 包含动词约束（MUST / MUST NOT / 禁止 / 不允许）
- ✅ 可执行（不是抽象口号）
- ✅ 优先级高于一般建议

**硬性规则模板**：
```
## 🔒 硬性规则（KNUTH-FEAT <日期> / 必须遵守）

1. **MUST ...** —— <具体动作约束>
2. **MUST NOT ...** —— <禁止动作>
3. ...
```

### 八、合规检测清单（verifier 验证时使用）

| 检测项 | 通过条件 |
|--------|---------|
| 文件结构 | 主文件 + 三个子目录（可为空）|
| DPML 标签 | 四标签齐全 |
| 五维完整性 | 每维有内容（≥ 50 字） |
| 子文件引用 | 0 死链 |
| 硬性规则 | ≥ 3 条且可执行 |
| 协作边界 | 声明与四角色关系 |

### 九、参考实现

- 简单角色：`sean.role.md`（参考人格结构）
- 中等角色：`luban.role.md`（参考能力体系）
- 复杂角色：`jiangziya.role.md`（参考五维完整定义）

</knowledge>