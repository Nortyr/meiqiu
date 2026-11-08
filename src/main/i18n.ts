import { app } from 'electron'
import type { Locale } from '../shared/types'
import { getSettings } from './settings'

// 主进程里会显示到界面的字符串（IPC 抛错、拼给 agent 的指令）。
// 界面的文案在 renderer 的 i18n 字典里；这里只管主进程产生的
const STRINGS = {
  zh: {
    acpNotEnabled: 'ACP 未启用，先到设置页开启',
    notConnected: '还没连上',
    disconnected: '连接已断开'
  },
  en: {
    acpNotEnabled: 'ACP is not enabled. Turn it on in Settings first.',
    notConnected: 'Not connected yet.',
    disconnected: 'Connection closed.'
  }
} as const

export type MainStringKey = keyof (typeof STRINGS)['zh']

// 用户在设置里选了语言就用；没选跟随系统
export function mainLocale(): Locale {
  const l = getSettings().locale
  if (l === 'zh' || l === 'en') return l
  return app.getLocale().startsWith('zh') ? 'zh' : 'en'
}

export function mainT(key: MainStringKey): string {
  return STRINGS[mainLocale()][key]
}
