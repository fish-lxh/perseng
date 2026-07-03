import { useEffect, useState, type ReactNode } from "react"
import { WindowControls } from "@/components/window/WindowControls"

type WindowTitleBarProps = {
  title?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
}

export function WindowTitleBar({
  title,
  leading,
  actions,
}: WindowTitleBarProps) {
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    window.electronAPI?.windowControls
      ?.isMaximized()
      .then(setIsWindowMaximized)
      .catch(() => {})

    unsubscribe = window.electronAPI?.windowControls?.onStateChange((state) => {
      setIsWindowMaximized(state.isMaximized)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const handleWindowMinimize = () => {
    window.electronAPI?.windowControls?.minimize().catch(() => {})
  }

  const handleWindowMaximizeToggle = () => {
    window.electronAPI?.windowControls
      ?.maximizeToggle()
      .then((state) => setIsWindowMaximized(state.isMaximized))
      .catch(() => {})
  }

  const handleWindowClose = () => {
    window.electronAPI?.windowControls?.close().catch(() => {})
  }

  return (
    <div
      className="app-drag flex items-center justify-between border-b border-pattern-meander-top bg-background px-4 py-3 select-none"
      onDoubleClick={handleWindowMaximizeToggle}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leading}
        <div className="min-w-0 flex-1">{title}</div>
      </div>
      <div className="app-no-drag flex items-center gap-2">
        {actions}
        <WindowControls
          isMaximized={isWindowMaximized}
          onMinimize={handleWindowMinimize}
          onMaximizeToggle={handleWindowMaximizeToggle}
          onClose={handleWindowClose}
        />
      </div>
    </div>
  )
}
