import { useState } from 'react'
import MemoriesPage from './pages/MemoriesPage'
import SessionsPage from './pages/SessionsPage'
import WikiPage from './pages/WikiPage'
import SettingsPage from './pages/SettingsPage'
import { SettingsProvider, useSettings } from './state/settings'
import { ChatProvider } from './chat/chat'
import type { SessionInfo } from '../../shared/types'

type Page = 'memories' | 'sessions' | 'wiki' | 'settings'

// 导航项：label 从 i18n 字典取，NAV 只放 id 和图标
const NAV: { id: Page; icon: React.JSX.Element }[] = [
  {
    id: 'memories',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4a4 4 0 0 0-4 4 4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-1.5A4 4 0 0 0 16 8a4 4 0 0 0-4-4Z" />
      </svg>
    )
  },
  {
    id: 'sessions',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    )
  },
  {
    id: 'wiki',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </svg>
    )
  },
  {
    id: 'settings',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
      </svg>
    )
  }
]

function Shell(): React.JSX.Element {
  const { t } = useSettings()
  const [page, setPage] = useState<Page>('memories')
  // 知识库 Evidence 跳会话：把要打开的会话传给会话页
  const [requestedSession, setRequestedSession] = useState<SessionInfo | null>(null)

  return (
    <div className="app-shell">
      {/* 通栏标题条：红绿灯下面不放任何内容，整条可拖动窗口 */}
      <div className="titlebar" />
      <div className="layout">
        <nav className="sidebar">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? 'active' : ''}`}
              onClick={() => setPage(n.id)}
            >
              {n.icon}
              <span className="nav-tooltip">{t.nav[n.id]}</span>
            </button>
          ))}
        </nav>
        <main className="content">
          {page === 'memories' && <MemoriesPage />}
          {page === 'sessions' && (
            <SessionsPage
              requestedSession={requestedSession}
              onRequestHandled={() => setRequestedSession(null)}
            />
          )}
          {page === 'wiki' && (
            <WikiPage
              onOpenSession={(s) => {
                setRequestedSession(s)
                setPage('sessions')
              }}
            />
          )}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}

// 设置和聊天状态挂在 App 层：切页不卸载（聊天/摄入状态不丢），各页面共享同一份设置
function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <ChatProvider>
        <Shell />
      </ChatProvider>
    </SettingsProvider>
  )
}

export default App
