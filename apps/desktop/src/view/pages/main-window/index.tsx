import { useState, useEffect, type MouseEvent as ReactMouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Toaster } from "sonner"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar"
import { FileText, Settings, Pickaxe, MessageSquare, UsersRound, Plus, Upload, History, Database } from "lucide-react";
import { BellIcon } from "@/components/icons";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import LogsPage from "../logs-window"
import SettingsPage from "../settings-window"
import ToolsPage from "../tools-window"
import RolesPage from "../roles-window"
import AgentXPage from "../agentx-window"
import TimelinePage from "../timeline-window"
import DatabaseManagerPage from "../db-manager-window"
import { ResourceImporter } from "../resources-window/components/ResourceImporter"
import { NotificationList } from "@/components/notifications/NotificationList"
import { notificationService } from "@/components/notifications/notificationService"
import { WindowTitleBar } from "@/components/window/WindowTitleBar"
import { goToSendMessage } from "../../../utils/goToSendMessage"
import logo from "../../../../assets/icons/icon-64x64.png"
type PageType = "logs" | "settings" | "update" | "agentx" | "roles" | "tools" | "timeline" | "dbmanager"

function MainContent() {
  const { t } = useTranslation()
  const [currentPage, setCurrentPage] = useState<PageType>("agentx")
  const [pageKey, setPageKey] = useState(0)
  // 用于双击 AGENTX 按钮时强制刷新 AgentXPage,从而让内部的 currentImageId 重置为 null → 显示 WelcomePage
  const [agentxResetKey, setAgentxResetKey] = useState(0)
  const { open, state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  const navigateTo = (page: PageType) => {
    setCurrentPage(page)
    setPageKey(k => k + 1)
  }

  const handleAgentxDoubleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    // 双击 AGENTX 按钮: 切回 agentx 页 + 强制 remount,使 WelcomePage 重新可见
    e.preventDefault()
    setCurrentPage("agentx")
    setAgentxResetKey(k => k + 1)
  }
  const [importOpen, setImportOpen] = useState(false)
  const [enableV2, setEnableV2] = useState(false)
  const importResourceType = currentPage === "tools" ? "tool" : "role"
  const importLocked = currentPage === "tools" || currentPage === "roles"

  useEffect(() => {
    window.electronAPI?.invoke("server-config:get").then((config: any) => {
      setEnableV2(config?.enableV2 !== false)
    }).catch(() => { })
  }, [])

  // 自动打开通知弹窗
  useEffect(() => {
    const hasShown = notificationService.hasShownNotifications()
    if (!hasShown) {
      // 延迟500ms打开，让应用先完全加载
      const timer = setTimeout(() => {
        setNotificationOpen(true)
        notificationService.markAsShown()
      }, 500)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [])

  // 更新未读数量
  useEffect(() => {
    const updateUnreadCount = () => {
      setUnreadCount(notificationService.getUnreadCount())
    }
    updateUnreadCount()

    // 监听通知变化
    const interval = setInterval(updateUnreadCount, 1000)
    return () => clearInterval(interval)
  }, [notificationOpen])

  useEffect(() => {
    const handler = (e: Event) => {
      const page = (e as CustomEvent).detail?.page
      if (page) navigateTo(page)
    }
    window.addEventListener("navigate", handler)
    return () => window.removeEventListener("navigate", handler)
  }, [])

  const menuItems = [
    {
      id: "agentx" as PageType,
      title: t("sidebar.agentx"),
      icon: MessageSquare,
    },
    {
      id: "roles" as PageType,
      title: t("sidebar.roles"),
      icon: UsersRound,
    },
    {
      id: "tools" as PageType,
      title: t("sidebar.tools"),
      icon: Pickaxe,
    },
    {
      id: "timeline" as PageType,
      title: t("sidebar.timeline"),
      icon: History,
    },
    {
      id: "logs" as PageType,
      title: t("sidebar.logs"),
      icon: FileText,
    },
    {
      id: "dbmanager" as PageType,
      title: t("sidebar.dbmanager"),
      icon: Database,
    },
    {
      id: "settings" as PageType,
      title: t("sidebar.settings"),
      icon: Settings,
    },
  ]



  const renderHeaderActions = () => {
    switch (currentPage) {
      case "tools":
        return (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              {t("resources.import.actions.import")}
            </Button>
            <Button size="sm" className="h-7 text-xs bg-foreground text-background hover:bg-foreground/90" onClick={() => goToSendMessage(t("agentxUI.welcome.presets.lubanPrompt"))}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("tools.detail.createTool")}
            </Button>
          </div>
        )
      case "roles":
        return (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setImportOpen(true)}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              {t("resources.import.actions.import")}
            </Button>
            <Button size="sm" className="h-7 text-xs bg-foreground text-background hover:bg-foreground/90" onClick={() => goToSendMessage(t("agentxUI.welcome.presets.nuwaPrompt"))}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("roles.detail.createRole")}
            </Button>
          </div>
        )
      default:
        return null
    }
  }

  const renderPage = () => {
    switch (currentPage) {
      case "agentx":
        return <AgentXPage key={agentxResetKey} />
      case "logs":
        return <LogsPage />
      case "settings":
        return <SettingsPage />
      case "roles":
        return <RolesPage key={pageKey} />
      case "tools":
        return <ToolsPage key={pageKey} />
      case "timeline":
        return <TimelinePage key={pageKey} />
      case "dbmanager":
        return <DatabaseManagerPage key={pageKey} />
      default:
        return <AgentXPage />
    }
  }

  const activePageTitle = menuItems.find((item) => item.id === currentPage)?.title

  return (
    <div className="flex h-screen w-full">
      <Toaster />
      <Sidebar className="w-[12vw] ">
        <SidebarHeader className="app-drag border-b border-pattern-meander-top select-none">
          <div className="flex items-center gap-2 min-w-0 px-2 py-4">
            <img src={logo} alt="Perseng Logo" className="h-8 w-8 shrink-0" />
            {!isCollapsed && (
              <span className="font-display-thin text-xs sm:text-sm md:text-base lg:text-lg truncate min-w-0 flex-1">
                PERSENG
              </span>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent className="bg-pattern-bronze">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuItems.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      onClick={() => navigateTo(item.id)}
                      onDoubleClick={item.id === "agentx" ? handleAgentxDoubleClick : undefined}
                      isActive={currentPage === item.id}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="font-mono">{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full justify-start relative"
            onClick={() => setNotificationOpen(true)}
          >
            <BellIcon className="h-4 w-4 mr-2" />
            <span className="font-mono">{t("notifications.button")}</span>
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="ml-auto h-5 min-w-5 px-1 text-xs font-mono"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>
        </SidebarFooter>
      </Sidebar>

      <main className={`flex-1 overflow-hidden ${open ? 'ml-[12vw] ' : ''}`}>
        <div className="h-full flex flex-col">
          <WindowTitleBar
            leading={
              <>
                <SidebarTrigger className="app-no-drag" />
                <h2 className="font-display-thin text-sm sm:text-base lg:text-lg uppercase truncate min-w-0">
                  {activePageTitle}
                </h2>
              </>
            }
            actions={renderHeaderActions()}
          />
          <div className="h-[calc(100vh-53px)] overflow-auto bg-pattern-meander ">{renderPage()}</div>
        </div>
      </main>
      <ResourceImporter
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        defaultResourceType={importResourceType}
        lockedResourceType={importLocked}
        enableV2={enableV2}
        onImportSuccess={() => navigateTo(currentPage)}
      />
      <NotificationList
        isOpen={notificationOpen}
        onClose={() => {
          setNotificationOpen(false)
          setUnreadCount(notificationService.getUnreadCount())
        }}
      />
    </div>
  )
}

export default function MainWindow() {
  return (
    <SidebarProvider>
      <MainContent />
    </SidebarProvider>
  )
}
