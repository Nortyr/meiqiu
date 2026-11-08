import { useEffect, useState } from 'react'
import type { SessionContentResult, SessionInfo } from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'
import { useSettings } from '../state/settings'
import DetailHeader from './DetailHeader'
import Loading from './Loading'

// 历史会话的对话视图：用户右紫气泡 / 助手左白卡片
function ConversationView({
  session,
  onBack
}: {
  session: SessionInfo
  onBack: () => void
}): React.JSX.Element {
  const { t } = useSettings()
  const [content, setContent] = useState<SessionContentResult | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 换会话时先清空旧内容再加载
    setContent(null)
    window.api.getSessionContent(session).then(setContent)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在会话 id 变化时重取（列表重扫会产生新对象，不能按对象依赖）
  }, [session.id])

  return (
    <div className="conversation">
      <DetailHeader
        title={session.title ?? session.sessionId}
        subtitle={`${AGENT_LABELS[session.agent]} · ${new Date(session.updatedAt).toLocaleString()}`}
        onBack={onBack}
      />
      <div className="conv-body">
        {!content && <Loading text={t.sessions.loadingConversation} />}
        {content?.error && <p className="error">{content.error}</p>}
        {content?.truncated && (
          <p className="muted small">{t.sessions.truncated(content.messages.length)}</p>
        )}
        {content?.messages.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}`}>{m.text}</div>
          </div>
        ))}
        {content && !content.error && content.messages.length === 0 && (
          <p className="muted">{t.sessions.emptyConversation}</p>
        )}
      </div>
    </div>
  )
}

export default ConversationView
