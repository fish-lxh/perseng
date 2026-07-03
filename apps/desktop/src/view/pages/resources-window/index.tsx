import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Boxes, Upload } from "lucide-react"
import { Toaster } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SecondaryWindowLayout } from "@/components/window/SecondaryWindowLayout"
import RolesPage from "../roles-window"
import ToolsPage from "../tools-window"
import { ResourceImporter } from "./components/ResourceImporter"

type ResourceTab = "roles" | "tools"

export default function ResourcesWindowPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<ResourceTab>("roles")
  const [importOpen, setImportOpen] = useState(false)
  const [enableV2, setEnableV2] = useState(false)
  const [rolesPageKey, setRolesPageKey] = useState(0)
  const [toolsPageKey, setToolsPageKey] = useState(0)

  useEffect(() => {
    window.electronAPI?.invoke("server-config:get").then((config: any) => {
      setEnableV2(config?.enableV2 !== false)
    }).catch(() => {})
  }, [])

  const importResourceType = activeTab === "tools" ? "tool" : "role"

  const handleImportSuccess = () => {
    if (activeTab === "roles") {
      setRolesPageKey((value) => value + 1)
      return
    }

    setToolsPageKey((value) => value + 1)
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as ResourceTab)}
      className="h-screen"
    >
      <SecondaryWindowLayout
        leading={
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-md border border-border/60 bg-accent/40 p-2 text-foreground/80">
              <Boxes className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display-thin text-sm uppercase tracking-wide text-foreground">
                {t("tray.windows.resources")}
              </div>
              <div className="text-xs text-muted-foreground">
                {activeTab === "roles" ? t("sidebar.roles") : t("sidebar.tools")}
              </div>
            </div>
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <TabsList className="app-no-drag h-8 bg-accent/40">
              <TabsTrigger value="roles" className="h-6 px-3 text-xs">
                {t("sidebar.roles")}
              </TabsTrigger>
              <TabsTrigger value="tools" className="h-6 px-3 text-xs">
                {t("sidebar.tools")}
              </TabsTrigger>
            </TabsList>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {t("resources.import.actions.import")}
            </Button>
          </div>
        }
      >
        <Toaster />
        <TabsContent value="roles" className="mt-0 h-full overflow-hidden">
          <RolesPage key={rolesPageKey} />
        </TabsContent>
        <TabsContent value="tools" className="mt-0 h-full overflow-hidden">
          <ToolsPage key={toolsPageKey} />
        </TabsContent>
      </SecondaryWindowLayout>
      <ResourceImporter
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        defaultResourceType={importResourceType}
        lockedResourceType={true}
        enableV2={enableV2}
        onImportSuccess={handleImportSuccess}
      />
    </Tabs>
  )
}
