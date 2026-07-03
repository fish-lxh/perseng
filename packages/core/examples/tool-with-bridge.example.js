/**
 * Example Tool with Bridge Support
 * 演示如何使用Bridge模式处理外部依赖
 */

module.exports = {
  getMetadata() {
    return {
      id: 'database-reporter',
      name: '数据库报表工具',
      description: '连接数据库生成报表，支持dry-run测试',
      version: '1.0.0',
      author: 'Perseng Team'
    };
  },

  getDependencies() {
    return {
      'mysql2': '^3.11.5',
      'axios': '^1.6.0'
    };
  },

  getSchema() {
    return {
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'SQL查询语句',
            pattern: '^SELECT',
            maxLength: 5000
          },
          format: {
            type: 'string',
            enum: ['json', 'table', 'csv'],
            default: 'json',
            description: '输出格式'
          },
          apiEndpoint: {
            type: 'string',
            description: 'API端点URL（可选）',
            format: 'uri'
          }
        },
        required: ['query']
      },
      environment: {
        type: 'object',
        properties: {
          DB_HOST: { type: 'string', description: '数据库主机' },
          DB_USER: { type: 'string', description: '数据库用户' },
          DB_PASSWORD: { type: 'string', description: '数据库密码' },
          DB_NAME: { type: 'string', description: '数据库名称' },
          API_KEY: { type: 'string', description: 'API密钥（可选）' }
        },
        required: ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
      }
    };
  },

  /**
   * 定义外部依赖的桥接器
   */
  getBridges() {
    return {
      // 数据库连接桥接
      'db:connect': {
        real: async function(args, api) {
          api.logger.info('[Bridge] Connecting to real database...');
          const mysql2 = await api.importx('mysql2/promise');

          const connection = await mysql2.createConnection({
            host: args.host,
            user: args.user,
            password: args.password,
            database: args.database
          });

          api.logger.info('[Bridge] Database connected successfully');
          return connection;
        },

        mock: async function(args, api) {
          api.logger.info('[Bridge] Creating mock database connection');

          // 返回一个mock连接对象
          return {
            connectionId: `mock-db-${Date.now()}`,
            config: args,
            execute: async (sql, params) => {
              api.logger.debug(`[Mock] Executing SQL: ${sql}`);

              // 根据SQL返回合理的mock数据
              if (sql.includes('COUNT(*)')) {
                return [[{ 'COUNT(*)': 42 }], []];
              }

              if (sql.includes('SUM')) {
                return [[{ total: 1234.56 }], []];
              }

              // 默认返回示例数据
              return [
                [
                  { id: 1, name: 'Alice', amount: 100 },
                  { id: 2, name: 'Bob', amount: 200 }
                ],
                [
                  { name: 'id', type: 'INT' },
                  { name: 'name', type: 'VARCHAR' },
                  { name: 'amount', type: 'DECIMAL' }
                ]
              ];
            },
            end: async () => {
              api.logger.debug('[Mock] Connection closed');
            }
          };
        }
      },

      // HTTP请求桥接
      'http:request': {
        real: async function(args, api) {
          api.logger.info(`[Bridge] Making HTTP request to ${args.url}`);
          const axios = await api.importx('axios');

          const response = await axios({
            url: args.url,
            method: args.method || 'GET',
            headers: args.headers || {},
            data: args.data
          });

          return {
            status: response.status,
            data: response.data,
            headers: response.headers
          };
        },

        mock: async function(args, api) {
          api.logger.info(`[Mock] Simulating HTTP request to ${args.url}`);

          // 返回mock响应
          return {
            status: 200,
            data: {
              success: true,
              message: 'Mock response',
              timestamp: new Date().toISOString(),
              requestUrl: args.url
            },
            headers: {
              'content-type': 'application/json',
              'x-mock-response': 'true'
            }
          };
        }
      }
    };
  },

  /**
   * 提供mock参数用于dry-run测试
   */
  getMockArgs(operation) {
    const mockArgs = {
      'db:connect': {
        host: 'localhost',
        user: 'test',
        password: 'test123',
        database: 'testdb'
      },
      'http:request': {
        url: 'https://api.example.com/report',
        method: 'POST',
        data: { test: true }
      }
    };

    return mockArgs[operation] || {};
  },

  /**
   * 定义bridge特定的错误
   */
  getBridgeErrors() {
    return {
      'db:connect': [
        {
          code: 'DB_CONNECTION_FAILED',
          description: '数据库连接失败',
          match: /ECONNREFUSED|ETIMEDOUT/,
          solution: '请检查数据库服务是否运行，以及主机和端口是否正确',
          retryable: true
        },
        {
          code: 'DB_AUTH_FAILED',
          description: '数据库认证失败',
          match: /Access denied|Authentication failed/i,
          solution: '请检查数据库用户名和密码是否正确',
          retryable: false
        }
      ],
      'http:request': [
        {
          code: 'API_RATE_LIMIT',
          description: 'API请求频率限制',
          match: /429|rate limit/i,
          solution: '请稍后重试或升级API套餐',
          retryable: true
        }
      ]
    };
  },

  /**
   * 工具执行逻辑
   */
  async execute(params) {
    const { api } = this;
    const { query, format, apiEndpoint } = params;

    try {
      // 1. 连接数据库（通过bridge）
      const dbConfig = {
        host: await api.environment.get('DB_HOST'),
        user: await api.environment.get('DB_USER'),
        password: await api.environment.get('DB_PASSWORD'),
        database: await api.environment.get('DB_NAME')
      };

      const connection = await api.bridge.execute('db:connect', dbConfig);

      // 2. 执行查询
      api.logger.info(`Executing query: ${query}`);
      const [rows, fields] = await connection.execute(query);

      // 3. 如果有API端点，发送数据
      if (apiEndpoint) {
        const apiKey = await api.environment.get('API_KEY');

        const response = await api.bridge.execute('http:request', {
          url: apiEndpoint,
          method: 'POST',
          headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
          data: {
            query: query,
            results: rows,
            timestamp: new Date().toISOString()
          }
        });

        api.logger.info(`Data sent to API: ${response.status}`);
      }

      // 4. 格式化输出
      const result = this.formatResult(rows, fields, format);

      // 5. 关闭连接
      if (connection.end) {
        await connection.end();
      }

      return {
        success: true,
        data: result,
        rowCount: rows.length,
        format: format
      };

    } catch (error) {
      api.logger.error('Execution failed:', error);
      throw error;
    }
  },

  /**
   * 格式化结果
   */
  formatResult(rows, fields, format) {
    switch (format) {
      case 'table':
        // 简单的表格格式
        const headers = fields.map(f => f.name || f.Field).join(' | ');
        const separator = '-'.repeat(headers.length);
        const dataRows = rows.map(row =>
          Object.values(row).join(' | ')
        ).join('\n');

        return `${headers}\n${separator}\n${dataRows}`;

      case 'csv':
        // CSV格式
        const csvHeaders = fields.map(f => f.name || f.Field).join(',');
        const csvRows = rows.map(row =>
          Object.values(row).map(v =>
            typeof v === 'string' && v.includes(',') ? `"${v}"` : v
          ).join(',')
        ).join('\n');

        return `${csvHeaders}\n${csvRows}`;

      case 'json':
      default:
        // JSON格式
        return {
          fields: fields.map(f => ({ name: f.name || f.Field, type: f.type })),
          rows: rows
        };
    }
  },

  /**
   * 通用业务错误定义
   */
  getBusinessErrors() {
    return [
      {
        code: 'INVALID_SQL_SYNTAX',
        description: 'SQL语法错误',
        match: /syntax error|SQL syntax/i,
        solution: '请检查SQL语句语法是否正确',
        retryable: false
      },
      {
        code: 'TABLE_NOT_FOUND',
        description: '表不存在',
        match: /Table .* doesn't exist|Unknown table/i,
        solution: '请确认表名是否正确',
        retryable: false
      }
    ];
  }
};