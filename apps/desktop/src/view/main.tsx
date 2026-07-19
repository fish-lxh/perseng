import './styles/globals.css'
// KNUTH-FIX 2026-07-19: 本地字体打包（替换 Google Fonts CDN）。
// @fontsource/* 在 node_modules 里提供 woff2 + CSS @font-face，
// vite 会自动 bundle，electron-builder 的 node_modules/** glob 打进 asar。
// 顺序：必须在 globals.css 前，让 @font-face 声明先注册。
import '@fontsource/orbitron/index.css'
import '@fontsource/jetbrains-mono/index.css'
import '@fontsource/noto-sans-sc/index.css'
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