/**
 * @promptx/electron-storage - public API
 *
 * KNUTH-FEAT 2026-07-10: 从 apps/desktop/src/main/services/DatabaseManager.ts
 * 迁出。本包不依赖 electron, 任何 Node.js 宿主 (desktop / CLI / server)
 * 都可以直接消费。
 */

export {
  scanPersengHome,
  querySqlite,
  type DbItem,
  type DbMetadata,
  type DbSchemaKind,
  type SqlQueryResult,
} from './database.js'