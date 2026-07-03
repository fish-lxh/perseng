import { Toaster } from "sonner"
import { TimelinePanel } from "./components/TimelinePanel"

export default function TimelineWindow() {
  return (
    <div className="h-[calc(100vh-53px)] flex flex-col">
      <Toaster />
      <div className="flex-1 px-6 pb-6 overflow-hidden">
        <TimelinePanel />
      </div>
    </div>
  )
}