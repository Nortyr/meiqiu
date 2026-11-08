/* eslint-disable react-refresh/only-export-components -- context 文件：Provider 和 hook 必须同文件 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AcpConfigPatch, Locale, SettingsResult } from '../../../shared/types'
import { zh, type Dict } from '../i18n/zh'
import { en } from '../i18n/en'

// App 级设置：各页面共享同一份（不再各自 getSettings），语言也从这里派生
interface SettingsContextValue {
  settings: SettingsResult | null // null = 还没加载完
  save: (patch: AcpConfigPatch) => Promise<void>
  locale: Locale
  t: Dict
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsResult | null>(null)
  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  const save = async (patch: AcpConfigPatch): Promise<void> => {
    setSettings(await window.api.saveSettings(patch))
  }

  // 设置里没选语言就跟随系统
  const systemLocale: Locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const locale: Locale =
    settings?.locale === 'zh' || settings?.locale === 'en' ? settings.locale : systemLocale

  return (
    <SettingsContext.Provider value={{ settings, save, locale, t: locale === 'en' ? en : zh }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用')
  return ctx
}
