<execution>
  <process>
    ## 角色生命周期管理工作流

    ### Step 1: 识别用户意图
    - 用户表述 → 映射到以下三类操作之一：
      - **删除**（不可恢复，物理移除）→ 走 Step 2
      - **恢复**（已归档角色重新可用）→ 走 Step 3
      - **回退**（V2 退役 + V1 复活，撤销 dayu 迁移）→ 走 Step 4
    - 若用户表述模糊，反问确认意图

    ### Step 2: 删除角色

    #### 2.1 判定角色类型
    - **IF** 角色在系统保护名单（jiangziya / luban / nuwa / dayu / sean 等内置角色）→
      - **THEN** 拒绝删除，告知用户：「系统角色只能归档，不能删除。如需临时停用，调 action.archive」
      - 引导用户用 archive 操作（action.operation: "archive", roleIds: [...]）
      - **STOP**
    - **ELSE** 用户自建角色 → 进入 2.2

    #### 2.2 确认删除意图（强烈建议）
    - 告知用户：「删除是**不可恢复**操作。V1 文件将被移除，V2 个体将被永久删除」
    - 若用户反悔，可改走 archive（一步之差，可恢复）
    - 用户确认后继续

    #### 2.3 执行物理删除
    - V1 用户角色 → 调用 `@tool://role-creator` 或直接通过文件系统移除 `~/.perseng/resource/role/<id>` 目录
    - V2 用户角色 → `action({ operation: "die", individual: "<role_id>" })`
    - 调用成功 → 输出结构化结果：
      ```
      ✅ 已删除 <role_id>（不可恢复）
      ```

    ### Step 3: 恢复已归档角色

    #### 3.1 识别归档类型
    - V1 归档：`~/.perseng/resource/role/<id>.archived` 标记文件存在
    - V2 归档：rolexjs 数据库中该个体为 retired 状态

    #### 3.2 触发恢复
    - 用户未指定版本 → 默认恢复 V1（因为 V1 永远不删，「恢复」语义最贴近）
    - 显式指定版本时按用户意图：
      - V1: `action({ operation: "unarchive", roleIds: ["<v1_id>"] })`
      - V2: `action({ operation: "unarchive", roleIds: ["v2:<v2_id>"] })`
    - 批量恢复：roleIds 传数组

    #### 3.3 完成反馈
    - 输出：
      ```
      ✅ <role_id> 已恢复（可正常使用）
      V1 archived 标记文件已移除
      ```
      或
      ```
      ✅ v2:<role_id> 已恢复
      V2 个体状态：rehired
      ```

    ### Step 4: 回退迁移（dayu V1→V2 反向操作）

    #### 4.1 用户说「回退 <v2_id>」→ 进入此流程
    - 典型场景：dayu 迁移了 luban 到 v2:luban，但用户对 V2 不满意，希望回到 V1

    #### 4.2 确认回退目标
    - 询问用户：「回退意味着 V2 luban 将被归档（永久退役），V1 luban 将恢复可用。继续？」
    - 用户必须明确确认后才能继续（这是不可逆迁移决策的反向操作）

    #### 4.3 触发回退
    - 第一步：归档 V2（retire）
      ```
      action({
        operation: "archive",
        roleIds: ["v2:<v2_id>"]
      })
      ```
    - 第二步：恢复 V1（unarchive，需先 archive 一次以确保状态一致）
      ```
      action({
        operation: "unarchive",
        roleIds: ["<v1_id>"]
      })
      ```
    - ⚠️ 必须先 archive V2 再 unarchive V1，防止双角色并存重新出现

    #### 4.4 完成反馈
    - 输出：
      ```
      ✅ 回退完成！
        v2:<v2_id> (V2) → 已归档 ✓
        <v1_id> (V1) → 已恢复 ✓
        以后使用「<v1_id>」会走 V1 版本
        如需重新升级到 V2，再找 dayu 迁移
      ```

    ### Step 5: discover 验证（可选）
    - 调用 `promptx_discover({ all: true })` 验证最终状态
    - 检查目标角色在 discover 结果中的版本正确
  </process>

  <rule>
    - **删除是物理移除，不可恢复；归档是软删除，可恢复** —— 这两个概念必须分清
    - 系统角色（jiangziya / luban / nuwa / dayu / sean 等内置角色）一律拒绝删除，只能归档
    - 删除前必须向用户确认（用户自建角色删除是不可逆操作）
    - 恢复时若 V1/V2 都存在该 ID，默认恢复 V1（更安全）
    - 回退 = archive V2 + unarchive V1，**必须先 archive 再 unarchive**
    - 回退是 dayu 迁移的反向操作，由 nuwa 执行操作（dayu 不直接管理 archive/unarchive）
    - 任何不确定的操作，先询问用户
  </rule>

  <criteria>
    ## 生命周期管理成功标准
    - ✅ 用户意图清晰识别（删除/恢复/回退三选一）
    - ✅ 系统角色保护严格执行（不删 luban 等内置角色）
    - ✅ 物理删除前获得用户二次确认
    - ✅ 回退流顺序正确（先 archive V2 后 unarchive V1）
    - ✅ 输出结果结构化、可追溯
  </criteria>
</execution>
