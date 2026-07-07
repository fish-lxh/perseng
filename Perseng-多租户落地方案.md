# Perseng 多租户落地方案

> 作者：Sean（姜山）
> 日期：2026-07-05
> 状态：架构设计文档 v1.0

---

## 目录

1. [现状分析](#1-现状分析)
2. [设计目标](#2-设计目标)
3. [总体架构](#3-总体架构)
4. [核心组件设计](#4-核心组件设计)
5. [文件系统隔离](#5-文件系统隔离)
6. [MCP 连接池隔离](#6-mcp-连接池隔离)
7. [配额控制](#7-配额控制)
8. [API 层设计](#8-api-层设计)
9. [灰度迁移方案](#9-灰度迁移方案)
10. [进程模型演进方向](#10-进程模型演进方向)

---

## 1. 现状分析

### 1.1 当前单租户的文件布局

```
~/.perseng/                    ← getPersengHomeDir()
  ├── config.json              ← 全局配置（host, port）
  ├── cognition/
  │   └── {roleId}/
  │       ├── engrams.db       ← 记忆印记
  │       └── network.json     ← 语义网络
  └── skills/                  ← Skill 文件

~/.agentx/                     ← agentxDir
  ├── data/
  │   ├── agentx.db            ← Persistence（Container/Image/Session 记录）
  │   └── queue.db             ← EventQueue
  └── containers/
      └── perseng-desktop/
          └── workdirs/
              └── {imageId}/
                  └── .claude/settings.json
```

### 1.2 当前全局状态的问题

| 问题 | 具体表现 | 影响 |
|---|---|---|
| **RuntimeEnvironment 是单例** | `static config` 全局共享 | 两个租户只能用同一个 claudeCodePath |
| **agentx.db 是单一文件** | 所有 Container/Image/Session 混在一起 | 无法按租户物理隔离 |
| **engrams.db 按角色名存** | `cognition/sean/engrams.db` | 租户 A 和 B 的 sean 会冲突 |
| **AgentXConfig 全局** | `AgentXService` 一个 config 对象 | 所有 Agent 共享同一个 API Key |
| **MCP Server 全局** | 一个 promptx MCP Server 实例 | 所有租户共用，无法按租户路由 |

---

## 2. 设计目标

### 2.1 核心原则

1. **现有租户不受影响**——灰度切换，不强制迁移
2. **改动量最小**——优先在边界层改动，不碰核心 Runtime
3. **配置下沉**——每个租户有自己的配置空间，不依赖全局单例
4. **可审计**——每个租户的资源使用可追踪

### 2.2 多租户后的文件布局

```
~/.perseng/
  ├── tenants/
  │   ├── tenant_a/
  │   │   ├── config.json         ← 租户 A 配置
  │   │   ├── cognition/
  │   │   │   └── {roleId}/
  │   │   │       ├── engrams.db
  │   │   │       └── network.json
  │   │   └── skills/
  │   └── tenant_b/
  │       └── ...
  ├── config.json                  ← 依然存在（只保留系统级配置）
  └── cognition/                   ← 依然存在（用于无租户的旧模式）

~/.agentx/
  └── tenants/
      └── tenant_a/
          ├── data/
          │   ├── agentx.db
          │   └── queue.db
          └── containers/
              └── perseng-desktop/
                  └── workdirs/
                      └── {imageId}/
                          └── .claude/settings.json
```

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Perseng 多租户架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  TenantStore                          │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ tenant_a │ │ tenant_b │ │ tenant_c │  ...        │   │
│  │  │ apiKey   │ │ apiKey   │ │ apiKey   │            │   │
│  │  │ model    │ │ model    │ │ model    │            │   │
│  │  │ mcpSvrs  │ │ mcpSvrs  │ │ mcpSvrs  │            │   │
│  │  │ quota    │ │ quota    │ │ quota    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │               RuntimeFactory                          │   │
│  │  ┌──────────────┐  ┌──────────────┐                  │   │
│  │  │  Tenant A    │  │  Tenant B    │  ...             │   │
│  │  │  Runtime     │  │  Runtime     │                  │   │
│  │  │  Container[] │  │  Container[] │                  │   │
│  │  └──────────────┘  └──────────────┘                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MCPClientManager                         │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ tenant_a │ │ tenant_b │ │ 系统级    │            │   │
│  │  │ promptx  │ │ promptx  │ │ promptx  │            │   │
│  │  │ office   │ │ office   │ │ office   │            │   │
│  │  │ custom   │ │ custom   │ │          │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                QuotaController                        │   │
│  │  每个租户: Agent 数 / Token / 存储 / 速率             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 层次说明

| 层 | 负责什么 | 技术实现 |
|---|---|---|
| **TenantStore** | 租户注册、配置管理、CRUD | better-sqlite3 + JSON |
| **RuntimeFactory** | 按租户创建隔离的 Runtime 实例 | 代理 `createAgentXRuntime` |
| **MCPClientManager** | 按租户分 MCP 连接池 | per-tenant Client Map |
| **QuotaController** | 资源配额校验和拦截 | 中间件 + 计数器 |

---

## 4. 核心组件设计

### 4.1 TenantStore——租户配置管理

```typescript
// packages/mcp-server/src/tenant/TenantStore.ts

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// ==================== 类型定义 ====================

export interface TenantLLMConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface TenantQuota {
  maxAgents: number;           // 最大并发 Agent 数（默认 5）
  maxTokensPerMonth: number;   // 月 Token 上限（默认 10M）
  maxStorageMB: number;        // 存储上限（默认 500）
  rateLimitPerSecond: number;  // API 速率限制（默认 10）
}

export interface TenantMcpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  type?: 'stdio' | 'http' | 'sse';
  url?: string;
  enabled: boolean;
}

export interface TenantConfig {
  tenantId: string;
  name: string;
  llm: TenantLLMConfig;
  mcpServers: TenantMcpServerConfig[];
  quota: TenantQuota;
  settings?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

// ==================== TenantStore ====================

export class TenantStore {
  private db: Database.Database;

  constructor(basePath: string) {
    const dbPath = path.join(basePath, 'tenants.db');
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        tenant_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL,          -- 完整 TenantConfig JSON
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenant_usage (
        tenant_id TEXT NOT NULL,
        metric TEXT NOT NULL,          -- 'tokens' | 'storage' | 'agent_hours'
        value INTEGER NOT NULL DEFAULT 0,
        period TEXT NOT NULL,          -- '2026-07' (YYYY-MM)
        PRIMARY KEY (tenant_id, metric, period)
      );
    `);
  }

  // ==================== CRUD ====================

  registerTenant(config: TenantConfig): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO tenants (tenant_id, name, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(config.tenantId, config.name, JSON.stringify(config), now, now);
  }

  getTenantConfig(tenantId: string): TenantConfig | null {
    const row = this.db.prepare(
      'SELECT config FROM tenants WHERE tenant_id = ? AND status = ?'
    ).get(tenantId, 'active') as { config: string } | undefined;
    return row ? JSON.parse(row.config) : null;
  }

  updateTenantConfig(tenantId: string, updates: Partial<TenantConfig>): void {
    const existing = this.getTenantConfig(tenantId);
    if (!existing) throw new Error(`Tenant not found: ${tenantId}`);

    const merged: TenantConfig = {
      ...existing,
      ...updates,
      tenantId, // 不可变
      updatedAt: Date.now(),
    };
    this.db.prepare(`
      UPDATE tenants SET config = ?, updated_at = ? WHERE tenant_id = ?
    `).run(JSON.stringify(merged), merged.updatedAt, tenantId);
  }

  deactivateTenant(tenantId: string): void {
    this.db.prepare(
      'UPDATE tenants SET status = ?, updated_at = ? WHERE tenant_id = ?'
    ).run('inactive', Date.now(), tenantId);
  }

  listActiveTenants(): TenantConfig[] {
    const rows = this.db.prepare(
      'SELECT config FROM tenants WHERE status = ?'
    ).all('active') as { config: string }[];
    return rows.map(r => JSON.parse(r.config));
  }

  // ==================== 使用量追踪 ====================

  recordUsage(tenantId: string, metric: string, amount: number): void {
    const period = this.currentPeriod();
    this.db.prepare(`
      INSERT INTO tenant_usage (tenant_id, metric, value, period)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id, metric, period) DO UPDATE SET
        value = value + excluded.value
    `).run(tenantId, metric, amount, period);
  }

  getUsage(tenantId: string, metric: string): number {
    const period = this.currentPeriod();
    const row = this.db.prepare(
      'SELECT value FROM tenant_usage WHERE tenant_id = ? AND metric = ? AND period = ?'
    ).get(tenantId, metric, period) as { value: number } | undefined;
    return row?.value ?? 0;
  }

  private currentPeriod(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  dispose(): void {
    this.db.close();
  }
}
```

### 4.2 TenantStore 的配置注入

```typescript
// packages/mcp-server/src/tenant/TenantContext.ts

import { TenantStore, type TenantConfig, type TenantQuota } from './TenantStore';

/**
 * TenantContext —— 请求级租户上下文。
 *
 * 设计思路：不把 tenantId 塞进现有接口的每个参数里，
 * 而是通过 AsyncLocalStorage 隐式传递。
 */
import { AsyncLocalStorage } from 'async_hooks';

export const tenantContext = new AsyncLocalStorage<{ tenantId: string }>();

export function getCurrentTenantId(): string | undefined {
  return tenantContext.getStore()?.tenantId;
}

/**
 * 返回当前租户的配置（如果不在租户上下文中，返回 null）
 */
export function getCurrentTenantConfig(store: TenantStore): TenantConfig | null {
  const tid = getCurrentTenantId();
  if (!tid) return null;
  return store.getTenantConfig(tid);
}
```

### 4.3 TenantConfig API

```typescript
// packages/mcp-server/src/tenant/TenantApi.ts

import { Router } from 'express'; // 或 Hono / 其他
import { TenantStore, type TenantConfig } from './TenantStore';

export function createTenantApi(store: TenantStore): Router {
  const router = Router();

  // POST /api/tenants — 注册新租户
  router.post('/tenants', (req, res) => {
    const config = req.body as TenantConfig;
    try {
      store.registerTenant({
        ...config,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      res.status(201).json({ tenantId: config.tenantId });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/tenants — 列出所有活跃租户
  router.get('/tenants', (_req, res) => {
    const tenants = store.listActiveTenants();
    // 脱敏：不返回 apiKey
    const sanitized = tenants.map(t => ({
      ...t,
      llm: { ...t.llm, apiKey: '***' },
    }));
    res.json(sanitized);
  });

  // GET /api/tenants/:tenantId — 查询单个租户
  router.get('/tenants/:tenantId', (req, res) => {
    const config = store.getTenantConfig(req.params.tenantId);
    if (!config) return res.status(404).json({ error: 'Tenant not found' });
    res.json({ ...config, llm: { ...config.llm, apiKey: '***' } });
  });

  // PUT /api/tenants/:tenantId — 更新租户配置
  router.put('/tenants/:tenantId', (req, res) => {
    try {
      store.updateTenantConfig(req.params.tenantId, req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/tenants/:tenantId — 停用租户
  router.delete('/tenants/:tenantId', (req, res) => {
    store.deactivateTenant(req.params.tenantId);
    res.json({ success: true });
  });

  // GET /api/tenants/:tenantId/usage — 使用量
  router.get('/tenants/:tenantId/usage', (req, res) => {
    const tokens = store.getUsage(req.params.tenantId, 'tokens');
    const storage = store.getUsage(req.params.tenantId, 'storage');
    res.json({ tokens, storage });
  });

  return router;
}
```

---

## 5. 文件系统隔离

### 5.1 路径管理

```typescript
// packages/mcp-server/src/tenant/TenantPaths.ts

import * as path from 'path';
import * as os from 'os';

const PERSEGN_HOME = path.join(os.homedir(), '.perseng');
const AGENTX_HOME = path.join(os.homedir(), '.agentx');

export class TenantPaths {
  constructor(private tenantId: string) {}

  /** 租户根目录 */
  get root(): string {
    return path.join(PERSEGN_HOME, 'tenants', this.tenantId);
  }

  /** 认知数据目录 */
  get cognitionDir(): string {
    return path.join(this.root, 'cognition');
  }

  /** 某个角色的 engrams 数据库 */
  engramsDb(roleId: string): string {
    return path.join(this.cognitionDir, roleId, 'engrams.db');
  }

  /** 某个角色的语义网络文件 */
  networkJson(roleId: string): string {
    return path.join(this.cognitionDir, roleId, 'network.json');
  }

  /** Skill 目录 */
  get skillsDir(): string {
    return path.join(this.root, 'skills');
  }

  /** 租户配置 */
  get configFile(): string {
    return path.join(this.root, 'config.json');
  }

  /** AgentX 数据目录 */
  get agentxDir(): string {
    return path.join(AGENTX_HOME, 'tenants', this.tenantId);
  }

  /** AgentX 数据库 */
  get agentxDb(): string {
    return path.join(this.agentxDir, 'data', 'agentx.db');
  }

  /** EventQueue 数据库 */
  get queueDb(): string {
    return path.join(this.agentxDir, 'data', 'queue.db');
  }

  /** Container workdir 根目录 */
  get workdirsRoot(): string {
    return path.join(this.agentxDir, 'containers', 'perseng-desktop', 'workdirs');
  }

  /** 某个 Image 的工作目录 */
  imageWorkdir(imageId: string): string {
    return path.join(this.workdirsRoot, imageId);
  }

  /** 确保所有目录存在 */
  ensureDirs(): void {
    const dirs = [
      this.root,
      this.cognitionDir,
      this.skillsDir,
      path.join(this.agentxDir, 'data'),
      this.workdirsRoot,
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
}
```

### 5.2 文件系统隔离规则

| 资源 | 旧路径（单租户） | 新路径（多租户） |
|---|---|---|
| 租户配置 | `~/.perseng/config.json` | `~/.perseng/tenants/{id}/config.json` |
| 记忆数据 | `~/.perseng/cognition/{role}/` | `~/.perseng/tenants/{id}/cognition/{role}/` |
| Skills | `~/.perseng/skills/` | `~/.perseng/tenants/{id}/skills/` |
| AgentX 数据 | `~/.agentx/data/` | `~/.agentx/tenants/{id}/data/` |
| Workdirs | `~/.agentx/containers/...` | `~/.agentx/tenants/{id}/containers/...` |

### 5.3 DatabaseManager 的租户感知扫描

```typescript
// 修改 DatabaseManager.ts —— 增加租户感知能力

export function scanTenantPersengHome(rootDir: string, tenantId?: string): DbItem[] {
  const searchRoot = tenantId
    ? path.join(rootDir, 'tenants', tenantId)
    : rootDir;

  if (!fs.existsSync(searchRoot)) return [];

  const items: DbItem[] = [];
  walk(searchRoot, searchRoot, 0, items);

  // 标记每个 item 所属的租户
  for (const item of items) {
    (item as any).tenantId = tenantId; // 前端 UI 按租户分组
  }

  items.sort((a, b) => {
    const dirCmp = path.dirname(a.relativePath).localeCompare(path.dirname(b.relativePath));
    return dirCmp !== 0 ? dirCmp : a.name.localeCompare(b.name);
  });
  return items;
}
```

### 5.4 CognitionWindow 的租户感知

```typescript
// 修改 CognitionWindow.ts —— 读正确租户下的数据

private getCognitionPath(roleId: string): string {
  // 从请求上下文中解析 tenantId
  const tenantId = getCurrentTenantId();

  if (tenantId) {
    const tenantPaths = new TenantPaths(tenantId);
    return tenantPaths.cognitionDir;
  }

  // 无租户上下文 → 旧路径（兼容模式）
  return path.join(os.homedir(), '.perseng', 'cognition', roleId);
}
```

---

## 6. MCP 连接池隔离

### 6.1 MCPClientManager

```typescript
// packages/mcp-server/src/tenant/MCPClientManager.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { TenantConfig } from './TenantStore';

export class MCPClientManager {
  /**
   * Map: tenantId → Map<serverName, Client>
   *
   * 每个租户有自己独立的 MCP 连接池。
   * 系统级 MCP 连接（promptx 内置服务）用 tenantId='__system__'。
   */
  private static clients = new Map<string, Map<string, Client>>();

  // ==================== 初始化 ====================

  /**
   * 为某个租户初始化 MCP 连接池。
   * 包括：内置 promptx 服务 + 租户自定义 MCP Server。
   */
  static async initializeForTenant(
    tenantId: string,
    config: TenantConfig,
    systemMcpServers?: Record<string, any>,
  ): Promise<void> {
    if (this.clients.has(tenantId)) {
      // 已初始化，跳过
      return;
    }

    const tenantClients = new Map<string, Client>();

    // 1. 系统级 MCP Server（promptx、mcp-office、mcp-workspace 等）
    if (systemMcpServers) {
      for (const [name, serverConfig] of Object.entries(systemMcpServers)) {
        const client = await this.createClient(
          `perseng-${tenantId}-${name}`,
          serverConfig,
        );
        tenantClients.set(name, client);
      }
    }

    // 2. 租户自定义 MCP Server
    for (const serverConfig of config.mcpServers) {
      if (!serverConfig.enabled) continue;

      const client = await this.createClient(
        `perseng-${tenantId}-${serverConfig.name}`,
        serverConfig,
      );
      tenantClients.set(serverConfig.name, client);
    }

    this.clients.set(tenantId, tenantClients);
  }

  // ==================== 查询 ====================

  /**
   * 获取某个租户的 MCP 工具列表。
   */
  static async getToolsForTenant(
    tenantId: string,
  ): Promise<Array<{ serverName: string; toolName: string; description: string; inputSchema: any }>> {
    const tenantClients = this.clients.get(tenantId);
    if (!tenantClients) return [];

    const tools: Array<any> = [];
    for (const [serverName, client] of tenantClients) {
      try {
        const result = await client.listTools();
        for (const tool of result.tools) {
          tools.push({
            serverName,
            toolName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      } catch (err) {
        console.warn(`[MCPClientManager] Failed to list tools for ${serverName}:`, err);
      }
    }
    return tools;
  }

  /**
   * 执行某个租户的 MCP 工具调用。
   * 自动路由到正确的租户连接池。
   */
  static async callTool(
    tenantId: string,
    serverName: string,
    toolName: string,
    args: Record<string, any>,
  ): Promise<any> {
    const tenantClients = this.clients.get(tenantId);
    if (!tenantClients) {
      throw new Error(`No MCP clients for tenant: ${tenantId}`);
    }

    const client = tenantClients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not found for tenant: ${tenantId}`);
    }

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return result;
  }

  // ==================== 生命周期 ====================

  /** 清理某个租户的所有 MCP 连接 */
  static async disposeTenant(tenantId: string): Promise<void> {
    const tenantClients = this.clients.get(tenantId);
    if (!tenantClients) return;

    for (const [name, client] of tenantClients) {
      try {
        await client.close();
      } catch (err) {
        console.warn(`[MCPClientManager] Failed to close ${name}:`, err);
      }
    }

    this.clients.delete(tenantId);
  }

  /** 清理所有租户的 MCP 连接 */
  static async disposeAll(): Promise<void> {
    for (const tenantId of this.clients.keys()) {
      await this.disposeTenant(tenantId);
    }
  }

  // ==================== 内部 ====================

  private static async createClient(
    name: string,
    config: any,
  ): Promise<Client> {
    const client = new Client({ name, version: '1.0.0' });

    if (config.command) {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env || {},
      });
      await client.connect(transport);
    } else if (config.url) {
      const transport = new SSEClientTransport(new URL(config.url));
      await client.connect(transport);
    } else {
      throw new Error(`Invalid MCP server config for ${name}: no command or url`);
    }

    return client;
  }
}
```

### 6.2 promptx MCP Server 的租户感知

promptx MCP Server 是所有角色的注册中心，在多租户下需要在工具调用层面感知租户：

```typescript
// 修改 promptx MCP Server —— 在 action/recall/remember 工具中添加 tenantId 参数

// 伪代码示意：
export const actionTool = {
  name: 'action',
  inputSchema: {
    type: 'object',
    properties: {
      role: { type: 'string' },
      tenantId: { type: 'string' },  // ← 新增
      operation: { type: 'string' },
      // ... 其他参数
    },
  },
  handler: async (args) => {
    const { tenantId, role, operation } = args;
    // 根据 tenantId 选择正确的 engrams.db 路径
    const dbPath = tenantId
      ? new TenantPaths(tenantId).engramsDb(role)
      : path.join(os.homedir(), '.perseng', 'cognition', role, 'engrams.db');
    // ... 执行操作
  },
};
```

---

## 7. 配额控制

### 7.1 QuotaController

```typescript
// packages/mcp-server/src/tenant/QuotaController.ts

import { TenantStore, type TenantConfig, type TenantQuota } from './TenantStore';

export class QuotaController {
  constructor(private store: TenantStore) {}

  // ==================== 并发 Agent 配额 ====================

  /** 检查租户是否可以创建新 Agent */
  canCreateAgent(tenantId: string, currentAgentCount: number): boolean {
    const config = this.store.getTenantConfig(tenantId);
    if (!config) return false;
    return currentAgentCount < config.quota.maxAgents;
  }

  // ==================== Token 配额 ====================

  /** 检查租户是否还有 Token 余量 */
  async checkTokenQuota(tenantId: string): Promise<{ allowed: boolean; remaining: number }> {
    const config = this.store.getTenantConfig(tenantId);
    if (!config) return { allowed: false, remaining: 0 };

    const used = this.store.getUsage(tenantId, 'tokens');
    const remaining = config.quota.maxTokensPerMonth - used;

    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
    };
  }

  /** 记录 Token 消耗 */
  recordTokenUsage(tenantId: string, tokens: number): void {
    this.store.recordUsage(tenantId, 'tokens', tokens);
  }

  // ==================== 存储配额 ====================

  /** 检查存储配额 */
  async checkStorageQuota(tenantId: string): Promise<{ allowed: boolean; usedMB: number; maxMB: number }> {
    const config = this.store.getTenantConfig(tenantId);
    if (!config) return { allowed: false, usedMB: 0, maxMB: 0 };

    const usedBytes = await this.calcTenantStorageSize(tenantId);
    const usedMB = Math.ceil(usedBytes / (1024 * 1024));

    return {
      allowed: usedMB < config.quota.maxStorageMB,
      usedMB,
      maxMB: config.quota.maxStorageMB,
    };
  }

  /** 计算租户实际存储量 */
  private async calcTenantStorageSize(tenantId: string): Promise<number> {
    const tenantPaths = new TenantPaths(tenantId);
    const root = tenantPaths.root;

    if (!fs.existsSync(root)) return 0;

    let totalSize = 0;
    const files = fs.readdirSync(root, { recursive: true }) as string[];
    for (const file of files) {
      try {
        const fullPath = path.join(root, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) totalSize += stat.size;
      } catch {
        // 权限问题跳过
      }
    }
    return totalSize;
  }

  // ==================== 速率限制 ====================

  /** 简单的滑动窗口速率限制 */
  private rateLimitCounters = new Map<string, { count: number; resetAt: number }>();

  checkRateLimit(tenantId: string): boolean {
    const config = this.store.getTenantConfig(tenantId);
    if (!config) return false;

    const now = Date.now();
    const entry = this.rateLimitCounters.get(tenantId);

    if (!entry || now > entry.resetAt) {
      // 新窗口
      this.rateLimitCounters.set(tenantId, {
        count: 1,
        resetAt: now + 1000,
      });
      return true;
    }

    if (entry.count >= config.quota.rateLimitPerSecond) {
      return false; // 限流
    }

    entry.count++;
    return true;
  }
}
```

### 7.2 配额拦截中间件

```typescript
// 在 AgentXService 或 API 网关层加配额拦截

export async function withQuotaCheck(
  tenantId: string,
  quotaController: QuotaController,
  action: () => Promise<any>,
): Promise<any> {
  // 1. 速率限制
  if (!quotaController.checkRateLimit(tenantId)) {
    throw new Error('Rate limit exceeded');
  }

  // 2. Token 配额
  const tokenCheck = await quotaController.checkTokenQuota(tenantId);
  if (!tokenCheck.allowed) {
    throw new Error(`Token quota exceeded. Remaining: ${tokenCheck.remaining}`);
  }

  // 3. 执行动作
  const result = await action();

  return result;
}
```

---

## 8. API 层设计

### 8.1 MCP Tool 中新增的租户管理工具

在 promptx MCP Server 中新增以下工具：

| 工具名 | 功能 | 参数 |
|---|---|---|
| `tenant_register` | 注册新租户 | tenantId, name, llm, mcpServers, quota |
| `tenant_get_config` | 获取租户配置 | tenantId |
| `tenant_update_config` | 更新租户配置 | tenantId, updates |
| `tenant_deactivate` | 停用租户 | tenantId |
| `tenant_list` | 列出所有活跃租户 | 无 |
| `tenant_get_usage` | 查看租户使用量 | tenantId |

```typescript
// 工具注册示例

export const tenantTools = [
  {
    name: 'tenant_register',
    description: '注册新的多租户',
    inputSchema: {
      type: 'object',
      properties: {
        tenantId: { type: 'string', description: '租户唯一 ID' },
        name: { type: 'string', description: '租户名称' },
        apiKey: { type: 'string', description: 'LLM API Key' },
        model: { type: 'string', description: '模型名称（可选）' },
        mcpServers: {
          type: 'array',
          description: '租户专属 MCP Server 配置（可选）',
        },
        maxAgents: { type: 'number', description: '最大并发 Agent 数（默认 5）' },
      },
      required: ['tenantId', 'name', 'apiKey'],
    },
    handler: async (args: any) => {
      const store = getTenantStore();
      store.registerTenant({
        tenantId: args.tenantId,
        name: args.name,
        llm: {
          apiKey: args.apiKey,
          model: args.model || 'claude-sonnet-4-20250514',
        },
        mcpServers: args.mcpServers || [],
        quota: {
          maxAgents: args.maxAgents || 5,
          maxTokensPerMonth: 10_000_000,
          maxStorageMB: 500,
          rateLimitPerSecond: 10,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // 预初始化 MCP 连接池
      const config = store.getTenantConfig(args.tenantId)!;
      await MCPClientManager.initializeForTenant(
        args.tenantId,
        config,
        getSystemMcpServers(),
      );

      return { success: true, tenantId: args.tenantId };
    },
  },
  // ... 其他工具
];
```

---

## 9. 灰度迁移方案

### 9.1 阶段划分

```
Phase 1: TenantStore + API 层（纯新增，不改现有逻辑）
  Week 1-2
  产出: TenantStore 数据库、CRUD API、MCPClientManager

Phase 2: 文件系统隔离 + Runtime 改造
  Week 3-4
  产出: TenantPaths、租户感知的文件读写、RuntimeFactory

Phase 3: 配额控制 + 灰度切换
  Week 5-6
  产出: QuotaController、AgentXService 支持多租户模式

Phase 4: 全量迁移
  Week 7-8
  产出: 现有单租户数据迁移到 tenant_default
```

### 9.2 Phase 1：TenantStore + API 层

**改什么**：
- 所有代码是新增的，不碰现有文件
- `packages/mcp-server/src/tenant/TenantStore.ts`
- `packages/mcp-server/src/tenant/TenantApi.ts`
- `packages/mcp-server/src/tenant/TenantPaths.ts`
- `packages/mcp-server/src/tenant/MCPClientManager.ts`

**验证方式**：
```
1. 启动 Perseng，系统跟之前完全一样
2. 通过 API 注册一个测试租户
3. 查询租户配置，确认已持久化
4. 现有用户不受任何影响
```

### 9.3 Phase 2：文件隔离 + Runtime

**改什么**：
- `DatabaseManager.ts` —— 增加 `scanTenantPersengHome()`
- `CognitionWindow.ts` —— 增加租户感知路径解析
- `createAgentXRuntime.ts` —— 改为接收 `tenantId` 参数，使用 `TenantPaths` 确定数据库路径

**关键改动——createAgentXRuntime 的租户感知版本**：

```typescript
export async function createTenantAgentXRuntime(
  config: AgentXRuntimeConfig & { tenantId: string },
): Promise<BuiltRuntime> {
  const tenantPaths = new TenantPaths(config.tenantId);
  tenantPaths.ensureDirs();

  const basePath = tenantPaths.agentxDir;
  const storagePath = tenantPaths.agentxDb;
  const queuePath = tenantPaths.queueDb;

  // 其余逻辑跟原来的 createAgentXRuntime 一样，
  // 只是所有路径从 ~/.agentx/ 变成了 ~/.agentx/tenants/{tenantId}/
  // ...
}
```

**配置开关**：

```typescript
// AgentXConfig 新增
export interface AgentXConfig {
  // ... 现有字段

  // 多租户模式
  multiTenant?: boolean;       // 默认 false
  defaultTenantId?: string;    // 默认 'default'
}
```

### 9.4 Phase 3：配额 + 灰度

```typescript
// AgentXService.start() 中的逻辑

async start(): Promise<void> {
  if (this.config.multiTenant) {
    // 多租户模式：每个 Container 绑定一个租户
    const tenants = tenantStore.listActiveTenants();
    for (const tenant of tenants) {
      // 为每个租户创建隔离的 Runtime
      const runtime = await createTenantAgentXRuntime({
        tenantId: tenant.tenantId,
        llm: tenant.llm,
        defaultAgent: { ... },
      });
      this.tenantRuntimes.set(tenant.tenantId, runtime);
    }
  } else {
    // 单租户模式：原有逻辑不变
    const built = await createAgentXRuntime({
      llm: { apiKey, baseUrl, model },
      ...
    });
    // ...
  }
}
```

### 9.5 Phase 4：数据迁移

```typescript
// 将现有单租户数据迁移到 tenant_default

export async function migrateToMultiTenant(): Promise<void> {
  const persengHome = getPersengHomeDir();
  const tenantPaths = new TenantPaths('default');
  tenantPaths.ensureDirs();

  // 1. 迁移 cognition 数据
  const oldCognition = path.join(persengHome, 'cognition');
  if (fs.existsSync(oldCognition)) {
    await fs.promises.cp(oldCognition, tenantPaths.cognitionDir, { recursive: true });
  }

  // 2. 迁移 skills
  const oldSkills = path.join(persengHome, 'skills');
  if (fs.existsSync(oldSkills)) {
    await fs.promises.cp(oldSkills, tenantPaths.skillsDir, { recursive: true });
  }

  // 3. 注册默认租户
  const store = getTenantStore();
  store.registerTenant({
    tenantId: 'default',
    name: 'Default Tenant',
    llm: { apiKey: '<migrated>' }, // 从旧配置读取
    mcpServers: [],
    quota: { maxAgents: 5, maxTokensPerMonth: 10_000_000, maxStorageMB: 500, rateLimitPerSecond: 10 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
```

---

## 10. 进程模型演进方向

多租户隔离到一定程度后，可以选的几种进程模型：

### 10.1 单进程多租户（当前方案，Phase 1-3）

```
一个 Node.js 进程
  ├── TenantStore（共享）
  ├── MCPClientManager（按租户分连接池）
  ├── Runtime A（租户 A）
  │   ├── Container A1
  │   └── Container A2
  └── Runtime B（租户 B）
      └── Container B1
```

**优点**：改动最小，共享内存，运维简单
**缺点**：一个租户 OOM 会影响所有租户，无 CPU 隔离

### 10.2 多进程多租户（Phase 4 后可选）

```
主进程（管理面）
  ├── TenantStore
  ├── MCPClientManager（共享但每个进程独立连接）
  │
  ├── 子进程：Worker A（租户 A）
  │   └── Runtime A（只加载租户 A 的数据）
  │
  └── 子进程：Worker B（租户 B）
      └── Runtime B（只加载租户 B 的数据）
```

**优点**：进程级隔离，一个挂不影响其他，可分别限 CPU/内存
**缺点**：进程间通信开销，需要序列化 SystemBus 事件

### 10.3 容器化（长期方向）

```
Kubernetes Pod
  ├── Sidecar：promptx MCP Server（共享）
  │
  ├── Pod A：Runtime for 租户 A
  │   └── Resource limits: CPU 1核, 内存 2G
  │
  └── Pod B：Runtime for 租户 B
      └── Resource limits: CPU 2核, 内存 4G
```

**优点**：真正的硬件隔离，独立扩缩容，计费方便
**缺点**：运维成本最高，需要 K8s 基础设施

### 10.4 推荐演进路径

```
Phase 1-3: 单进程多租户 ← 先跑起来
    ↓ 当租户数量 > 50 或出现噪声邻居问题
Phase 4+:   多进程多租户 ← worker_threads 或 child_process
    ↓ 当需要独立部署 / 自动扩缩容
长期:      容器化 ← K8s
```

---

## 总结

这份方案的核心原则：

1. **不改现有核心代码**——`RuntimeAgent`、`RuntimeContainer`、`RuntimeSession` 不碰
2. **灰度切换**——`multiTenant: true/false` 配置开关，现有用户不受影响
3. **文件系统隔离**——所有路径加 `tenants/{tenantId}` 前缀
4. **MCP 连接隔离**——`MCPClientManager` 按租户分连接池
5. **配额控制**——并发 Agent 数、Token 消耗、存储大小、速率限制

跟 LangGraph 无关。先解决基础设施层的隔离问题，再考虑多 Agent 编排。
