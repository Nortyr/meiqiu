import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionInfo } from '../../shared/types'
import { readFileHead } from './head'

// ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<时间戳>-<uuid>.jsonl
const SESSIONS_DIR = join(homedir(), '.codex', 'sessions')
const SESSION_ID_PATTERN =
  /-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/

// 项目路径在文件首行 session_meta.payload.cwd（memx 实测首行一定是 session_meta）
function readSessionMetaCwd(path: string): string | undefined {
  const head = readFileHead(path, 16 * 1024)
  if (!head) return undefined
  try {
    const firstLine = head.split('\n', 1)[0]
    const record = JSON.parse(firstLine) as { payload?: { cwd?: unknown } }
    const cwd = record.payload?.cwd
    return typeof cwd === 'string' && cwd ? cwd : undefined
  } catch {
    return undefined
  }
}

function findJsonlFiles(root: string): string[] {
  const results: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(p)
    }
  }
  walk(root)
  return results
}

export function listCodexSessions(): SessionInfo[] {
  const items: SessionInfo[] = []
  if (!existsSync(SESSIONS_DIR)) return items

  for (const path of findJsonlFiles(SESSIONS_DIR)) {
    const match = SESSION_ID_PATTERN.exec(path)
    if (!match) continue // 不符合命名规律的 .jsonl 不是会话文件
    items.push({
      id: `codex:${match[1]}`,
      agent: 'codex',
      sessionId: match[1],
      project: readSessionMetaCwd(path),
      updatedAt: statSync(path).mtime.toISOString(),
      path
    })
  }
  return items
}
