import { DatabaseManagerPanel } from "./components/DatabaseManagerPanel"

export default function DatabaseManagerWindow() {
  return (
    <div className="h-[calc(100vh-53px)] flex flex-col">
      <div className="flex-1 px-6 pb-6 overflow-hidden">
        <DatabaseManagerPanel />
      </div>
    </div>
  )
}