import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, FileArchive, Image as ImageIcon, X } from "@/lib/crisp-icons"
import { useTranslation } from "react-i18next"
import type { ResourceType } from "./useImport"

interface ImportFormProps {
  resourceType: ResourceType
  lockedResourceType: boolean
  filePaths: string[]
  name: string
  description: string
  // KNUTH-FEAT 2026-07-04: 可选角色图标（V1/V2 都支持，仅角色显示）
  avatarPath: string
  onResourceTypeChange: (v: ResourceType) => void
  onSelectFiles: () => void
  onRemoveFile: (index: number) => void
  onNameChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onSelectAvatar: () => void
  onRemoveAvatar: () => void
}

export function ImportForm({
  resourceType, lockedResourceType, filePaths, name, description, avatarPath,
  onResourceTypeChange, onSelectFiles, onRemoveFile,
  onNameChange, onDescriptionChange, onSelectAvatar, onRemoveAvatar,
}: ImportFormProps) {
  const { t } = useTranslation()
  const isSingle = filePaths.length <= 1
  const isRole = resourceType === "role"

  return (
    <div className="space-y-4">
      {/* 资源类型：锁定时只展示标签，不可更改。
          KNUTH-FEAT 2026-07-04: 移除了 V1/V2 切换按钮 — V1/V2 由 zip 内容自动决定，
          server-config.enableV2 决定实际走哪个 import handler。 */}
      {lockedResourceType ? (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {isRole ? t("resources.types.role") : t("resources.types.tool")}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{t("resources.import.fields.resourceType")}</Label>
          <Select value={resourceType} onValueChange={(v) => onResourceTypeChange(v as ResourceType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="role">{t("resources.types.role")}</SelectItem>
              <SelectItem value="tool">{t("resources.types.tool")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 文件选择 */}
      <div className="space-y-2">
        <Label>{t("resources.import.fields.zipFile")}</Label>
        <Button type="button" variant="outline" onClick={onSelectFiles} className="w-full">
          <Upload className="h-4 w-4 mr-2" />
          {t("resources.import.fields.upload")}
        </Button>
        {filePaths.length > 0 && (
          <ScrollArea className="h-[100px] w-full rounded-md border p-2">
            <div className="space-y-2">
              {filePaths.map((path, index) => (
                <div key={index} className="flex items-center justify-between text-sm text-muted-foreground bg-secondary/50 p-2 rounded">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileArchive className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate" title={path}>{path.split(/[\\/]/).pop()}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0 hover:bg-destructive/20 hover:text-destructive"
                    onClick={() => onRemoveFile(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* KNUTH-FEAT 2026-07-04: 角色图标（V1/V2 都显示，tool 不显示）。
          与 name/description 的 `!v2` 隐藏规则独立判断——avatar 是角色级附件文件，不是 metadata。 */}
      {isSingle && isRole && (
        <div className="space-y-2">
          <Label>{t("resources.import.fields.avatar")}</Label>
          <Button type="button" variant="outline" onClick={onSelectAvatar} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            {t("resources.import.fields.avatarUpload")}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("resources.import.fields.avatarHint")}
          </p>
          {avatarPath && (
            <div className="flex items-center justify-between text-sm text-muted-foreground bg-secondary/50 p-2 rounded">
              <div className="flex items-center gap-2 overflow-hidden">
                <ImageIcon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate" title={avatarPath}>{avatarPath.split(/[\\/]/).pop()}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 hover:bg-destructive/20 hover:text-destructive"
                onClick={onRemoveAvatar}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* KNUTH-FEAT 2026-07-04: 解锁 V2 自定义 name/description。
          历史原因导致 V2 输入框被隐藏，但后端 resources:importV2Role 和
          PersengResourceRepository.convertToResource 都已支持 V2 metadata。
          修正条件：单文件即可（不再屏蔽 V2）。 */}
      {isSingle && (
        <>
          <div className="space-y-2">
            <Label>{t("resources.import.fields.customName")}</Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t("resources.import.fields.customNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("resources.import.fields.customDescription")}</Label>
            <Textarea
              className="overflow-hidden"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder={t("resources.import.fields.customDescriptionPlaceholder")}
            />
          </div>
        </>
      )}
    </div>
  )
}
