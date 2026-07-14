import './styles/globals.css'
import '@agentxjs/ui/globals.css'
import './components/agentx-ui/styles/globals.css'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { JiangziyaBackground } from './components/JiangziyaBackground'
import { ThemeProvider } from 'next-themes'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(
    <ThemeProvider attribute="class" defaultTheme="dark" themes={['dark', 'light']} enableSystem={false} disableTransitionOnChange>
      <JiangziyaBackground />
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}