/**
 * handoff - 角色协作交接桥接工具
 *
 * KNUTH-FEAT 2026-07-06: 集成到 Perseng 工具生态
 * - 位置: packages/resource/resources/tool/handoff/handoff.tool.js
 * - 共享介质: api.storage（Perseng 工具统一存储抽象，基于 remember/learning
 *   体系演化而来的工具间共享 key-value 持久层）
 * - 协议层: send/poll/update 三段式 + 状态机 + 幂等性 + 路由标签 + 超时
 *
 * 战略意义：
 * 1. 角色解耦：姜子牙与女娲通过共享知识图谱异步协作，无需直接对话
 * 2. 协议标准化：将 handoff 协议封装为标准工具接口，任何角色都能接入
 * 3. 状态可追溯：通过 conversation_id 追踪完整交接链路
 *
 * 状态机：
 *   send ──→ pending ──→ acknowledged ──→ in_progress ──→ completed
 *                            ↘ stalled ──→ failed
 *   pending 超时 → 自动重试（最多3次）
 *   in_progress 超时 → stalled → 通知相关方
 *
 * 幂等性：同一 conversation_id 的重复 update 自动忽略
 * 路由：自动注入 to:xxx / from:xxx / type:xxx / cc:xxx 标签
 * 抄送：cc 参数支持多角色知会，不影响状态机
 *
 * 设计理念：
 * 基于共享知识图谱的消息总线模式，实现角色间的异步任务交接。
 * 姜子牙 send → 知识图谱 → 女娲 poll/update，形成完整的交付闭环。
 * 使用 api.storage 持久化存储，确保重启不丢失。
 *
 * 生态定位：
 * 作为 Perseng 角色协作基础设施的核心工具，支撑多角色工作流编排。
 */
