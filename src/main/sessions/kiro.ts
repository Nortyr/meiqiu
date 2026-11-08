import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionInfo } from '../../shared/types'

// ~/.kiro/sessions/<workspaceHash>/sess_<uuid>/：session.json 元数据 + messages.jsonl 转录
// 这套目录 IDE 和 CLI 共用，IDE 的会话也落在这里（本机实测 workspaceStorage 缓存为空）
const SESSIONS_DIR = join(homedir(), '.kiro', 'sessions')
// kiro-cli 另外有一份 sqlite 存档
const CLI_DB = join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3')

interface SessionJson {
  title?: string
  workspacePaths?: string[]
  createdAt?: string
  lastModifiedAt?: string
}

export function listKiroSessions(): SessionInfo[] {
  const items: SessionInfo[] = []
  if (!existsSync(SESSIONS_DIR)) return items

  for (const wsEntry of readdirSync(SESSIONS_DIR, { withFileTypes: true })) {
    if (!wsEntry.isDirectory()) continue
    const workspaceDir = join(SESSIONS_DIR, wsEntry.name)
    for (const sessEntry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!sessEntry.isDirectory()) continue
      const sessionId = sessEntry.name
      const sessionDir = join(workspaceDir, sessionId)
      // 没有 messages.jsonl 的会话目录是空会话，跳过（本机 52 个目录里 10 个没有）
      const transcript = join(sessionDir, 'messages.jsonl')
      if (!existsSync(transcript)) continue

      let meta: SessionJson = {}
      try {
        meta = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'))
      } catch {
        // 元数据只是增强，没有就用目录名
      }
      items.push({
        id: `kiro:${sessionId}`,
        agent: 'kiro',
        sessionId,
        project: meta.workspacePaths?.[0],
        title: meta.title || undefined,
        updatedAt: meta.lastModifiedAt ?? statSync(transcript).mtime.toISOString(),
        path: transcript
      })
    }
  }
  return items
}

interface CliRow {
  key: string
  conversation_id: string
  updated_at: number
  messageCount: number | null
}

// kiro-cli 的会话存档。Kiro 会写这个库，只读打开；读挂了只当没有，不影响 IDE 会话
export function listKiroCliSessions(): SessionInfo[] {
  if (!existsSync(CLI_DB)) return []
  const db = new DatabaseSync(CLI_DB, { readOnly: true })
  try {
    const rows = db
      .prepare(
        `SELECT key, conversation_id, updated_at,
                json_array_length(json_extract(value, '$.history')) AS messageCount
         FROM conversations_v2`
      )
      .all() as unknown as CliRow[]
    return rows.map((r) => ({
      id: `kiro:cli:${r.conversation_id}`,
      agent: 'kiro' as const,
      sessionId: r.conversation_id,
      project: r.key,
      updatedAt: new Date(Number(r.updated_at)).toISOString(),
      path: `${CLI_DB}#${r.conversation_id}`,
      messageCount: r.messageCount ?? undefined
    }))
  } finally {
    db.close()
  }
}
