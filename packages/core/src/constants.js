/**
 * Perseng system constants configuration
 * Unified management of command formats, paths and other configuration information
 */

// Package name configuration (supports both new and old package names)
// 注:@promptx/cli 是 npm 上的实际包名,改名不动,本文件是 Perseng(品牌)
const PACKAGE_NAMES = {
  CURRENT: '@promptx/cli',    // Currently used package name
  LEGACY: 'dpml-prompt',       // Legacy package name (backward compatibility)
  ALL: ['@promptx/cli', 'dpml-prompt']  // All supported package names
}

// Determine command prefix based on environment variables
function getCommandPrefix() {
  const env = process.env.PERSENG_ENV
  
  if (env === 'development') {
    return 'pnpm start'
  } else {
    return `npx ${PACKAGE_NAMES.CURRENT}@snapshot`
  }
}

const COMMAND_PREFIX = getCommandPrefix()

// Static command constants
const COMMANDS = {
  INIT: `${COMMAND_PREFIX} init`,
  DISCOVER: `${COMMAND_PREFIX} discover`,
  ACTION: `${COMMAND_PREFIX} action`,
  LEARN: `${COMMAND_PREFIX} learn`,
  RECALL: `${COMMAND_PREFIX} recall`,
  REMEMBER: `${COMMAND_PREFIX} remember`,
  HELP: `${COMMAND_PREFIX} help`
}

// Command building functions with parameters
const buildCommand = {
  action: (roleId) => `${COMMAND_PREFIX} action ${roleId}`,
  learn: (resource) => `${COMMAND_PREFIX} learn ${resource}`,
  recall: (query = '') => `${COMMAND_PREFIX} recall${query ? ' ' + query : ''}`,
  remember: (content = '<content>') => `${COMMAND_PREFIX} remember${content !== '<content>' ? ' "' + content + '"' : ' <content>'}`
}

// Keep functional API for backward compatibility
function getCommands() {
  return COMMANDS
}

function getBuildCommand() {
  return buildCommand
}

function detectCommandPrefix() {
  return COMMAND_PREFIX
}



// System path configuration (static)
// 历史:旧路径 `.promptx`,新路径 `.perseng`(品牌改名迁移)
const PATHS = {
  POUCH_DIR: '.perseng',
  MEMORY_DIR: '.perseng/memory',
  STATE_FILE: '.perseng/pouch.json',
  MEMORY_FILE: '.perseng/memory/declarative.md'
}

// Version information
const VERSION = '0.0.1'

// System states
const STATES = {
  INITIALIZED: 'initialized',
  ROLE_DISCOVERY: 'role_discovery',
  ACTION_PLAN_GENERATED: 'action_plan_generated',
  LEARNED_ROLE: 'learned_role',
  MEMORY_SAVED: 'memory_saved',
  RECALL_WAITING: 'recall-waiting'
}

// Exports
module.exports = {
  // Fixed command prefix
  COMMAND_PREFIX,
  
  // Command constants
  COMMANDS,
  buildCommand,
  
  // Backward compatible functional API
  getCommands,
  getBuildCommand,
  detectCommandPrefix,
  
  // Other static constants
  PATHS,
  PACKAGE_NAMES,
  VERSION,
  STATES
}
