import { useEffect, useState } from 'react'
import type { PermissionRequest } from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'
import { useSettings } from '../state/settings'

function detailOf(request: PermissionRequest): string {
  const value =
    request.toolCall.rawInput ?? request.toolCall.content ?? request.toolCall.locations ?? undefined
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export default function PermissionCenter(): React.JSX.Element | null {
  const { t } = useSettings()
  const [queue, setQueue] = useState<PermissionRequest[]>([])
  const [responding, setResponding] = useState(false)

  useEffect(
    () =>
      window.api.onPermissionRequest((request) => {
        setQueue((current) =>
          current.some((item) => item.requestId === request.requestId)
            ? current
            : [...current, request]
        )
      }),
    []
  )

  const request = queue[0]
  if (!request) return null
  const detail = detailOf(request)
  const finish = async (optionId?: string): Promise<void> => {
    setResponding(true)
    try {
      await window.api.respondPermission({
        requestId: request.requestId,
        optionId,
        cancelled: !optionId
      })
    } finally {
      setQueue((current) => current.filter((item) => item.requestId !== request.requestId))
      setResponding(false)
    }
  }

  return (
    <aside className="permission-card" role="dialog" aria-live="assertive">
      <div className="permission-head">
        <div>
          <strong>{t.permissions.title}</strong>
          <div className="muted small">
            {AGENT_LABELS[request.provider]} ·{' '}
            {queue.length > 1 ? t.permissions.pending(queue.length) : ''}
          </div>
        </div>
      </div>
      <div className="permission-tool">
        {request.toolCall.title || t.permissions.unknownTool}
        {request.toolCall.kind ? <span className="tag">{request.toolCall.kind}</span> : null}
      </div>
      {detail ? (
        <pre className="permission-detail">{detail}</pre>
      ) : (
        <p className="muted small">{t.permissions.noDetail}</p>
      )}
      <div className="permission-options">
        {request.options.map((option) => (
          <button
            key={option.optionId}
            className={
              option.kind === 'allow_always' ? 'btn-ghost permission-remember' : 'btn-ghost'
            }
            disabled={responding}
            onClick={() => finish(option.optionId)}
            title={option.kind === 'allow_always' ? t.permissions.rememberWarning : undefined}
          >
            {option.name}
            {option.kind === 'allow_always' ? ` · ${t.permissions.remember}` : ''}
          </button>
        ))}
        <button className="btn-ghost" disabled={responding} onClick={() => finish()}>
          {t.permissions.cancel}
        </button>
      </div>
    </aside>
  )
}
