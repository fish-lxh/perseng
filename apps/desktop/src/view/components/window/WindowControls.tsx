import type { ReactNode } from "react"

type WindowControlsProps = {
  isMaximized: boolean
  onMinimize: () => void
  onMaximizeToggle: () => void
  onClose: () => void
}

const CONTROL_SCALE = 0.5

const buttonBaseSize = 32
const iconBaseSize = 14
const buttonSize = buttonBaseSize * CONTROL_SCALE
const iconSize = iconBaseSize * CONTROL_SCALE
const gapSize = 8 * CONTROL_SCALE
const borderRadius = 8 * CONTROL_SCALE

type ControlButtonProps = {
  label: string
  onClick: () => void
  children: ReactNode
  tone?: "neutral" | "accent" | "danger"
}

function MinimizeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="currentColor" aria-hidden="true">
      <rect x="5" y="14.5" width="14" height="3" rx="1.5" />
      <rect x="9" y="9.5" width="6" height="1.75" rx="0.875" opacity="0.45" />
    </svg>
  )
}

function MaximizeGlyph({ isMaximized }: { isMaximized: boolean }) {
  if (isMaximized) {
    return (
      <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="currentColor" aria-hidden="true">
        <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3H18a2 2 0 0 1 2 2v7.5A2.5 2.5 0 0 1 17.5 15H15v2.5A2.5 2.5 0 0 1 12.5 20H5a2 2 0 0 1-2-2v-7.5A2.5 2.5 0 0 1 5.5 8H8V5.5Zm2 0V8h5.5A2.5 2.5 0 0 1 18 10.5V13h-.5A2.5 2.5 0 0 1 15 10.5V8H10V5.5ZM5 10.5V18h7.5V10H5Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="currentColor" aria-hidden="true">
      <path d="M6 4h9.5A4.5 4.5 0 0 1 20 8.5V18a2 2 0 0 1-2 2H8.5A4.5 4.5 0 0 1 4 15.5V6a2 2 0 0 1 2-2Zm0 2v9.5A2.5 2.5 0 0 0 8.5 18H18V8.5A2.5 2.5 0 0 0 15.5 6H6Zm3 2.25h6a.75.75 0 0 1 .75.75v5.75a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75V9A.75.75 0 0 1 9 8.25Z" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} fill="currentColor" aria-hidden="true">
      <path d="M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Zm-2.95 5.54a.9.9 0 0 0 0 1.27L10.73 12l-1.68 1.69a.9.9 0 1 0 1.27 1.27L12 13.27l1.69 1.69a.9.9 0 1 0 1.27-1.27L13.27 12l1.69-1.69a.9.9 0 0 0-1.27-1.27L12 10.73l-1.68-1.69a.9.9 0 0 0-1.27 0Z" />
    </svg>
  )
}

function ControlButton({
  label,
  onClick,
  children,
  tone = "neutral",
}: ControlButtonProps) {
  const toneClass =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-600 hover:border-rose-300 hover:bg-rose-100 hover:text-rose-700"
      : tone === "accent"
        ? "border-cyan-200 bg-cyan-50 text-cyan-700 hover:border-cyan-300 hover:bg-cyan-100 hover:text-cyan-800"
        : "border-slate-300 bg-slate-50 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex items-center justify-center border transition-all ${toneClass}`}
      style={{
        width: `${buttonSize}px`,
        height: `${buttonSize}px`,
        borderRadius: `${borderRadius}px`,
      }}
    >
      {children}
    </button>
  )
}

export function WindowControls({
  isMaximized,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: WindowControlsProps) {
  return (
    <div
      className="inline-flex items-center"
      style={{ gap: `${gapSize}px` }}
    >
      <ControlButton label="Minimize" onClick={onMinimize}>
        <MinimizeGlyph />
      </ControlButton>

      <ControlButton
        label={isMaximized ? "Restore Down" : "Maximize"}
        onClick={onMaximizeToggle}
        tone="accent"
      >
        <MaximizeGlyph isMaximized={isMaximized} />
      </ControlButton>

      <ControlButton label="Close" onClick={onClose} tone="danger">
        <CloseGlyph />
      </ControlButton>
    </div>
  )
}
