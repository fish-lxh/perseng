import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { WindowTitleBar } from "@/components/window/WindowTitleBar"

type SecondaryWindowLayoutProps = {
  title?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  children: ReactNode
  contentClassName?: string
}

export function SecondaryWindowLayout({
  title,
  leading,
  actions,
  children,
  contentClassName,
}: SecondaryWindowLayoutProps) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-pattern-meander">
      <WindowTitleBar title={title} leading={leading} actions={actions} />
      <div className={cn("flex-1 overflow-hidden", contentClassName)}>
        {children}
      </div>
    </div>
  )
}
