# 集成模式知识库

<knowledge>

## 核心集成模式

### 🎯 五大意图模式
1. **输出型集成（OUTPUT）**
   - 场景：发消息、通知、推送、写入
   - 关键：找到正确的endpoint
   - 示例：企微通知、邮件发送、数据写入

2. **输入型集成（INPUT）**
   - 场景：查询、读取、获取、拉取
   - 关键：构造正确的查询参数
   - 示例：数据库查询、API调用、文件读取

3. **触发型集成（TRIGGER）**
   - 场景：监听、订阅、响应、触发
   - 关键：建立持续连接或轮询
   - 示例：Webhook监听、事件订阅、状态监控

4. **转换型集成（TRANSFORM）**
   - 场景：格式转换、数据处理、编解码
   - 关键：理解输入输出格式
   - 示例：JSON转XML、图片处理、文档转换

5. **编排型集成（ORCHESTRATE）**
   - 场景：流程控制、任务编排、状态机
   - 关键：管理多步骤和状态
   - 示例：工作流、审批流、自动化流程

### 🔑 四种认证模式
1. **密钥模式（API_KEY）**
   - 特征：固定密钥，长期有效
   - 使用：Header/Query参数传递
   - 示例：`X-API-Key: sk-xxxxx`

2. **令牌模式（TOKEN）**
   - 特征：需要先获取，有时效性
   - 使用：Bearer Token方式
   - 示例：`Authorization: Bearer xxxxx`

3. **签名模式（SIGNATURE）**
   - 特征：每个请求都要签名
   - 使用：HMAC/RSA签名
   - 示例：timestamp + nonce + signature

4. **会话模式（SESSION）**
   - 特征：保持连接状态
   - 使用：Cookie/SessionID
   - 示例：登录后保持会话

### 🔄 四种交互模式
1. **推送模式（PUSH）**
   - 方式：HTTP POST/PUT
   - 特点：主动发送，即时响应
   - 适用：通知、写入操作

2. **拉取模式（PULL）**
   - 方式：HTTP GET/Query
   - 特点：主动查询，按需获取
   - 适用：数据查询、状态检查

3. **订阅模式（SUBSCRIBE）**
   - 方式：WebSocket/SSE/长轮询
   - 特点：持续连接，实时推送
   - 适用：实时数据、事件流

4. **回调模式（CALLBACK）**
   - 方式：Webhook/异步通知
   - 特点：异步处理，完成通知
   - 适用：长时任务、异步操作

## 模式组合矩阵

| 意图 | 认证 | 交互 | 典型场景 |
|------|------|------|----------|
| OUTPUT | API_KEY | PUSH | 发送通知消息 |
| INPUT | TOKEN | PULL | 查询API数据 |
| TRIGGER | WEBHOOK | CALLBACK | 接收事件通知 |
| TRANSFORM | API_KEY | PUSH/PULL | 格式转换服务 |
| ORCHESTRATE | OAUTH | MULTIPLE | 复杂业务流程 |

## 快速模式匹配

### 听到关键词 → 立即识别模式
- "发送/通知" → OUTPUT + PUSH
- "查询/获取" → INPUT + PULL
- "监听/触发" → TRIGGER + SUBSCRIBE
- "转换/处理" → TRANSFORM + PUSH/PULL
- "流程/编排" → ORCHESTRATE + MULTIPLE

### 平台类型 → 默认模式
- IM平台 → OUTPUT + WEBHOOK + PUSH
- 数据平台 → INPUT + API_KEY + PULL
- 代码平台 → MULTIPLE + TOKEN + REST
- AI平台 → INPUT/OUTPUT + API_KEY + REST

</knowledge>