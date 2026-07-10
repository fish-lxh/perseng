<skill>

<name>dpml-composition</name>

<description>DPML 标签写作——把任意素材（对话笔记、需求文档、会议纪要、用户故事）按 DPML 标签语法（role / thought / execution / knowledge / skill / persona）重组为可挂载的资源文件。</description>

<triggers>
当需要：
- 把一份 Markdown 草稿转成可被 registry 引用的 DPML 资源
- 在已有 role 中追加 thought/execution/knowledge 段落
- 拆分一个臃肿的 role 文件为 role + skill + persona
- 校验一份 DPML 文件的引用语法（`@!xxx://id`）是否合法
</triggers>

<steps>

1. **识别目的 (Identify Purpose)**：先问"这份内容是被什么角色、什么场景下用？"
   - 长期身份 → role
   - 通用思维方式 → thought
   - 步骤化执行流程 → execution
   - 领域知识体系 → knowledge
   - 角色特有执行能力 → skill
   - 语言风格/禁区 → persona

2. **选择根标签 (Pick Root Tag)**：6 种根标签择一，不可混用。
   - `<role>` 包含 `<personality>` `<principle>` `<knowledge>`
   - `<thought>` 单层，自由结构
   - `<execution>` 包含 `<steps>` `<inputs>` `<outputs>`
   - `<knowledge>` 分章节，每个章节一个 `<section>`
   - `<skill>` 包含 `<name>` `<triggers>` `<steps>` `<voice>` `<anti-patterns>`
   - `<persona>` 包含 `<voice>` `<style>` `<taboos>` `<samples>`

3. **建立引用图 (Build Reference Graph)**：所有跨资源引用必须用 `@!xxx://id` 语法，避免直接内联：
   - `@!thought://first-principles` 而非 `# 一、像第一性原理那样思考......`
   - `@!knowledge://perseng-architecture` 而非内联整段架构说明
   - 引用必须能在 registry 中找到（用 `pnpm validate:content` 校验）

4. **去重 (Deduplicate)**：同一概念只在一处定义。多个资源引用同一 thought 时，每个 thought 自身要保持自洽。

5. **添加约束 (Add Constraints)**：在文件末尾加 `<invariant>` 段，列出本资源的不变量（如"激活前必须存在 active role"），便于 actAs 校验。

</steps>

<voice>
- 文件开头一句话说明"这是什么 + 给谁用"
- 段落尽量短（≤ 5 行），便于片段化加载
- 中英文混排时，专有名词用代码标注
- 引用其他资源时统一 `@!xxx://id` 格式
</voice>

<anti-patterns>
- 不要在 role 里写通用知识（拆到 knowledge）
- 不要在 thought 里写步骤（拆到 execution）
- 不要在 persona 里写工具白名单（那是 role 的事）
- 不要超过 200 行不拆文件
</anti-patterns>

<example>

输入需求：写一个"产品经理"角色，能做需求拆解

✗ 错误：
```xml
<role>
<personality>产品经理要会拆解需求，需求拆解是......（500字）</personality>
</role>
```

✓ 正确：
```xml
<role>
<personality>
我是 Perseng 的产品经理。
@!thought://user-story-mapping
@!thought://job-to-be-done
</personality>
<principle>
@!execution://requirement-decomposition
@!execution://acceptance-criteria-drafting
</principle>
<knowledge>
@!knowledge://product-philosophy
</knowledge>
</role>
```

每个引用都是 registry 中已存在的资源，便于复用与单独维护。

</example>

</skill>
