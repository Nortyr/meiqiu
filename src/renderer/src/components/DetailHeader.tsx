import type { ReactNode } from 'react'
import { useSettings } from '../state/settings'

// 详情视图统一的头部：无边框返回按钮 + 标题/副标题 + 右侧操作区（可选）
interface DetailHeaderProps {
  title: string
  subtitle?: string
  onBack: () => void
  children?: ReactNode // 右侧操作（如「重新体检」「取消任务」）
}

function DetailHeader({ title, subtitle, onBack, children }: DetailHeaderProps): React.JSX.Element {
  const { t } = useSettings()
  return (
    <header className="conv-header">
      <button className="icon-btn" onClick={onBack} title={t.common.back}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 6-6 6 6 6" />
        </svg>
      </button>
      <div className="conv-title">
        <div className="card-title">{title}</div>
        {subtitle && <div className="muted small">{subtitle}</div>}
      </div>
      {children}
    </header>
  )
}

export default DetailHeader
