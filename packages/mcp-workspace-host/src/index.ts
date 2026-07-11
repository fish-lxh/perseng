/**
 * @promptx/mcp-workspace-host - public API
 *
 * KNUTH-FEAT 2026-07-11: G2.1 抽取自 apps/desktop/src/main/services/WorkspaceService.ts.
 * 任何 Node.js host (desktop / CLI / server) 可以直接消费, 业务是
 * workspace 文件夹 CRUD + 路径沙盒。
 */

export {
  WorkspaceService,
  workspaceService,
  type WorkspaceFolder,
  type DirEntry,
} from './WorkspaceService.js'
