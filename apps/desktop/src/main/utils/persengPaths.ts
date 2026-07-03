import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

/**
 * Perseng 用户数据目录工具(从 PromptX 改名迁移而来)
 *
 * 历史:
 *   - 旧路径:`~/.promptx` (PromptX 时代)
 *   - 新路径:`~/.perseng` (Perseng 时代)
 *
 * 设计:
 *   - getPersengHomeDir():优先新路径;读时若不存在可回退旧路径;写时永远写新路径
 *   - migratePromptXHomeIfNeeded():首次启动时自动迁移整个旧目录到新目录
 *   - 迁移后保留一个 symlink/junction 指向 ~/.perseng,让任何漏改代码读旧路径仍能命中
 */

const OLD_DIR = '.promptx'
const NEW_DIR = '.perseng'

let migrationDone = false

/**
 * 获取 Perseng 用户主目录路径。读时优先新目录,旧目录作为兼容兜底;写时永远用新目录。
 */
export function getPersengHomeDir(): string {
  const newDir = path.join(os.homedir(), NEW_DIR)
  if (fs.existsSync(newDir)) return newDir
  const oldDir = path.join(os.homedir(), OLD_DIR)
  if (fs.existsSync(oldDir)) return oldDir
  // 都没有则返回新路径让上层创建
  return newDir
}

/**
 * 获取某个子目录的完整路径
 */
export function getPersengSubDir(...segments: string[]): string {
  return path.join(getPersengHomeDir(), ...segments)
}

/**
 * 显式获取 PromptX 旧目录路径(用于迁移相关逻辑)
 */
export function getPromptXLegacyHomeDir(): string {
  return path.join(os.homedir(), OLD_DIR)
}

/**
 * 显式获取 Perseng 新目录路径(用于迁移相关逻辑)
 */
export function getPersengExplicitHomeDir(): string {
  return path.join(os.homedir(), NEW_DIR)
}

/**
 * 检查是否需要迁移(公开出来便于测试和状态展示)
 */
export function shouldMigrateFromPromptX(): boolean {
  if (migrationDone) return false
  const newDir = getPersengExplicitHomeDir()
  const oldDir = getPromptXLegacyHomeDir()
  if (fs.existsSync(newDir)) return false
  if (!fs.existsSync(oldDir)) return false
  return true
}

export interface MigrationResult {
  migrated: boolean
  reason?: 'already_migrated' | 'no_old_dir' | 'already_new_dir' | 'success' | 'error'
  oldPath?: string
  newPath?: string
  symlinkCreated?: boolean
  errorMessage?: string
}

/**
 * 首次启动时自动迁移 ~/.promptx → ~/.perseng
 *
 * 步骤:
 *   1. 探测:如果 ~/.perseng 已存在说明已迁移过,直接返回
 *   2. 探测:如果 ~/.promptx 不存在,无需迁移
 *   3. 复制:用 fs.cp 递归复制整个 ~/.promptx 到 ~/.perseng
 *   4. 删除:成功后删除 ~/.promptx(用 fs.rm)
 *   5. 兼容软链接:在 ~/.promptx 创建 junction(Windows)/symlink(Unix)指向 ~/.perseng
 *      深度防御——任何漏改的旧代码读旧路径仍能命中
 *   6. 标记 migrationDone = true
 *
 * 注意:在 Windows 上 fs.cp 跨盘符正常工作;为了兼容,fs.cp + fs.rm 比 fs.rename 更稳。
 */
export async function migratePromptXHomeIfNeeded(): Promise<MigrationResult> {
  if (migrationDone) return { migrated: false, reason: 'already_migrated' }

  const newDir = getPersengExplicitHomeDir()
  const oldDir = getPromptXLegacyHomeDir()

  if (fs.existsSync(newDir)) {
    migrationDone = true
    return { migrated: false, reason: 'already_new_dir' }
  }
  if (!fs.existsSync(oldDir)) {
    return { migrated: false, reason: 'no_old_dir' }
  }

  try {
    // 先创建新目录(确保父目录存在)
    fs.mkdirSync(path.dirname(newDir), { recursive: true })

    // 复制旧 → 新
    await fs.promises.cp(oldDir, newDir, { recursive: true })

    // 删除旧目录
    await fs.promises.rm(oldDir, { recursive: true, force: true })

    // 兼容软链接:junction(Win)/symlink(*nix)
    let symlinkCreated = false
    try {
      const type = process.platform === 'win32' ? 'junction' : 'dir'
      await fs.promises.symlink(newDir, oldDir, type)
      symlinkCreated = true
    } catch {
      // 软链接创建失败不影响主迁移
      symlinkCreated = false
    }

    migrationDone = true
    return { migrated: true, reason: 'success', oldPath: oldDir, newPath: newDir, symlinkCreated }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return { migrated: false, reason: 'error', errorMessage, oldPath: oldDir, newPath: newDir }
  }
}

/**
 * 强制把 migrationDone 标记重置(仅测试用)
 */
export function __resetMigrationFlagForTesting(): void {
  migrationDone = false
}
