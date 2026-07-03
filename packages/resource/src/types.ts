/**
 * 资源类型定义 - v2.0.0
 */

/**
 * 资源定义
 */
export interface Resource {
  /** 资源唯一标识（不含类型后缀） */
  id: string
  /** 资源来源 (package, project, user) */
  source: string
  /** 资源协议类型 (role, tool, thought, execution, knowledge, manual, protocol, tag) */
  protocol: string
  /** 资源名称 */
  name: string
  /** 资源描述 */
  description: string
  /** 资源引用路径 */
  reference: string
  /** 元数据 */
  metadata: {
    /** 相对路径 */
    path?: string
    /** 文件大小 */
    size?: number
    /** 最后修改时间 */
    modified?: string
    /** 创建时间 */
    createdAt?: string
    /** 更新时间 */
    updatedAt?: string
    [key: string]: any
  }
}

/**
 * 资源注册表
 */
export interface ResourceRegistry {
  /** 注册表版本 */
  version: '2.0.0'
  /** 资源来源 */
  source: string
  /** 元数据 */
  metadata: {
    /** 版本 */
    version: '2.0.0'
    /** 描述 */
    description: string
    /** 创建时间 */
    createdAt: string
    /** 更新时间 */
    updatedAt: string
    /** 资源数量 */
    resourceCount: number
  }
  /** 资源数组 */
  resources: Resource[]
}

/**
 * 资源包接口
 */
export interface ResourcePackage {
  /** 注册表数据 */
  registry: ResourceRegistry
  /** 获取资源的绝对路径 */
  getResourcePath(relativePath: string): string
  /** 根据 ID 查找资源 */
  findResourceById(id: string): Resource | undefined
  /** 根据协议类型获取资源列表 */
  getResourcesByProtocol(protocol: string): Resource[]
  /** 获取所有资源列表 */
  getAllResources(): Resource[]
}