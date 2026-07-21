/**
 * FilePatternDiscovery - 基于文件模式的资源发现基类
 *
 * 统一的文件模式识别逻辑，支持：
 * - *.role.md (角色资源)
 * - *.thought.md (思维模式)
 * - *.execution.md (执行模式)
 * - *.knowledge.md (知识资源)
 * - *.tool.js (工具资源)
 *
 * 子类只需要重写 _getBaseDirectory() 方法指定扫描目录
 *
 * KNUTH-FIX 2026-07-21: `export =` 模式让 tsup cjsInterop 不包成 namespace。
 */
import fs from 'fs-extra'
import path from 'path'
import logger from '@promptx/logger'
import BaseDiscovery = require('./BaseDiscovery')
import CrossPlatformFileScannerModule = require('./CrossPlatformFileScanner')
import RegistryDataModule = require('../RegistryData')
import ResourceDataModule = require('../ResourceData')

type CrossPlatformFileScanner = InstanceType<typeof CrossPlatformFileScannerModule>
type RegistryData = InstanceType<typeof RegistryDataModule>

type ResourcePattern = {
  extensions: string[]
  validator: (filePath: string) => Promise<boolean>
}

class FilePatternDiscovery extends BaseDiscovery {
  public fileScanner: CrossPlatformFileScanner
  public resourcePatterns: Record<string, ResourcePattern>

  constructor(source: string, priority?: number) {
    super(source, priority)
    this.fileScanner = new CrossPlatformFileScannerModule()

    this.resourcePatterns = {
      role: {
        extensions: ['.role.md'],
        validator: this._validateRoleFile.bind(this),
      },
      thought: {
        extensions: ['.thought.md'],
        validator: this._validateThoughtFile.bind(this),
      },
      execution: {
        extensions: ['.execution.md'],
        validator: this._validateExecutionFile.bind(this),
      },
      knowledge: {
        extensions: ['.knowledge.md'],
        validator: this._validateKnowledgeFile.bind(this),
      },
      tool: {
        extensions: ['.tool.js'],
        validator: this._validateToolFile.bind(this),
      },
      manual: {
        extensions: ['.manual.md'],
        validator: this._validateManualFile.bind(this),
      },
    }
  }

  async _getBaseDirectory(): Promise<string> {
    throw new Error('Subclass must implement _getBaseDirectory() method')
  }

  async _scanResourcesByFilePattern(registryData: RegistryData): Promise<void> {
    const baseDirectory = await this._getBaseDirectory()

    if (!(await fs.pathExists(baseDirectory))) {
      logger.debug(`[${this.source}] 扫描目录不存在: ${baseDirectory}`)
      return
    }

    logger.debug(`[${this.source}] 开始扫描目录: ${baseDirectory}`)

    const resourceTypes = Object.keys(this.resourcePatterns)

    for (const resourceType of resourceTypes) {
      try {
        const pattern = this.resourcePatterns[resourceType]
        if (!pattern) continue
        const files = await this._scanResourceFiles(baseDirectory, resourceType, pattern.extensions)

        for (const filePath of files) {
          await this._processResourceFile(filePath, resourceType, registryData, baseDirectory, pattern.validator)
        }

        logger.debug(`[${this.source}] ${resourceType} 类型扫描完成，发现 ${files.length} 个文件`)
      } catch (error) {
        logger.warn(`[${this.source}] 扫描 ${resourceType} 类型失败: ${(error as Error).message}`)
      }
    }
  }

  async _scanResourceFiles(baseDirectory: string, _resourceType: string, extensions: string[]): Promise<string[]> {
    const allFiles: string[] = []

    for (const extension of extensions) {
      try {
        const files = await this.fileScanner.scanFiles(baseDirectory, {
          extensions: [extension],
          maxDepth: 10,
        })
        allFiles.push(...files)
      } catch (error) {
        logger.warn(`[${this.source}] 扫描 ${extension} 文件失败: ${(error as Error).message}`)
      }
    }

    return allFiles
  }

