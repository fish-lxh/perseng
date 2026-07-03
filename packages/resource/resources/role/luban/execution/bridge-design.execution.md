# Bridge设计规范

<execution>

<constraint>
## Bridge约束
- 所有外部依赖必须通过Bridge隔离
- 每个Bridge必须同时有real和mock实现
- Mock数据结构必须与真实一致
- 使用api.bridge.execute()调用
- Bridge名称使用冒号分隔：category:operation
</constraint>

<rule>
## Bridge规则
- 先设计mock，再写real实现
- Mock要覆盖成功和失败场景
- 错误处理要与真实一致
- 不允许在execute中直接调用外部模块
</rule>

<guideline>
## Bridge设计指南
- 识别所有外部依赖点
- 为每个依赖设计清晰的接口
- Mock数据要合理且完整
- 提供getMockArgs生成测试参数
</guideline>

<process>
## Bridge实现步骤

### Step 1: 识别外部依赖
分析工具需要的外部调用：
- 数据库连接（mysql、postgres、mongodb）
- HTTP请求（REST API、GraphQL）
- 文件系统操作（读写文件）
- 第三方服务（邮件、短信、云服务）
- 缓存系统（redis、memcached）

### Step 2: 定义getBridges方法
```javascript
getBridges() {
  return {
    // 数据库操作Bridge
    'db:connect': {
      real: async (args, api) => {
        // 真实实现：连接实际数据库
        api.logger.info('[Bridge] Connecting to database...');
        const mysql2 = await api.importx('mysql2/promise');
        const connection = await mysql2.createConnection({
          host: args.host,
          user: args.user,
          password: args.password,
          database: args.database
        });
        api.logger.info('[Bridge] Database connected');
        return connection;
      },
      mock: async (args, api) => {
        // Mock实现：返回模拟连接
        api.logger.debug('[Mock] Creating mock database connection');
        return {
          connectionId: `mock-${Date.now()}`,
          execute: async (sql) => {
            // 根据SQL返回合理的mock数据
            if (sql.includes('SELECT COUNT')) {
              return [[{ count: 42 }], []];
            }
            return [[{ id: 1, name: 'test' }], []];
          },
          end: async () => {
            api.logger.debug('[Mock] Connection closed');
          }
        };
      }
    },

    // HTTP请求Bridge
    'http:request': {
      real: async (args, api) => {
        api.logger.info(`[Bridge] HTTP ${args.method} ${args.url}`);
        const axios = await api.importx('axios');
        return await axios(args);
      },
      mock: async (args, api) => {
        api.logger.debug(`[Mock] HTTP ${args.method} ${args.url}`);
        return {
          status: 200,
          data: { success: true, mock: true },
          headers: { 'content-type': 'application/json' }
        };
      }
    }
  };
}
```

### Step 3: 设计Mock数据
Mock数据设计原则：
- **结构一致**：与真实API返回结构完全相同
- **数据合理**：使用合理的示例数据
- **场景完整**：覆盖成功、失败、边界情况
- **类型正确**：保持数据类型的一致性

示例Mock数据设计：
```javascript
// 成功场景
mockSuccess: { status: 'success', data: [...] }

// 失败场景
mockError: { status: 'error', message: 'Mock error' }

// 空数据场景
mockEmpty: { status: 'success', data: [] }

// 分页场景
mockPaginated: {
  data: [...],
  page: 1,
  total: 100,
  hasMore: true
}
```

### Step 4: 提供测试参数
```javascript
getMockArgs(operation) {
  const mockArgs = {
    'db:connect': {
      host: 'localhost',
      user: 'test',
      password: 'test123',
      database: 'testdb'
    },
    'http:request': {
      url: 'https://api.example.com/test',
      method: 'GET',
      headers: {}
    }
  };

  return mockArgs[operation] || {};
}
```

### Step 5: 定义Bridge错误
```javascript
getBridgeErrors() {
  return {
    'db:connect': [
      {
        code: 'CONNECTION_REFUSED',
        match: /ECONNREFUSED/,
        solution: '检查数据库服务是否运行',
        retryable: true
      }
    ],
    'http:request': [
      {
        code: 'TIMEOUT',
        match: /ETIMEDOUT|TIMEOUT/i,
        solution: '检查网络连接或增加超时时间',
        retryable: true
      }
    ]
  };
}
```

### Step 6: 在execute中使用Bridge
```javascript
async execute(params) {
  const { api } = this;

  // ❌ 错误：直接调用外部模块
  // const mysql = await api.importx('mysql2');
  // const conn = await mysql.createConnection();

  // ✅ 正确：通过Bridge调用
  const conn = await api.bridge.execute('db:connect', {
    host: await api.environment.get('DB_HOST'),
    user: await api.environment.get('DB_USER'),
    password: await api.environment.get('DB_PASSWORD'),
    database: await api.environment.get('DB_NAME')
  });

  // 使用连接
  const [rows] = await conn.execute(params.query);

  // 关闭连接
  if (conn.end) {
    await conn.end();
  }

  return { success: true, data: rows };
}
```

</process>

<criteria>
## Bridge质量标准
- ✅ 所有外部依赖都通过Bridge
- ✅ 每个Bridge都有mock实现
- ✅ Mock数据结构与真实一致
- ✅ 错误处理完善
- ✅ Dry-run测试通过
</criteria>

</execution>