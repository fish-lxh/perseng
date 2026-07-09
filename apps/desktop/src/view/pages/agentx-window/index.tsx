import { useEffect, useState } from "react"
import { createAgentX, type AgentX } from "agentxjs"
import { ResponsiveStudio } from "../../components/agentx-ui"
import { useTranslation } from "react-i18next"

export default function AgentXPage() {
  const { t } = useTranslation()
  const [agentx, setAgentx] = useState<AgentX | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [needsConfig, setNeedsConfig] = useState(false)

  useEffect(() => {
    let mounted = true
    // 每轮 connect 独立的 cancellation + agentx 句柄, 让配置变更时旧会话
    // 能稳定 dispose, 不会和新的 connect 互相覆盖。
    let currentConnectId = 0
    let disposeCurrent: (() => void) | null = null

    const connect = async () => {
      const myConnectId = ++currentConnectId
      // 先释放上一轮 (dispose + 清状态), 避免 settings 改配置后旧 session 残留
      disposeCurrent?.()
      disposeCurrent = null

      // 重置为连接中的占位
      setError(null)
      setAgentx(null)
      setNeedsConfig(false)
      setIsConnecting(true)

      try {
        // 先检查是否已配置 API Key
        const config = await window.electronAPI.agentx.getConfig()
        if (!mounted || myConnectId !== currentConnectId) return
        if (!config.apiKey) {
          setNeedsConfig(true)
          setIsConnecting(false)
          return
        }

        // 检查服务状态，如果没运行则启动
        const isRunning = await window.electronAPI.agentx.getStatus()
        if (!mounted || myConnectId !== currentConnectId) return
        if (!isRunning) {
          const startResult = await window.electronAPI.agentx.start()
          if (!startResult.success) {
            throw new Error(startResult.error || "Failed to start AgentX service")
          }
        }

        // 从主进程获取 AgentX 服务器 URL
        const serverUrl = await window.electronAPI.agentx.getServerUrl()
        if (!mounted || myConnectId !== currentConnectId) return

        // 连接到内嵌的 AgentX 服务器
        const ax = await createAgentX({
          serverUrl,
        })
        if (!mounted || myConnectId !== currentConnectId) {
          await ax.dispose()
          return
        }

        setAgentx(ax)
        setIsConnecting(false)
        disposeCurrent = () => {
          ax.dispose().catch((err) => console.error("Failed to dispose AgentX:", err))
        }
      } catch (err) {
        if (!mounted || myConnectId !== currentConnectId) return
        setError(err instanceof Error ? err.message : "Failed to connect to AgentX server")
        setIsConnecting(false)
      }
    }

    // KNUTH-FEAT 2026-07-08: 订阅 AgentX 配置变更广播。
    // 之前 useEffect deps 是 [], 只在 mount 跑一次 —— 用户在 settings 窗口配完
    // API Key 后, 这个页面的 needsConfig 永远停留在 true, 只能关重开。
    // main 端 AgentXService.updateConfig() 现在会 webContents.send('agentx:configChanged'),
    // 这里接到事件就重置状态并重新 connect。
    const unsubscribeConfigChange = window.electronAPI.agentx.onConfigChange(() => {
      // 不管之前什么状态, 一律重新尝试连接
      void connect()
    })

    // 首次 mount: 启动一轮连接
    void connect()

    return () => {
      mounted = false
      unsubscribeConfigChange()
      disposeCurrent?.()
    }
  }, [])

  if (needsConfig) {
    return (
      <div className="flex h-full overflow-hidden items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-lg font-medium mb-2">{t("agentxUI.page.notConfigured.title")}</p>
          <p className="text-muted-foreground text-sm mb-4">
            {t("agentxUI.page.notConfigured.description")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("agentxUI.page.notConfigured.hint")}
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full overflow-hidden  items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-2">{t("agentxUI.page.connectionError")}</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (isConnecting || !agentx) {
    return (
      <div className="flex h-full overflow-hidden  items-center justify-center">
        <p className="text-muted-foreground">{t("agentxUI.page.connecting")}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden   w-full">
      <ResponsiveStudio
        agentx={agentx}
        containerId="perseng-desktop"
      />
    </div>
  )
}
