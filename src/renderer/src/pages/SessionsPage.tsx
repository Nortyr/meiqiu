import { useEffect, useMemo, useState } from 'react'
import type { SessionsResult, SessionInfo, AgentId } from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'
import { useChat, withSessionContext } from '../chat/chat'
import { useSettings } from '../state/settings'
import Chevron from '../components/Chevron'
import ChatView from '../components/ChatView'
import ConversationView from '../components/ConversationView'
import Loading from '../components/Loading'

// 右侧会话列表一次最多渲染这么多条
const RENDER_CAP = 100

// 右侧内容的三态：项目会话列表 / 对话视图 / 聊天视图
type View = { kind: 'list' } | { kind: 'conversation'; session: SessionInfo } | { kind: 'chat' }

interface ProjectNode {
  project: string
  items: SessionInfo[]
}

interface AgentNode {
  agent: AgentId
  projects: ProjectNode[]
  total: number
}

interface SessionsPageProps {
  // 知识库 Evidence 跳过来的会话：打开它的对话视图
  requestedSession?: SessionInfo | null
  onRequestHandled?: () => void
}

function SessionsPage({
  requestedSession,
  onRequestHandled
}: SessionsPageProps): React.JSX.Element {
  const { settings, t } = useSettings()
  const chat = useChat()
  const [result, setResult] = useState<SessionsResult | null>(null)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<{ agent: AgentId; project: string } | null>(null)
  const [expandedAgents, setExpandedAgents] = useState<Set<AgentId>>(new Set(['kiro']))
  // 切走再切回来时，聊天视图开着就直接恢复（聊天记录本身在 ChatProvider 里不丢）
  const [view, setView] = useState<View>(chat.chatViewOpen ? { kind: 'chat' } : { kind: 'list' })

  // 记住聊天视图的开合状态，供下次挂载恢复
  useEffect(() => {
    chat.setChatViewOpen(view.kind === 'chat')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟随视图开合变化
  }, [view.kind])

  const load = (): void => {
    window.api.listSessions().then(setResult)
  }
  useEffect(load, [])
  useEffect(() => window.api.onSessionsChanged(load), [])

  // 知识库跳过来的会话：直接打开对话视图
  useEffect(() => {
    if (!requestedSession) return
    /* eslint-disable react-hooks/set-state-in-effect -- 外部跳转请求就是要在 effect 里重置视图 */
    setKeyword('')
    setSelected(null)
    setView({ kind: 'conversation', session: requestedSession })
    /* eslint-enable react-hooks/set-state-in-effect */
    onRequestHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 requestedSession 变化时触发
  }, [requestedSession])

  const searching = keyword.trim().length > 0
  const kw = keyword.trim().toLowerCase()

  const tree = useMemo<AgentNode[]>(() => {
    if (!result) return []
    const map = new Map<AgentId, Map<string, SessionInfo[]>>()
    for (const s of result.items) {
      if (!map.has(s.agent)) map.set(s.agent, new Map())
      const proj = s.project ?? t.common.unknownProject
      const pm = map.get(s.agent)!
      if (!pm.has(proj)) pm.set(proj, [])
      pm.get(proj)!.push(s)
    }
    return (Object.keys(AGENT_LABELS) as AgentId[])
      .filter((a) => map.has(a))
      .map((agent) => {
        const pm = map.get(agent)!
        const projects = [...pm.entries()]
          .map(([project, items]) => ({ project, items }))
          .sort((a, b) => b.items[0].updatedAt.localeCompare(a.items[0].updatedAt))
        return { agent, projects, total: projects.reduce((n, p) => n + p.items.length, 0) }
      })
  }, [result, t])

  const shown = useMemo<SessionInfo[]>(() => {
    if (!result) return []
    if (searching) {
      return result.items.filter((s) =>
        `${s.title ?? ''} ${s.project ?? ''} ${s.sessionId}`.toLowerCase().includes(kw)
      )
    }
    if (!selected) return []
    const node = tree.find((n) => n.agent === selected.agent)
    return node?.projects.find((p) => p.project === selected.project)?.items ?? []
  }, [result, searching, kw, selected, tree])

  const toggleAgent = (a: AgentId): void => {
    setExpandedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(a)) next.delete(a)
      else next.add(a)
      return next
    })
  }

  const send = async (): Promise<void> => {
    const text = chat.input.trim()
    if (!text || chat.running) return
    // 正在看某个会话时发问，把这个会话的文件作为上下文带上（只带这轮对话的第一条）
    let out = text
    if (!chat.task && view.kind === 'conversation' && chat.messages.length === 0) {
      out = withSessionContext(text, view.session, t)
    }
    setView({ kind: 'chat' })
    await chat.send(out)
  }

  if (!result || !settings) return <Loading />

  const providerLabel = settings.acpProvider === 'opencode' ? 'OpenCode' : 'Claude Code'

  return (
    <div className="sessions-page">
      <aside className="tree-pane">
        <input
          className="search tree-search"
          placeholder={t.sessions.searchPlaceholder}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {!searching &&
          tree.map((node) => (
            <div key={node.agent} className="tree-agent">
              <button className="tree-row tree-agent-row" onClick={() => toggleAgent(node.agent)}>
                <Chevron open={expandedAgents.has(node.agent)} />
                <span className="tree-label">{AGENT_LABELS[node.agent]}</span>
                <span className="group-count">{node.total}</span>
              </button>
              {expandedAgents.has(node.agent) &&
                node.projects.map((p) => (
                  <button
                    key={p.project}
                    className={`tree-row tree-project-row ${
                      selected?.agent === node.agent && selected?.project === p.project
                        ? 'active'
                        : ''
                    }`}
                    title={p.project}
                    onClick={() => {
                      setSelected({ agent: node.agent, project: p.project })
                      setView({ kind: 'list' })
                    }}
                  >
                    <span className="tree-label">
                      {shortProject(p.project, t.common.unknownProject)}
                    </span>
                    <span className="group-count">{p.items.length}</span>
                  </button>
                ))}
            </div>
          ))}
        {searching && <p className="muted small tree-hint">{t.common.matches(shown.length)}</p>}
      </aside>

      <div className="session-right">
        <section className="session-pane">
          {chat.hintText && (
            <div className="setup-hint">
              {chat.hintText}
              <button className="task-clear" onClick={chat.clearHint}>
                ✕
              </button>
            </div>
          )}
          {result.errors.map((e) => (
            <p key={e.agent} className="error">
              {t.common.readFail(AGENT_LABELS[e.agent], e.error)}
            </p>
          ))}
          {view.kind === 'conversation' ? (
            <ConversationView session={view.session} onBack={() => setView({ kind: 'list' })} />
          ) : view.kind === 'chat' ? (
            <ChatView onBack={() => setView({ kind: 'list' })} providerLabel={providerLabel} />
          ) : shown.length === 0 ? (
            <p className="muted pane-hint">
              {searching ? t.sessions.noMatch : t.sessions.pickProject}
            </p>
          ) : (
            <>
              <h2 className="pane-title">
                {searching
                  ? t.common.searchTitle(keyword.trim())
                  : `${AGENT_LABELS[selected!.agent]} › ${selected!.project}`}
              </h2>
              <div className="session-list">
                {shown.slice(0, RENDER_CAP).map((s) => (
                  <button
                    key={s.id}
                    className="session-card"
                    onClick={() => setView({ kind: 'conversation', session: s })}
                  >
                    <div className="session-main">
                      <div className="card-title">{s.title ?? s.sessionId}</div>
                      <div className="card-meta">
                        <span className="muted small">
                          {new Date(s.updatedAt).toLocaleString()}
                        </span>
                        {s.messageCount !== undefined && (
                          <span className="tag">{t.sessions.messageCount(s.messageCount)}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {shown.length > RENDER_CAP && (
                <p className="muted small more-hint">
                  {t.sessions.moreHint(RENDER_CAP, shown.length - RENDER_CAP)}
                </p>
              )}
            </>
          )}
        </section>

        {/* 底部常驻输入条：设置里启用 ACP 才出现 */}
        {settings.acpEnabled && (
          <div className="composer-bar">
            {chat.task && (
              <div className="task-banner inline">
                <span className="tag">{t.chat.taskTag}</span>
                <span className="task-text">
                  {t.chat.taskBanner(
                    chat.taskMode,
                    AGENT_LABELS[chat.task.agent],
                    chat.task.title ?? chat.task.path
                  )}
                </span>
                <button className="task-clear" onClick={chat.clearTask}>
                  ✕
                </button>
              </div>
            )}
            <div className="composer">
              <div className="composer-toolbar">
                {view.kind === 'conversation' && (
                  <>
                    <button
                      className="composer-chip"
                      onClick={() => void chat.startExtract(view.session)}
                      title={t.chat.extractTitle}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3v3m0 12v3M5.6 5.6l2.2 2.2m8.4 8.4 2.2 2.2M3 12h3m12 0h3M5.6 18.4l2.2-2.2m8.4-8.4 2.2-2.2" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                      {t.chat.extractSkill}
                    </button>
                    <button
                      className="composer-chip"
                      onClick={() => void chat.startIngest(view.session)}
                      title={t.chat.ingestTitle}
                    >
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
                      {t.chat.ingestWiki}
                    </button>
                  </>
                )}
                {/* 以后加：MCP、选择 skill、模型等 */}
              </div>
              <div className="composer-input">
                <textarea
                  value={chat.input}
                  onChange={(e) => chat.setInput(e.target.value)}
                  placeholder={t.chat.composerPlaceholder(providerLabel)}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
                <button
                  className="btn-primary send-btn"
                  onClick={() => void send()}
                  disabled={chat.running || !chat.input.trim()}
                  title={t.common.send}
                >
                  {chat.running ? '…' : '↑'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// /Users/foo/bar/meiqiu → meiqiu；树里只显示最后一段，全路径在 title 里
function shortProject(p: string, unknownLabel: string): string {
  if (p === unknownLabel) return p
  const seg = p.replace(/\/+$/, '').split('/').pop()
  return seg || p
}

export default SessionsPage
