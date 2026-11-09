import { useEffect, useRef, useState } from 'react'
import { AGENT_LABELS } from '../../../shared/types'
import { useChat } from '../chat/chat'
import { useSettings } from '../state/settings'
import DetailHeader from './DetailHeader'

// ACP 聊天视图：消息流 + 工具调用 + 产物折叠条 + 摄入报告条。
// 聊天状态全在 useChat()（App 层），切页不丢
function ChatView({
  onBack,
  providerLabel
}: {
  onBack: () => void
  providerLabel: string
}): React.JSX.Element {
  const { t } = useSettings()
  const chat = useChat()
  const [reportOpen, setReportOpen] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const skillsRef = useRef<HTMLDivElement>(null)

  // 关闭浮层时顺带清空搜索词
  const closeSkills = (): void => {
    setSkillQuery('')
    chat.toggleSkills()
  }

  // skill 浮层：点外面 / Esc 关闭
  useEffect(() => {
    if (!chat.showSkills) return
    const onDown = (e: MouseEvent): void => {
      if (!skillsRef.current?.contains(e.target as Node)) closeSkills()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSkills()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.showSkills])

  // 聊天消息自动滚到底部
  useEffect(() => {
    bodyRef.current?.scrollTo(0, bodyRef.current.scrollHeight)
  }, [chat.messages, chat.tools])

  const { task, taskMode, ingestReport } = chat
  const report = ingestReport

  return (
    <div className="conversation">
      <DetailHeader
        title={
          task ? (taskMode === 'ingest' ? t.chat.ingestWiki : t.chat.extractSkill) : providerLabel
        }
        subtitle={
          task
            ? t.chat.taskBanner(taskMode, AGENT_LABELS[task.agent], task.title ?? task.path)
            : t.chat.directChat
        }
        onBack={onBack}
      >
        {task && (
          <button className="task-clear" onClick={chat.clearTask}>
            {t.chat.cancelTask}
          </button>
        )}
        <div className="skills-anchor" ref={skillsRef}>
          <button
            className={`skills-toggle ${chat.showSkills ? 'open' : ''}`}
            onClick={chat.showSkills ? closeSkills : chat.toggleSkills}
          >
            {t.chat.skillsToggle(chat.skills.length)} {chat.showSkills ? '▴' : '▾'}
          </button>
          {chat.showSkills && (
            <div className="skills-pop">
              <input
                className="skills-pop-search"
                autoFocus
                placeholder={t.chat.skillsSearch}
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
              />
              <div className="skills-pop-list">
                {chat.skills.length === 0 && <p className="muted small">{t.chat.noSkills}</p>}
                {chat.skills
                  .filter((s) =>
                    `${s.name} ${s.description}`.toLowerCase().includes(skillQuery.toLowerCase())
                  )
                  .map((s) => (
                    <div key={s.path} className="skills-pop-row" title={s.path}>
                      <span className="product-name">{s.name}</span>
                      <span className="muted small product-desc">{s.description}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </DetailHeader>
      {report && (
        <div className={`ingest-report ${report.errors.length > 0 ? 'has-error' : ''}`}>
          <div className="ingest-report-row">
            <span className="ingest-report-summary">
              {report.status === 'rolled-back'
                ? t.chat.reportRolledBack
                : t.chat.reportSummary(
                    report.created.length,
                    report.updated.length,
                    report.warnings.length,
                    report.errors.length
                  )}
            </span>
            {report.status !== 'rolled-back' && (
              <button className="ingest-report-btn" onClick={() => setReportOpen((v) => !v)}>
                {reportOpen ? t.chat.collapse : t.chat.viewDetail}
              </button>
            )}
            {report.errors.length > 0 && report.status !== 'rolled-back' && (
              <button
                className="ingest-report-btn rollback"
                onClick={() => void chat.rollbackIngest()}
              >
                {t.chat.rollback}
              </button>
            )}
            <button className="task-clear" onClick={chat.dismissReport}>
              ✕
            </button>
          </div>
          {reportOpen && report.status !== 'rolled-back' && (
            <div className="ingest-report-detail">
              {report.created.length > 0 && (
                <p>{t.chat.createdPages(report.created.map((s) => `[[${s}]]`).join('、'))}</p>
              )}
              {report.updated.length > 0 && (
                <p>{t.chat.updatedPages(report.updated.map((s) => `[[${s}]]`).join('、'))}</p>
              )}
              {report.warnings.map((w, i) => (
                <p key={i} className="ingest-warning">
                  ⚠ {w}
                </p>
              ))}
              {report.errors.map((e, i) => (
                <p key={i} className="ingest-error">
                  {e}
                </p>
              ))}
              {report.created.length === 0 &&
                report.updated.length === 0 &&
                report.warnings.length === 0 &&
                report.errors.length === 0 && <p className="muted small">{t.chat.noChanges}</p>}
            </div>
          )}
        </div>
      )}
      <div className="conv-body" ref={bodyRef}>
        {chat.messages.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}`}>
              {m.text}
              {m.streaming && <span className="cursor">▍</span>}
            </div>
          </div>
        ))}
        {chat.tools.length > 0 && (
          <div className="tool-list">
            {chat.tools.map((tool) => (
              <div key={tool.id} className="tool-item">
                <span className={`tool-dot ${tool.status}`} />
                <span className="tool-title">{tool.title}</span>
                <span className="muted small">{tool.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatView
