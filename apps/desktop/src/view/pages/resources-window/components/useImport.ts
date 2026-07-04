import { useState, useEffect } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

export type ResourceType = "role" | "tool"

export interface UseImportOptions {
  defaultResourceType?: ResourceType
  lockedResourceType?: boolean
  enableV2?: boolean
  onSuccess?: () => void
  onClose: () => void
}

export function useImport({ defaultResourceType = "role", lockedResourceType = false, enableV2 = false, onSuccess, onClose }: UseImportOptions) {
  const { t } = useTranslation()
  const [resourceType, setResourceType] = useState<ResourceType>(defaultResourceType)
  const [filePaths, setFilePaths] = useState<string[]>([])
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [avatarPath, setAvatarPath] = useState<string>("")
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    setResourceType(defaultResourceType)
  }, [defaultResourceType])

  const reset = () => {
    setFilePaths([])
    setName("")
    setDescription("")
    setAvatarPath("")
    setResourceType(defaultResourceType)
  }

  const selectFiles = async () => {
    try {
      const result = await window.electronAPI?.dialog.openFile({
        filters: [
          { name: "ZIP files", extensions: ["zip"] },
          { name: "All files", extensions: ["*"] },
        ],
        properties: ["openFile", "multiSelections"],
      })
      if (result?.filePaths?.length > 0) {
        setFilePaths(result.filePaths)
      }
    } catch {
      toast.error(t("resources.import.messages.fileNotFound"))
    }
  }

  const removeFile = (index: number) => {
    setFilePaths((prev) => prev.filter((_, i) => i !== index))
  }

  // KNUTH-FEAT 2026-07-04: Import 时可选附加图标（V1/V2 都支持）。
  // 复用 RoleDetailPanel.uploadRoleAvatar 的 dialog.openFile 模式，
  // 仅角色显示（resourceType==='role'）；tool 不传 avatarPath，handler 自然忽略。
  const selectAvatar = async () => {
    try {
      const result = await window.electronAPI?.dialog.openFile({
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
        properties: ["openFile"],
      })
      if (result?.filePaths?.[0]) {
        setAvatarPath(result.filePaths[0])
      }
    } catch {
      toast.error(t("resources.import.messages.fileNotFound"))
    }
  }

  const removeAvatar = () => setAvatarPath("")

  const submit = async () => {
    if (filePaths.length === 0) {
      toast.error(t("resources.import.messages.selectFile"))
      return
    }

    setIsImporting(true)
    let successCount = 0
    let failCount = 0
    const isSingle = filePaths.length === 1
    // KNUTH-FEAT 2026-07-04: V1/V2 由 server-config.enableV2 决定，
    // 不再让用户在 dialog 里选。enableV2=true 走 V2 (RoleX)，否则走 V1 (DPML)。
    const isV2Role = resourceType === "role" && enableV2 === true

    try {
      for (const filePath of filePaths) {
        try {
          // KNUTH-FEAT 2026-07-04: avatar 是单文件 + 仅角色附加的元数据。
          // 多文件批量时不传（避免歧义），tool 也不传（handler 不写入非角色类型）。
          const avatarPayload = isSingle && resourceType === "role" ? avatarPath || undefined : undefined
          const result = isV2Role
            ? await window.electronAPI?.invoke("resources:importV2Role", {
                filePath,
                name: isSingle ? name || undefined : undefined,
                description: isSingle ? description || undefined : undefined,
                avatarPath: avatarPayload,
              })
            : await window.electronAPI?.invoke("resources:import", {
                filePath,
                type: resourceType,
                name: isSingle ? name || undefined : undefined,
                description: isSingle ? description || undefined : undefined,
                avatarPath: avatarPayload,
              })

          if (result?.success) {
            successCount++
          } else {
            failCount++
            toast.error(t(String(result?.message || "resources.import.messages.importFailed")))
          }
        } catch (err) {
          failCount++
          toast.error(t(String(err || "resources.import.messages.importFailed")))
        }
      }

      if (successCount > 0) {
        if (failCount > 0) {
          toast.warning(
            t("resources.import.messages.importPartialSuccess", {
              success: successCount,
              total: filePaths.length,
            })
          )
        } else {
          toast.success(t("resources.import.messages.importSuccess"))
        }
        reset()
        onClose()
        onSuccess?.()
      }
    } catch (error) {
      toast.error(t(String(error)))
    } finally {
      setIsImporting(false)
    }
  }

  const close = () => {
    if (!isImporting) {
      reset()
      onClose()
    }
  }

  return {
    state: { resourceType, filePaths, name, description, avatarPath, isImporting, lockedResourceType },
    actions: { setResourceType, selectFiles, removeFile, setName, setDescription, selectAvatar, removeAvatar, submit, close },
  }
}
