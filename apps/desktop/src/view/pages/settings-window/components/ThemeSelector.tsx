import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Moon, Sun } from '@/lib/crisp-icons'

interface ThemeOption {
  value: 'dark' | 'light'
  labelKey: string
}

const themeOptions: ThemeOption[] = [
  { value: 'dark', labelKey: 'settings.theme.dark' },
  { value: 'light', labelKey: 'settings.theme.light' },
]

export function ThemeSelector() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // next-themes 首帧前 theme 为 undefined,挂载后再渲染选中态避免闪烁
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="h-5 w-5" />
          {t('settings.theme.title')}
        </CardTitle>
        <CardDescription>
          {t('settings.theme.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {themeOptions.map((option) => {
            const active = mounted && theme === option.value
            return (
              <Button
                key={option.value}
                variant="outline"
                className={`w-full justify-between ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                    : 'bg-secondary text-secondary-foreground border-border hover:bg-accent'
                }`}
                onClick={() => setTheme(option.value)}
              >
                <span className="flex items-center gap-2">
                  {option.value === 'dark' ? (
                    <Moon className="h-4 w-4" />
                  ) : (
                    <Sun className="h-4 w-4" />
                  )}
                  {t(option.labelKey)}
                </span>
                {active && <Check className="h-4 w-4" />}
              </Button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
