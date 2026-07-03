import './styles/globals.css'
import '@agentxjs/ui/globals.css'
import './components/agentx-ui/styles/globals.css'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { JiangziyaBackground } from './components/JiangziyaBackground'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(
    <>
      <JiangziyaBackground />
      <RouterProvider router={router} />
    </>
  )
}