  async _processResourceFile(
    filePath: string,
    resourceType: string,
    registryData: RegistryData,
    baseDirectory: string,
    validator: (filePath: string) => Promise<boolean>,
  ): Promise<void> {
    try {
      const isValid = await validator(filePath)
      if (!isValid) {
        logger.debug(`[${this.source}] 文件验证失败，跳过: ${filePath}`)
        return
      }

      const resourceId = this._extractResourceId(filePath, resourceType)
      if (!resourceId) {
        logger.warn(`[${this.source}] 无法提取资源ID: ${filePath}`)
        return
      }

      const reference = this._generateReference(filePath, baseDirectory)

      const resourceData = new ResourceDataModule({
        id: resourceId,
        source: this.source.toLowerCase(),
        protocol: resourceType,
        name: ResourceDataModule._generateDefaultName(resourceId, resourceType),
        description: ResourceDataModule._generateDefaultDescription(resourceId, resourceType),
        reference: reference,
        metadata: {
          scannedAt: new Date().toISOString(),
          path: path.relative(baseDirectory, filePath).replace(/\\/g, '/'),
          fileType: resourceType,
        },
      })

      registryData.addResource(resourceData)

      logger.debug(`[${this.source}] 成功处理资源: ${resourceId} -> ${reference}`)
    } catch (error) {
      logger.warn(`[${this.source}] 处理资源文件失败: ${filePath} - ${(error as Error).message}`)
    }
  }

  _extractResourceId(filePath: string, resourceType: string): string | null {
    const fileName = path.basename(filePath)
    const pattern = this.resourcePatterns[resourceType]

    if (!pattern) {
      return null
    }

    for (const extension of pattern.extensions) {
      if (fileName.endsWith(extension)) {
        const baseName = fileName.slice(0, -extension.length)
        return baseName
      }
    }

    return null
  }

  _generateReference(filePath: string, baseDirectory: string): string {
    const relativePath = path.relative(baseDirectory, filePath)
    const protocolPrefix = this.source.toLowerCase() === 'project' ? '@project://' : '@package://'

    if (this.source.toLowerCase() === 'project') {
      return `${protocolPrefix}.perseng/resource/${relativePath.replace(/\\/g, '/')}`
    } else {
      return `${protocolPrefix}resource/${relativePath.replace(/\\/g, '/')}`
    }
  }

  async _validateRoleFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const trimmedContent = content.trim()

      if (trimmedContent.length === 0) {
        return false
      }

      return /<role[\s>]/.test(trimmedContent) && trimmedContent.includes('</role>')
    } catch (error) {
      return false
    }
  }

  async _validateThoughtFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const trimmedContent = content.trim()

      if (trimmedContent.length === 0) {
        return false
      }

      return /<thought[\s>]/.test(trimmedContent) && trimmedContent.includes('</thought>')
    } catch (error) {
      return false
    }
  }

  async _validateExecutionFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const trimmedContent = content.trim()

      if (trimmedContent.length === 0) {
        return false
      }

      return /<execution[\s>]/.test(trimmedContent) && trimmedContent.includes('</execution>')
    } catch (error) {
      return false
    }
  }

  async _validateKnowledgeFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const trimmedContent = content.trim()

      return trimmedContent.length > 0
    } catch (error) {
      return false
    }
  }

  async _validateToolFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')

      new Function(content)

      if (!content.includes('module.exports')) {
        return false
      }

      const requiredMethods = ['getMetadata', 'execute']
      const hasRequiredMethods = requiredMethods.some((method) =>
        content.includes(method),
      )

      return hasRequiredMethods
    } catch (error) {
      return false
    }
  }

  async _validateManualFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const trimmedContent = content.trim()

      if (trimmedContent.length === 0) {
        return false
      }

      return /<manual[\s>]/.test(trimmedContent) || trimmedContent.length > 50
    } catch (error) {
      return false
    }
  }

  async generateRegistry(baseDirectory: string): Promise<RegistryData> {
    const registryPath = await this._getRegistryPath()
    const registryData = RegistryDataModule.createEmpty(this.source.toLowerCase(), registryPath)

    logger.info(`[${this.source}] 开始生成注册表，扫描目录: ${baseDirectory}`)

    try {
      await this._scanResourcesByFilePattern(registryData)

      if (registryPath) {
        await registryData.save()
      }

      logger.info(`[${this.source}]  注册表生成完成，共发现 ${registryData.size} 个资源`)
      return registryData
    } catch (error) {
      logger.error(`[${this.source}]  注册表生成失败: ${(error as Error).message}`)
      throw error
    }
  }

  async _getRegistryPath(): Promise<string | null> {
    return null
  }

  async _fsExists(filePath: string): Promise<boolean> {
    return await fs.pathExists(filePath)
  }
}

export = FilePatternDiscovery