import { useEffect, useMemo, useState } from 'react'
import type { MemoriesResult, MemoryItem, AgentId } from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'
import { useSettings } from '../state/settings'
import Chevron from '../components/Chevron'
import DetailHeader from '../components/DetailHeader'
import Loading from '../components/Loading'

// 和会话页同一套骨架：左树（agent → 范围）+ 右侧列表，点一条整个替换成详情
type View = { kind: 'list' } | { kind: 'detail'; memory: MemoryItem }

interface ScopeNode {
  scope: string
  items: MemoryItem[]
}

interface AgentNode {
  agent: AgentId
  scopes: ScopeNode[]
  total: number
}

function MemoriesPage(): React.JSX.Element {
  const { t } = useSettings()
  const [result, setResult] = useState<MemoriesResult | null>(null)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<{ agent: AgentId; scope: string } | null>(null)
  const [expandedAgents, setExpandedAgents] = useState<Set<AgentId>>(new Set(['kiro']))
  const [view, setView] = useState<View>({ kind: 'list' })

  const load = (): void => {
    window.api.listMemories().then(setResult)
  }
  useEffect(load, [])
  // agent 在外部改了记忆，主进程推事件后重新加载
  useEffect(() => window.api.onMemoriesChanged(load), [])

  const searching = keyword.trim().length > 0
  const kw = keyword.trim().toLowerCase()

  const tree = useMemo<AgentNode[]>(() => {
    if (!result) return []
    const map = new Map<AgentId, Map<string, MemoryItem[]>>()
    for (const m of result.items) {
      if (!map.has(m.agent)) map.set(m.agent, new Map())
      const sm = map.get(m.agent)!
      if (!sm.has(m.scope)) sm.set(m.scope, [])
      sm.get(m.scope)!.push(m)
    }
    return (Object.keys(AGENT_LABELS) as AgentId[])
      .filter((a) => map.has(a))
      .map((agent) => {
        const sm = map.get(agent)!
        const scopes = [...sm.entries()]
          .map(([scope, items]) => ({ scope, items }))
          .sort((a, b) => {
            // Global 排最前，其他按条数降序
            if (a.scope === 'Global') return -1
            if (b.scope === 'Global') return 1
            return b.items.length - a.items.length
          })
        return { agent, scopes, total: scopes.reduce((n, s) => n + s.items.length, 0) }
      })
  }, [result])

  const shown = useMemo<MemoryItem[]>(() => {
    if (!result) return []
    if (searching) {
      return result.items.filter((m) =>
        `${m.title} ${m.summary} ${m.content}`.toLowerCase().includes(kw)
      )
    }
    if (!selected) return []
    const node = tree.find((n) => n.agent === selected.agent)
    return node?.scopes.find((s) => s.scope === selected.scope)?.items ?? []
  }, [result, searching, kw, selected, tree])

  const toggleAgent = (a: AgentId): void => {
    setExpandedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(a)) next.delete(a)
      else next.add(a)
      return next
    })
  }

  if (!result) return <Loading />

  return (
    <div className="sessions-page">
      <aside className="tree-pane">
        <input
          className="search tree-search"
          placeholder={t.memories.searchPlaceholder}
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
                node.scopes.map((s) => (
                  <button
                    key={s.scope}
                    className={`tree-row tree-project-row ${
                      selected?.agent === node.agent && selected?.scope === s.scope ? 'active' : ''
                    }`}
                    title={s.scope}
                    onClick={() => {
                      setSelected({ agent: node.agent, scope: s.scope })
                      setView({ kind: 'list' })
                    }}
                  >
                    <span className="tree-label">{shortScope(s.scope)}</span>
                    <span className="group-count">{s.items.length}</span>
                  </button>
                ))}
            </div>
          ))}
        {searching && <p className="muted small tree-hint">{t.common.matches(shown.length)}</p>}
      </aside>

      <div className="session-right">
        <section className="session-pane">
          {result.errors.map((e) => (
            <p key={e.agent} className="error">
              {t.common.readFail(AGENT_LABELS[e.agent], e.error)}
            </p>
          ))}
          {view.kind === 'detail' ? (
            <MemoryDetail memory={view.memory} onBack={() => setView({ kind: 'list' })} />
          ) : shown.length === 0 ? (
            <p className="muted pane-hint">
              {searching ? t.memories.noMatch : t.memories.pickScope}
            </p>
          ) : (
            <>
              <h2 className="pane-title">
                {searching
                  ? t.common.searchTitle(keyword.trim())
                  : `${AGENT_LABELS[selected!.agent]} › ${selected!.scope}`}
              </h2>
              <div className="list-container">
                {shown.map((m) => (
                  <button
                    key={m.id}
                    className="list-row"
                    onClick={() => setView({ kind: 'detail', memory: m })}
                  >
                    <div className="session-main">
                      <div className="card-title">{m.title}</div>
                      {m.summary && <div className="card-summary">{m.summary}</div>}
                      <div className="card-meta">
                        <span className="tag">{t.memories.kinds[m.kind] ?? m.kind}</span>
                        {m.subtype && <span className="tag">{m.subtype}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

// 范围路径只显示最后一段，全路径在 title 里
function shortScope(s: string): string {
  if (s === 'Global') return s
  const seg = s.replace(/\/+$/, '').split('/').pop()
  return seg || s
}

function MemoryDetail({
  memory: m,
  onBack
}: {
  memory: MemoryItem
  onBack: () => void
}): React.JSX.Element {
  const { t } = useSettings()
  return (
    <div className="conversation">
      <DetailHeader
        title={m.title}
        subtitle={
          `${AGENT_LABELS[m.agent]} · ${t.memories.kinds[m.kind] ?? m.kind}` +
          `${m.subtype ? ` · ${m.subtype}` : ''} · ${m.scope}`
        }
        onBack={onBack}
      />
      <div className="conv-body">
        {m.summary && (
          <>
            <h3 className="detail-h">{t.memories.summary}</h3>
            <p className="detail-p">{m.summary}</p>
          </>
        )}
        <h3 className="detail-h">{t.memories.content}</h3>
        <pre className="content-block">{m.content}</pre>
        {m.why && (
          <>
            <h3 className="detail-h">why</h3>
            <p className="detail-p">{m.why}</p>
          </>
        )}
        {m.howToApply && (
          <>
            <h3 className="detail-h">how_to_apply</h3>
            <p className="detail-p">{m.howToApply}</p>
          </>
        )}
        <h3 className="detail-h">{t.memories.source}</h3>
        <p className="muted small">{m.filePath}</p>
        {m.sessionId && (
          <p className="muted small">
            {t.memories.sessionPrefix}
            {m.sessionId}
          </p>
        )}
        {m.updatedAt && (
          <p className="muted small">
            {t.memories.updatedPrefix}
            {new Date(m.updatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}

export default MemoriesPage
