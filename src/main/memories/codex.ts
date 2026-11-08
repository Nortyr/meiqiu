import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryItem } from '../../shared/types'

const CODEX_DIR = join(homedir(), '.codex')
const DB_PATH = join(CODEX_DIR, 'memories_1.sqlite')
const MEM_DIR = join(CODEX_DIR, 'memories')
const AGENTS_MD = join(CODEX_DIR, 'AGENTS.md')

interface Stage1Row {
  thread_id: string
  raw_memory: string
  rollout_summary: string
  rollout_slug: string | null
  generated_at: number
}

// Codex 的 SQLite 一期只读
export function readCodexMemories(): MemoryItem[] {
  const items: MemoryItem[] = []

  if (existsSync(DB_PATH)) {
    const db = new DatabaseSync(DB_PATH, { readOnly: true })
    try {
      const rows = db
        .prepare(
          'SELECT thread_id, raw_memory, rollout_summary, rollout_slug, generated_at FROM stage1_outputs'
        )
        .all() as unknown as Stage1Row[]
      for (const r of rows) {
        items.push({
          id: `codex:${r.thread_id}`,
          agent: 'codex',
          kind: 'codex-memory',
          scope: 'Global',
          title: r.rollout_slug ?? r.thread_id,
          summary: r.rollout_summary,
          content: r.raw_memory,
          sessionId: r.thread_id,
          filePath: DB_PATH,
          updatedAt: new Date(r.generated_at * 1000).toISOString()
        })
      }
    } finally {
      db.close()
    }
  }

  if (existsSync(MEM_DIR)) {
    for (const name of readdirSync(MEM_DIR)) {
      if (!name.endsWith('.md')) continue
      const p = join(MEM_DIR, name)
      items.push({
        id: `codex:memories:${name}`,
        agent: 'codex',
        kind: 'codex-memory-md',
        scope: 'Global',
        title: name.replace(/\.md$/, ''),
        summary: '',
        content: readFileSync(p, 'utf8'),
        filePath: p,
        updatedAt: statSync(p).mtime.toISOString()
      })
    }
  }

  if (existsSync(AGENTS_MD)) {
    items.push({
      id: 'codex:agents-md',
      agent: 'codex',
      kind: 'codex-agents-md',
      scope: 'Global',
      title: 'AGENTS.md',
      summary: 'Codex 规则文件',
      content: readFileSync(AGENTS_MD, 'utf8'),
      filePath: AGENTS_MD,
      updatedAt: statSync(AGENTS_MD).mtime.toISOString()
    })
  }
  return items
}
