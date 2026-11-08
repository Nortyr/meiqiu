import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  LintIssueKind,
  LintReport,
  SessionInfo,
  WikiListResult,
  WikiPageMeta,
  WikiPage as WikiPageData,
  WikiPageType,
  WikiSearchHit
} from '../../../shared/types'
import { useSettings } from '../state/settings'
import type { Dict } from '../i18n/zh'
import DetailHeader from '../components/DetailHeader'
import Loading from '../components/Loading'

// 左树四类的固定顺序
const TYPE_ORDER: WikiPageType[] = ['source', 'entity', 'concept', 'analysis']

// 右侧四态：目录首页 / 某类页面列表 / 页面详情 / 体检报告
type View =
  | { kind: 'home' }
  | { kind: 'list'; type: WikiPageType }
  | { kind: 'detail'; slug: string; from: View }
  | { kind: 'lint' }

// 体检问题类型的展示顺序
const LINT_KIND_ORDER: LintIssueKind[] = [
  'broken-link',
  'orphan',
  'deprecated-ref',
  'evidence-gone',
  'stale-source'
]

interface WikiPageProps {
  onOpenSession: (session: SessionInfo) => void
}

function WikiPage({ onOpenSession }: WikiPageProps): React.JSX.Element {
  const { t } = useSettings()
  const [result, setResult] = useState<WikiListResult | null>(null)
  const [keyword, setKeyword] = useState('')
  const [view, setView] = useState<View>({ kind: 'home' })
  const [hits, setHits] = useState<WikiSearchHit[] | null>(null)
  const [lintReport, setLintReport] = useState<LintReport | null>(null)
  const [lintRunning, setLintRunning] = useState(false)

  const load = (): void => {
    window.api.wikiList().then(setResult)
  }
  useEffect(load, [])
  useEffect(() => window.api.onWikiChanged(load), [])
  useEffect(() => {
    window.api.wikiLintLatest().then(setLintReport)
  }, [])

  // 跑一次程序体检（不调模型）
  const runLint = async (): Promise<void> => {
    setLintRunning(true)
    try {
      setLintReport(await window.api.wikiLint())
    } finally {
      setLintRunning(false)
    }
  }

  const searching = keyword.trim().length > 0
  // 搜索防抖 200ms，走主进程 FTS；清空关键词时结果在 onChange 里直接清
  useEffect(() => {
    if (!searching) return
    const timer = setTimeout(() => {
      window.api.wikiSearch(keyword.trim()).then(setHits)
    }, 200)
    return () => clearTimeout(timer)
  }, [keyword, searching])

  const pages = result?.pages ?? []
  const countOf = (type: WikiPageType): number => pages.filter((p) => p.type === type).length

  // Evidence 里的会话引用：按路径找到会话，跳会话页的对话视图
  const openSessionRef = async (path: string): Promise<void> => {
    const res = await window.api.listSessions()
    const s = res.items.find((x) => x.path === path)
    if (s) onOpenSession(s)
  }

  if (!result) return <Loading />

  const openDetail = (slug: string): void => setView((v) => ({ kind: 'detail', slug, from: v }))

  return (
    <div className="sessions-page">
      <aside className="tree-pane">
        <input
          className="search tree-search"
          placeholder={t.wiki.searchPlaceholder}
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            if (!e.target.value.trim()) setHits(null)
          }}
        />
        {!searching &&
          TYPE_ORDER.map((type) => (
            <button
              key={type}
              className={`tree-row ${view.kind === 'list' && view.type === type ? 'active' : ''}`}
              onClick={() => setView({ kind: 'list', type })}
            >
              <span className="tree-label">{t.wiki.types[type]}</span>
              <span className="group-count">{countOf(type)}</span>
            </button>
          ))}
        {searching && (
          <p className="muted small tree-hint">{t.common.matches(hits?.length ?? 0)}</p>
        )}
        {!searching && (
          <button
            className={`tree-row lint-entry ${view.kind === 'lint' ? 'active' : ''}`}
            onClick={() => setView({ kind: 'lint' })}
            title={t.wiki.lintTooltip}
          >
            <span className="tree-label">{t.wiki.lint}</span>
            {lintReport && lintReport.issues.length > 0 && (
              <span className="group-count">{lintReport.issues.length}</span>
            )}
          </button>
        )}
      </aside>

      <div className="session-right">
        <section className="session-pane">
          {!searching && view.kind !== 'lint' && lintReport && lintReport.issues.length > 0 && (
            <div className="lint-banner">
              {t.wiki.lintBanner(lintReport.issues.length)}
              <button className="ingest-report-btn" onClick={() => setView({ kind: 'lint' })}>
                {t.wiki.viewReport}
              </button>
            </div>
          )}
          {searching ? (
            <>
              <h2 className="pane-title">{t.common.searchTitle(keyword.trim())}</h2>
              <div className="session-list">
                {(hits ?? []).map((h) => (
                  <button key={h.slug} className="session-card" onClick={() => openDetail(h.slug)}>
                    <div className="session-main">
                      <div className="card-title">{h.title}</div>
                      <div className="card-meta">
                        <span className="tag">{t.wiki.types[h.type]}</span>
                        <span className="muted small card-summary">{h.snippet}</span>
                      </div>
                    </div>
                  </button>
                ))}
                {hits !== null && hits.length === 0 && (
                  <p className="muted pane-hint">{t.wiki.noMatch}</p>
                )}
              </div>
            </>
          ) : view.kind === 'lint' ? (
            <div className="conversation">
              <DetailHeader
                title={t.wiki.lintReport}
                subtitle={
                  lintReport
                    ? t.wiki.lintMeta(
                        new Date(lintReport.createdAt).toLocaleString(),
                        lintReport.issues.length
                      )
                    : t.wiki.lintNever
                }
                onBack={() => setView({ kind: 'home' })}
              >
                <button
                  className="ingest-report-btn"
                  onClick={() => void runLint()}
                  disabled={lintRunning}
                >
                  {lintRunning ? t.wiki.lintRunning : t.wiki.lintRerun}
                </button>
              </DetailHeader>
              <div className="conv-body lint-body">
                {lintReport &&
                  LINT_KIND_ORDER.map((kind) => {
                    const group = lintReport.issues.filter((i) => i.kind === kind)
                    if (group.length === 0) return null
                    return (
                      <div key={kind}>
                        <h3 className="detail-h">
                          {t.wiki.lintKinds[kind]}（{group.length}）
                        </h3>
                        {group.map((issue, i) => (
                          <button
                            key={i}
                            className="lint-row"
                            disabled={!issue.slug}
                            onClick={() => issue.slug && openDetail(issue.slug)}
                          >
                            {issue.slug && <span className="lint-slug">{issue.slug}</span>}
                            <span className="lint-msg">{issue.message}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })}
                {lintReport?.issues.length === 0 && <p className="muted">{t.wiki.lintClean}</p>}
                {!lintReport && <p className="muted">{t.wiki.lintHint}</p>}
              </div>
            </div>
          ) : view.kind === 'detail' ? (
            <WikiDetail
              slug={view.slug}
              onBack={() => setView(view.from)}
              onOpenPage={(slug) => setView({ kind: 'detail', slug, from: view.from })}
              onOpenSessionRef={openSessionRef}
              t={t}
            />
          ) : view.kind === 'list' ? (
            <>
              <h2 className="pane-title">{t.wiki.types[view.type]}</h2>
              <PageRows
                pages={pages.filter((p) => p.type === view.type)}
                onOpen={openDetail}
                t={t}
              />
            </>
          ) : (
            <Home pages={pages} onOpen={openDetail} t={t} />
          )}
        </section>
      </div>
    </div>
  )
}

// 页面行（列表和目录共用）
function PageRows({
  pages,
  onOpen,
  t
}: {
  pages: WikiPageMeta[]
  onOpen: (slug: string) => void
  t: Dict
}): React.JSX.Element {
  return (
    <div className="session-list">
      {pages.map((p) => (
        <button key={p.slug} className="session-card" onClick={() => onOpen(p.slug)}>
          <div className="session-main">
            <div className="card-title">
              {p.title}
              {p.status === 'deprecated' && (
                <span className="tag deprecated-tag">{t.wiki.deprecated}</span>
              )}
            </div>
            <div className="card-meta">
              <span className="muted small card-summary">{p.summary}</span>
              {p.evidenceLevel && (
                <span className={`tag level-${p.evidenceLevel}`}>
                  {t.wiki.levels[p.evidenceLevel] ?? p.evidenceLevel}
                </span>
              )}
              {p.updatedAt && <span className="muted small">{p.updatedAt.slice(0, 10)}</span>}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

// 目录首页：四类分组各一块；空库给行动指引
function Home({
  pages,
  onOpen,
  t
}: {
  pages: WikiPageMeta[]
  onOpen: (slug: string) => void
  t: Dict
}): React.JSX.Element {
  if (pages.length === 0) {
    return (
      <div className="pane-hint wiki-empty">
        <p>{t.wiki.emptyTitle}</p>
        <p className="muted small">{t.wiki.emptyHint}</p>
      </div>
    )
  }
  return (
    <>
      {TYPE_ORDER.map((type) => {
        const group = pages.filter((p) => p.type === type)
        if (group.length === 0) return null
        return (
          <div key={type}>
            <h2 className="pane-title">{t.wiki.groupTitle(t.wiki.types[type], group.length)}</h2>
            <PageRows pages={group} onOpen={onOpen} t={t} />
          </div>
        )
      })}
    </>
  )
}

// [[slug]] → 内部跳转链接；「会话 /path」→ 可点的会话引用
function linkify(body: string): string {
  return body
    .replace(/\[\[([A-Za-z0-9-]+)\]\]/g, '[$1](#wiki:$1)')
    .replace(
      /(会话\s+)(\/[^\s·)]+)/g,
      (_m, p1: string, p2: string) => `${p1}[${p2}](#session:${encodeURIComponent(p2)})`
    )
}

interface WikiDetailProps {
  slug: string
  onBack: () => void
  onOpenPage: (slug: string) => void
  onOpenSessionRef: (path: string) => Promise<void>
  t: Dict
}

function WikiDetail({
  slug,
  onBack,
  onOpenPage,
  onOpenSessionRef,
  t
}: WikiDetailProps): React.JSX.Element {
  const [page, setPage] = useState<WikiPageData | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 换页面时先清空旧内容再加载
    setPage(null)
    window.api.wikiPage(slug).then(setPage)
  }, [slug])

  if (!page) return <Loading text={t.wiki.loadingPage} />

  interface MdLinkProps {
    href?: string
    children?: React.ReactNode
  }
  const renderLink = ({ href, children }: MdLinkProps): React.JSX.Element => {
    const url = href ?? ''
    if (url.startsWith('#wiki:')) {
      const target = url.slice('#wiki:'.length)
      return (
        <button className="wiki-link" onClick={() => onOpenPage(target)}>
          {children}
        </button>
      )
    }
    if (url.startsWith('#session:')) {
      const path = decodeURIComponent(url.slice('#session:'.length))
      return (
        <button
          className="wiki-link session-ref"
          title={t.wiki.openSession(path)}
          onClick={() => void onOpenSessionRef(path)}
        >
          {children}
        </button>
      )
    }
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }

  return (
    <div className="conversation">
      <DetailHeader
        title={page.title}
        subtitle={
          t.wiki.types[page.type] +
          (page.evidenceLevel
            ? ` · ${t.wiki.evidencePrefix}${t.wiki.levels[page.evidenceLevel] ?? page.evidenceLevel}`
            : '') +
          (page.updatedAt ? ` · ${t.wiki.updatedPrefix} ${page.updatedAt.slice(0, 10)}` : '')
        }
        onBack={onBack}
      />
      {page.status === 'deprecated' && <div className="deprecated-bar">{t.wiki.deprecatedBar}</div>}
      <div className="conv-body wiki-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: renderLink }}>
          {linkify(page.body)}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export default WikiPage
