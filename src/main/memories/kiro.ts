import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryItem } from '../../shared/types'
import { parseFrontMatter } from './frontmatter'

const KIRO_DIR = join(homedir(), '.kiro')
const DB_PATH = join(KIRO_DIR, 'memories', 'memories.db')
const STEERING_DIR = join(KIRO_DIR, 'steering')

interface KiroRow {
  id: string
  memory_type: string
  title: string
  summary: string
  content: string
  why: string | null
  how_to_apply: string | null
  session_id: string
  updated_at: string
}

// 只读打开 Kiro 记忆库。Kiro 运行时会写这个库，所以一律 readOnly
export function readKiroMemories(): MemoryItem[] {
  const items: MemoryItem[] = []
  if (existsSync(DB_PATH)) {
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    try {
      const rows = db
        .prepare(
          'SELECT id, memory_type, title, summary, content, why, how_to_apply, session_id, updated_at FROM memories'
        )
        .all() as unknown as KiroRow[]
      const scopeStmt = db.prepare('SELECT scope FROM memory_scopes WHERE memory_id = ?')
      for (const r of rows) {
        const scopes = (scopeStmt.all(r.id) as { scope: string }[]).map((s) => s.scope)
        items.push({
          id: `kiro:${r.id}`,
          agent: 'kiro',
          kind: 'kiro-memory',
          subtype: r.memory_type,
          scope: scopes.length > 0 ? scopes.join(', ') : 'Global',
          title: r.title,
          summary: r.summary,
          content: r.content,
          why: r.why ?? undefined,
          howToApply: r.how_to_apply ?? undefined,
          sessionId: r.session_id,
          filePath: DB_PATH,
          updatedAt: r.updated_at
        })
      }
    } finally {
      db.close()
    }
  }

  if (existsSync(STEERING_DIR)) {
    for (const name of readdirSync(STEERING_DIR)) {
      if (!name.endsWith('.md')) continue
      const p = join(STEERING_DIR, name)
      const text = readFileSync(p, 'utf8')
      const fm = parseFrontMatter(text)
      const inclusion = fm.fields['inclusion'] ?? 'always'
      items.push({
        id: `kiro:steering:${name}`,
        agent: 'kiro',
        kind: 'kiro-steering',
        scope: 'Global',
        title: name.replace(/\.md$/, ''),
        summary: `steering（${inclusion}）`,
        content: fm.body,
        filePath: p,
        updatedAt: statSync(p).mtime.toISOString()
      })
    }
  }
  return items
}
