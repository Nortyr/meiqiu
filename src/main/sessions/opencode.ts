import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionInfo } from '../../shared/types'

// opencode 全部会话在一个 sqlite 库里，三平台都是这个路径（不走 XDG_DATA_HOME）
const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface SessionRow {
  id: string
  title: string | null
  directory: string | null
  timeUpdated: number
  messageCount: number
}

export function listOpencodeSessions(): SessionInfo[] {
  if (!existsSync(DB_PATH)) return []
  const db = new DatabaseSync(DB_PATH, { readOnly: true })
  try {
    // parent_id IS NULL 排除子 agent 会话（标题带 "(@explore subagent)" 的那些）
    const rows = db
      .prepare(
        `SELECT s.id AS id, s.title AS title, s.directory AS directory,
                s.time_updated AS timeUpdated,
                (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS messageCount
         FROM session s
         WHERE s.parent_id IS NULL`
      )
      .all() as unknown as SessionRow[]
    return rows.map((r) => ({
      id: `opencode:${r.id}`,
      agent: 'opencode' as const,
      sessionId: r.id,
      project: r.directory ?? undefined,
      title: r.title?.trim() || undefined,
      updatedAt: new Date(Number(r.timeUpdated)).toISOString(),
      path: `${DB_PATH}#${r.id}`,
      messageCount: Number(r.messageCount)
    }))
  } finally {
    db.close()
  }
}
