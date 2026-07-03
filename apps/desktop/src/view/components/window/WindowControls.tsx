import { Copy, Minus, Square, X } from "lucide-react"

type WindowControlsProps = {
    isMaximized: boolean
    onMinimize: () => void
    onMaximizeToggle: () => void
    onClose: () => void
}

// 用裸 <button> 替代 shadcn Button，彻底绕开 ghost variant 的样式覆盖。
// 视觉锚点：白底深蓝边圆角按钮，hover 时变色 — 在深色 title bar 上一定可见。
const baseBtn =
    "app-no-drag inline-flex items-center justify-center h-8 w-8 rounded-md border-2 border-white/60 bg-slate-800/70 text-white transition-all hover:scale-110 hover:border-white hover:bg-white hover:text-slate-900 active:scale-95"

export function WindowControls({
    isMaximized,
    onMinimize,
    onMaximizeToggle,
    onClose,
}: WindowControlsProps) {
    return (
        <div className="app-no-drag flex items-center gap-2" data-testid="window-controls">
            <button
                type="button"
                className={`${baseBtn}`}
                onClick={onMinimize}
                aria-label="Minimize window"
                title="Minimize"
            >
                <Minus className="h-4 w-4" strokeWidth={3} />
            </button>
            <button
                type="button"
                className={`${baseBtn}`}
                onClick={onMaximizeToggle}
                aria-label={isMaximized ? "Restore window" : "Maximize window"}
                title={isMaximized ? "Restore" : "Maximize"}
            >
                {isMaximized ? (
                    <Copy className="h-4 w-4" strokeWidth={3} />
                ) : (
                    <Square className="h-4 w-4" strokeWidth={3} />
                )}
            </button>
            <button
                type="button"
                className={`${baseBtn} hover:bg-red-500 hover:border-red-500 hover:text-white`}
                onClick={onClose}
                aria-label="Close window"
                title="Close"
            >
                <X className="h-4 w-4" strokeWidth={3} />
            </button>
        </div>
    )
}
