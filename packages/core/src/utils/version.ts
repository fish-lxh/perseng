/**
 * 版本信息工具
 * 统一管理Perseng版本信息的获取
 */

let cachedVersion: string | null = null

/**
 * 获取Perseng版本号
 * @returns 版本号
 */
export function getVersion(): string {
  if (cachedVersion !== null) {
    return cachedVersion
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const packageJson = require('../../../package.json') as { version?: string }
    cachedVersion = packageJson.version || '1.0.0'
  } catch {
    cachedVersion = '1.0.0'
  }

  return cachedVersion
}

/**
 * 获取完整版本信息（包含Node版本）
 * @returns 完整版本信息
 */
export function getFullVersion(): string {
  const version = getVersion()
  const nodeVersion = process.version
  return `${version} (Node.js ${nodeVersion})`
}
