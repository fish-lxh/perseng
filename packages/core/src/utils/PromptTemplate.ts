/**
 * PromptTemplate - 轻量级提示词模板渲染工具
 * 基于 Eta 模板引擎，专为管理和渲染 Markdown 格式的提示词设计
 */

import { Eta } from 'eta'
import * as path from 'path'
import * as fs from 'fs-extra'

export interface PromptTemplateOptions {
  views?: string
  cache?: boolean
  autoEscape?: boolean
  debug?: boolean
  includeFile?: (filePath: string, data: Record<string, unknown>) => string
}

export type TemplateData = Record<string, unknown>

export class PromptTemplate {
  options: PromptTemplateOptions
  private eta: Eta

  constructor(options: PromptTemplateOptions = {}) {
    const defaultOptions: PromptTemplateOptions = {
      views: path.join(process.cwd(), 'prompts'),
      cache: process.env.NODE_ENV === 'production',
      autoEscape: false, // 对 Markdown 很重要
      debug: process.env.NODE_ENV !== 'production',
      includeFile: (filePath, data) => {
        // 自定义 include 函数
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(this.options.views ?? '', filePath)
        const content = fs.readFileSync(fullPath, 'utf8')
        return this.eta.renderString(content, data)
      },
    }

    this.options = { ...defaultOptions, ...options }
    // Eta 类型定义可能不完全匹配我们的可选配置，这里安全 cast
    this.eta = new Eta(this.options as unknown as ConstructorParameters<typeof Eta>[0])
  }

  /**
   * 渲染模板文件
   * @param templatePath - 模板文件路径（相对于 views 目录）
   * @param data - 渲染数据
   */
  async render(templatePath: string, data: TemplateData = {}): Promise<string> {
    try {
      // 如果没有扩展名，默认添加 .md
      if (!path.extname(templatePath)) {
        templatePath += '.md'
      }

      const fullPath = path.join(this.options.views ?? '', templatePath)
      const template = await fs.readFile(fullPath, 'utf8')

      return this.eta.renderString(template, data)
    } catch (error) {
      throw new Error(
        `Failed to render template "${templatePath}": ${(error as Error).message}`,
      )
    }
  }

  /**
   * 渲染字符串模板
   * @param template - 模板字符串
   * @param data - 渲染数据
   */
  renderString(template: string, data: TemplateData = {}): string {
    try {
      return this.eta.renderString(template, data)
    } catch (error) {
      throw new Error(`Failed to render string template: ${(error as Error).message}`)
    }
  }

  /**
   * 预编译模板以提高性能
   * @param templatePath - 模板文件路径
   */
  async compile(templatePath: string): Promise<unknown> {
    try {
      if (!path.extname(templatePath)) {
        templatePath += '.md'
      }

      const fullPath = path.join(this.options.views ?? '', templatePath)
      const template = await fs.readFile(fullPath, 'utf8')

      return this.eta.compile(template)
    } catch (error) {
      throw new Error(
        `Failed to compile template "${templatePath}": ${(error as Error).message}`,
      )
    }
  }

  /**
   * 注册 partial（可复用片段）
   * @param name - partial 名称
   * @param content - partial 内容
   */
  registerPartial(name: string, content: string): void {
    this.eta.loadTemplate(`@${name}`, content)
  }

  /**
   * 批量注册目录下的所有 partials
   * @param partialsDir - partials 目录路径
   */
  async registerPartialsFromDir(partialsDir: string): Promise<void> {
    try {
      const files = await fs.readdir(partialsDir)

      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = path.basename(file, '.md')
          const content = await fs.readFile(path.join(partialsDir, file), 'utf8')
          this.registerPartial(name, content)
        }
      }
    } catch (error) {
      throw new Error(
        `Failed to register partials from directory: ${(error as Error).message}`,
      )
    }
  }

  /**
   * 清除模板缓存
   */
  clearCache(): void {
    // Eta 的内部 cache 字段是动态的，这里安全访问
    ;(this.eta as unknown as { templatesSync: Record<string, unknown> }).templatesSync = {}
    ;(this.eta as unknown as { templatesAsync: Record<string, unknown> }).templatesAsync = {}
  }
}

// 创建默认实例
const defaultTemplate = new PromptTemplate()

// 导出类和默认实例
export default PromptTemplate
export { defaultTemplate }
