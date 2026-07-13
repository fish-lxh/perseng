import { ResourceListWindow } from '~/main/windows/ResourceListWindow'
import {
  ResourceService,
  PersengResourceRepository,
} from '@promptx/resource-service'
import { PersengActivationAdapter } from '~/main/infrastructure/PersengActivationAdapter'

/**
 * Resource Manager - 主程序集成点
 * 负责组装和管理资源（角色和工具）相关组件
 *
 * KNUTH-FEAT 2026-07-11 G2.2: ResourceService + PersengResourceRepository
 * 已抽到 @promptx/resource-service; ActivationAdapter 实现仍留在 desktop
 * (PersengActivationAdapter 通过 execFile spawn 子进程调 promptx CLI,
 * 跟 Electron 主进程绑在一起)。
 */
export class ResourceManager {
  private resourceListWindow: ResourceListWindow | null = null
  private resourceService: ResourceService

  constructor() {
    // 依赖注入，组装各层组件
    const repository = new PersengResourceRepository()
    const activationAdapter = new PersengActivationAdapter()
    this.resourceService = new ResourceService(repository, activationAdapter)

    // 创建窗口管理器
    this.resourceListWindow = new ResourceListWindow(this.resourceService)
  }

  showResourceList(): void {
    this.resourceListWindow?.show()
  }

  hideResourceList(): void {
    this.resourceListWindow?.hide()
  }

  destroy(): void {
    this.resourceListWindow?.close()
    this.resourceListWindow = null
  }
}