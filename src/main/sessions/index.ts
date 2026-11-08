import type { SessionsResult, SessionInfo, AgentError, AgentId } from '../../shared/types'
import { listKiroSessions, listKiroCliSessions } from './kiro'
import { listClaudeSessions } from './claude'
import { listCodexSessions } from './codex'
import { listOpencodeSessions } from './opencode'

const LISTERS: [AgentId, () => SessionInfo[]][] = [
  ['kiro', () => [...listKiroSessions(), ...listKiroCliSessions()]],
  ['claude-code', listClaudeSessions],
  ['codex', listCodexSessions],
  ['opencode', listOpencodeSessions]
]

let cache: SessionsResult | null = null

// 一家读挂了不影响其他家。结果缓存：扫一遍要读几百个文件，外部有变更时由调用方刷新
export function listSessions(refresh = false): SessionsResult {
  if (cache && !refresh) return cache
  const items: SessionInfo[] = []
  const errors: AgentError[] = []
  for (const [agent, list] of LISTERS) {
    try {
      items.push(...list())
    } catch (e) {
      errors.push({ agent, error: e instanceof Error ? e.message : String(e) })
    }
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  cache = { items, errors }
  return cache
}

// 外部变了就清缓存，下次取时重扫
export function invalidateSessionsCache(): void {
  cache = null
}