module.exports = {
  getDependencies() {
    return {};
  },

  getMetadata() {
    return {
      id: 'handoff',
      name: '角色协作交接工具',
      description: '支持角色间通过共享知识图谱进行任务交接的桥接工具（send/poll/update + 状态机 + 路由标签 + 超时）',
      version: '1.1.0',
      category: 'system',
      author: 'luban',
      tags: ['handoff', 'collaboration', 'messaging', 'state-machine', 'system'],
      scenarios: [
        '姜子牙 → 女娲：设计方案交付',
        '女娲 → 姜子牙：实现完成回报',
        '姜子牙 → 鲁班：工具需求交付',
        '任意角色 → 大禹：角色迁移请求',
        'cc 抄送实现多角色异步知会',
        '跨 session 任务追踪（持久化于 api.storage）'
      ]
    };
  },

  getSchema() {
    return {
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['send', 'poll', 'update'],
            description: '操作类型：send(存入交接), poll(检视待办), update(更新状态)'
          },
          from: {
            type: 'string',
            description: '发送方角色ID，如 jiangziya（send/poll时按需使用）'
          },
          to: {
            type: 'string',
            description: '接收方角色ID，如 nuwa（send/poll时按需使用）'
          },
          cc: {
            type: 'array',
            items: { type: 'string' },
            description: '抄送角色ID列表（send时可选，知会但不影响状态机）'
          },
          type: {
            type: 'string',
            description: '任务类型，如 role_creation / tool_creation / design_review（send时可选，自动加入标签路由）'
          },
          task: {
            type: 'string',
            description: '任务名称/标记（send时必需）'
          },
          payload: {
            type: 'object',
            description: '交接数据内容（send时必需）'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '自定义标签，如 ["设计方案", "待实现"]（send时可选）'
          },
          conversation_id: {
            type: 'string',
            description: '会话ID（update/poll时按需使用）'
          },
          status: {
            type: 'string',
            enum: ['pending', 'acknowledged', 'in_progress', 'completed', 'failed', 'stalled'],
            description: '目标状态（update时必需），stalled=处理超时'
          },
          ttl: {
            type: 'number',
            description: '超时时间（秒），默认 86400（24小时）。pending超过TTL自动重试，in_progress超过TTL变为stalled'
          },
          with_payload: {
            type: 'boolean',
            description: 'poll时是否返回payload内容（默认false，为保护AI上下文不返回）'
          }
        },
        required: ['action']
      }
    };
  },

  getBusinessErrors() {
    return [
      {
        code: 'HANDOFF_NOT_FOUND',
        description: '未找到指定会话的交接记录',
        match: '未找到会话',
        solution: '检查 conversation_id 是否正确',
        retryable: false
      },
      {
        code: 'MISSING_SEND_PARAMS',
        description: 'send操作缺少必需参数',
        match: 'send操作需要',
        solution: '请提供 to, task, payload 参数',
        retryable: true
      },
      {
        code: 'MISSING_UPDATE_PARAMS',
        description: 'update操作缺少必需参数',
        match: 'update操作需要',
        solution: '请提供 conversation_id 和 status 参数',
        retryable: true
      },
      {
        code: 'INVALID_TRANSITION',
        description: '状态转换不被允许',
        match: '不允许从',
        solution: '请检查状态转换路径：pending→acknowledged→in_progress→completed',
        retryable: true
      },
      {
        code: 'IDEMPOTENT_IGNORE',
        description: '幂等性保护，重复更新被忽略',
        match: '已处于',
        solution: '无需重复操作',
        retryable: false
      }
    ];
  },

  // 允许的状态转换表
  _validTransitions: {
    'pending':       ['acknowledged', 'failed'],
    'acknowledged':  ['in_progress', 'failed'],
    'in_progress':   ['completed', 'stalled'],
    'stalled':       ['in_progress', 'failed'],
    'completed':     [],        // 终态
    'failed':        []         // 终态
  },

  async execute(params) {
    const { api } = this;
    const { action } = params;

    api.logger.info('handoff 开始执行', { action });

    switch (action) {
      case 'send':
        return this._send(params, api);
      case 'poll':
        return this._poll(params, api);
      case 'update':
        return this._update(params, api);
      default:
        return { success: false, error: `未知操作类型: ${action}` };
    }
  },

  async _send(params, api) {
    if (!params.to || !params.task || !params.payload) {
      return {
        success: false,
        error: 'send操作需要 to, task, payload 参数',
        suggestion: `正确用法：{ action: "send", to: "nuwa", task: "设计方案", payload: { ... } }`
      };
    }

    const handoffs = api.storage.getItem('handoffs') || [];

    // 自动生成路由标签
    const routingTags = [
      `to:${params.to}`,
      `from:${params.from || 'jiangziya'}`
    ];

    // 抄送标签
    if (params.cc && Array.isArray(params.cc)) {
      params.cc.forEach(c => routingTags.push(`cc:${c}`));
    }
    if (params.type) {
      routingTags.push(`type:${params.type}`);
    }

    // 合并自定义标签，去重
    const tags = [...new Set([...routingTags, ...(params.tags || [])])];

    const ttl = params.ttl || 86400; // 默认24小时
    const record = {
      type: 'HANDOFF',
      from: params.from || 'jiangziya',
      to: params.to,
      cc: params.cc || [],
      task: params.task,
      task_type: params.type || '',
      payload: params.payload,
      tags,
      status: 'pending',
      conversation_id: `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // 【问题二修复】超时机制
      timeout_at: new Date(Date.now() + ttl * 1000).toISOString(),
      retry_count: 0,
      max_retries: 3,
      last_error: null
    };

    handoffs.push(record);
    api.storage.setItem('handoffs', handoffs);

    api.logger.info('交接任务已存入共享知识图谱', {
      conversation_id: record.conversation_id,
      from: record.from,
      to: record.to,
      task: record.task,
      task_type: record.task_type,
      timeout_at: record.timeout_at
    });

    return {
      success: true,
      data: {
        message: `✅ 设计方案已存入共享知识图谱，等候 ${params.to} 接手处理`,
        conversation_id: record.conversation_id,
        from: record.from,
        to: record.to,
        task: record.task,
        task_type: record.task_type,
        tags: record.tags,
        status: 'pending',
        timeout_at: record.timeout_at
      }
    };
  },

  async _poll(params, api) {
    const handoffs = api.storage.getItem('handoffs') || [];

    // 【问题二修复】先执行超时检测（被动超时）
    this._checkTimeouts(handoffs, api);

    let results = [...handoffs];

    // 按角色筛选（同时匹配 to 和 cc）
    if (params.to) {
      results = results.filter(h => h.to === params.to || (h.cc && h.cc.includes(params.to)));
    }
    if (params.from) {
      results = results.filter(h => h.from === params.from);
    }

    // 按任务类型筛选（多Agent路由）
    if (params.type) {
      results = results.filter(h => h.task_type === params.type);
    }

    // 按 conversation_id 精确查找
    if (params.conversation_id) {
      results = results.filter(h => h.conversation_id === params.conversation_id);
    }

    // 默认只显示活跃状态（待处理+进行中）
    if (!params.status && !params.conversation_id) {
      results = results.filter(h =>
        ['pending', 'acknowledged', 'in_progress'].includes(h.status)
      );
    } else if (params.status) {
      results = results.filter(h => h.status === params.status);
    }

    // 按时间倒序排列
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    api.logger.info('检视共享知识图谱待办任务', { count: results.length });

    return {
      success: true,
      data: {
        total: results.length,
        handoffs: results.map(h => {
          const base = {
            conversation_id: h.conversation_id,
            from: h.from,
            to: h.to,
            cc: h.cc || [],
            task: h.task,
            task_type: h.task_type,
            tags: h.tags,
            status: h.status,
            created_at: h.created_at,
            updated_at: h.updated_at,
            timeout_at: h.timeout_at,
            retry_count: h.retry_count
          };
          // 标记当前角色是 to 还是 cc
          base.is_cc = params.to && h.cc && h.cc.includes(params.to) && h.to !== params.to;
          // 【问题三修复】指定 conversation_id 时可选返回 payload
          if (params.conversation_id && params.with_payload) {
            base.payload = h.payload;
          }
          if (h.last_error) {
            base.last_error = h.last_error;
          }
          return base;
        })
      }
    };
  },

  async _update(params, api) {
    if (!params.conversation_id || !params.status) {
      return {
        success: false,
        error: 'update操作需要 conversation_id 和 status 参数',
        suggestion: `正确用法：{ action: "update", conversation_id: "handoff_xxx", status: "acknowledged" }`
      };
    }

    const handoffs = api.storage.getItem('handoffs') || [];
    const idx = handoffs.findIndex(h => h.conversation_id === params.conversation_id);

    if (idx === -1) {
      return {
        success: false,
        error: `未找到会话: ${params.conversation_id}`,
        suggestion: '请先用 poll 操作检视已有的 handoff 记录'
      };
    }

    const record = handoffs[idx];
    const oldStatus = record.status;
    const newStatus = params.status;

    // 【问题四修复】幂等性保障
    if (oldStatus === newStatus) {
      api.logger.info('幂等性保护：重复更新被忽略', {
        conversation_id: params.conversation_id,
        status: newStatus
      });
      return {
        success: true,
        data: {
          message: `⏭ 已处于 ${newStatus} 状态，无需重复操作（幂等性保护）`,
          conversation_id: params.conversation_id,
          task: record.task,
          status: newStatus,
          idempotent: true
        }
      };
    }

    // 【问题一修复】验证状态转换合法性
    const allowed = this._validTransitions[oldStatus] || [];
    if (!allowed.includes(newStatus)) {
      return {
        success: false,
        error: `不允许从 ${oldStatus} 转换到 ${newStatus}`,
        valid_targets: allowed.length > 0 ? allowed : ['（终态，不可转换）'],
        suggestion: `合法的转换路径：${this._getStateMachineDesc()}`
      };
    }

    // 更新状态
    record.status = newStatus;
    record.updated_at = new Date().toISOString();
    record.last_error = params.last_error || null;

    // 如果进入 in_progress，重置超时（给接收方新的处理时限）
    if (newStatus === 'in_progress') {
      record.timeout_at = new Date(Date.now() + 86400 * 1000).toISOString();
    }

    api.storage.setItem('handoffs', handoffs);

    api.logger.info('交接状态已更新', {
      conversation_id: params.conversation_id,
      from: oldStatus,
      to: newStatus
    });

    return {
      success: true,
      data: {
        message: `✅ 交接任务状态已更新: ${oldStatus} → ${newStatus}`,
        conversation_id: params.conversation_id,
        task: record.task,
        status: newStatus,
        timeout_at: record.timeout_at
      }
    };
  },

  // 【问题二修复】超时检测
  _checkTimeouts(handoffs, api) {
    const now = Date.now();
    let changed = false;

    for (const h of handoffs) {
      // pending 超时：自动重试
      if (h.status === 'pending' && h.timeout_at && new Date(h.timeout_at).getTime() < now) {
        if (h.retry_count < h.max_retries) {
          h.retry_count = (h.retry_count || 0) + 1;
          h.timeout_at = new Date(now + 86400 * 1000).toISOString();
          h.updated_at = new Date().toISOString();
          h.last_error = `pending 超时，自动重试第 ${h.retry_count} 次`;
          api.logger.warn('pending 超时自动重试', {
            conversation_id: h.conversation_id,
            retry_count: h.retry_count,
            max_retries: h.max_retries
          });
          changed = true;
        } else {
          h.status = 'failed';
          h.updated_at = new Date().toISOString();
          h.last_error = `超过最大重试次数 (${h.max_retries})，已标记为失败`;
          api.logger.warn('pending 超时已达最大重试，标记为 failed', {
            conversation_id: h.conversation_id
          });
          changed = true;
        }
      }

      // in_progress 超时：置为 stalled
      if (h.status === 'in_progress' && h.timeout_at && new Date(h.timeout_at).getTime() < now) {
        h.status = 'stalled';
        h.updated_at = new Date().toISOString();
        h.last_error = '处理超时，已自动标记为 stalled';
        api.logger.warn('in_progress 超时，标记为 stalled', {
          conversation_id: h.conversation_id
        });
        changed = true;
      }

      // acknowledged 超时：退化为 pending（接收方确认后未处理）
      if (h.status === 'acknowledged' && h.timeout_at && new Date(h.timeout_at).getTime() < now) {
        h.status = 'pending';
        h.retry_count = (h.retry_count || 0) + 1;
        h.timeout_at = new Date(now + 86400 * 1000).toISOString();
        h.updated_at = new Date().toISOString();
        h.last_error = `acknowledged 超时未处理，退回 pending，重试第 ${h.retry_count} 次`;
        api.logger.warn('acknowledged 超时退回 pending', {
          conversation_id: h.conversation_id,
          retry_count: h.retry_count
        });
        changed = true;
      }
    }

    if (changed) {
      api.storage.setItem('handoffs', handoffs);
    }
  },

  // 状态机描述
  _getStateMachineDesc() {
    return 'pending → acknowledged → in_progress → completed  |  ↘ stalled → failed';
  }
};