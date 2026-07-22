/**
 * ErrorCategories - Perseng 错误分类定义
 *
 * 四层错误分类体系：
 * - DEVELOPMENT: 工具代码错误，需要开发者修复
 * - VALIDATION: 参数/环境验证错误，用户需要提供正确输入
 * - BUSINESS: 业务执行错误，工具定义的业务逻辑错误
 * - SYSTEM: 系统环境错误，Perseng 或环境问题
 *
 * KNUTH-FIX 2026-07-22 (TS migration): `export =` 模式 + namespace 模式。
 */

interface ErrorCategoryInfo {
  name: string
  emoji: string
  description: string
  responsibility: string
  severity: string
  note?: string
}

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace ErrorCategoriesNs {
  export const ERROR_CATEGORIES: Record<string, ErrorCategoryInfo> = {
    DEVELOPMENT: {
      name: 'DEVELOPMENT',
      emoji: '👨‍💻',
      description: '工具代码错误',
      responsibility: '工具开发者需要修复代码',
      severity: 'error',
    },

    VALIDATION: {
      name: 'VALIDATION',
      emoji: '📝',
      description: '参数/环境验证错误',
      responsibility: '用户需要提供正确的输入',
      severity: 'warning',
      note: '系统自动检测，无需工具定义',
    },

    BUSINESS: {
      name: 'BUSINESS',
      emoji: '💼',
      description: '业务执行错误',
      responsibility: '根据具体错误调整使用方式',
      severity: 'error',
      note: '工具通过 getBusinessErrors() 定义',
    },

    SYSTEM: {
      name: 'SYSTEM',
      emoji: '🔧',
      description: '系统环境错误',
      responsibility: 'Perseng 团队处理或用户重试',
      severity: 'critical',
    },
  }
}

export = ErrorCategoriesNs.ERROR_CATEGORIES