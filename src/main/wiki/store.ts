import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WikiPageMeta, WikiPageType, WikiSearchHit } from '../../shared/types'
import { scanPages } from './vault'

// ~/.meiqiu/meiqiu.db：知识库的派生物（FTS 索引、页面缓存、ingest runs、lint 报告）。
// 全部可从 markdown 文件重建；wiki 页面以文件为真相。
let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const dir = join(homedir(), '.meiqiu')
  mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(join(dir, 'meiqiu.db'))
  initSchema(db)
  return db
}

function initSchema(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS ingest_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      session_refs TEXT NOT NULL DEFAULT '[]',
      backup_path TEXT,
      report TEXT
    );
    CREATE TABLE IF NOT EXISTS wiki_pages (
      slug TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      evidence_level TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT,
      path TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
      slug UNINDEXED,
      title,
      summary,
      body,
      tokenize = 'trigram'
    );
    CREATE TABLE IF NOT EXISTS lint_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      issues TEXT NOT NULL DEFAULT '[]'
    );
  `)
}

interface WikiPageRow {
  slug: string
  type: string
  title: string
  summary: string
  status: string
  evidence_level: string | null
  tags: string
  updated_at: string | null
  path: string
}

function rowToMeta(r: WikiPageRow): WikiPageMeta {
  let tags: string[] = []
  try {
    tags = JSON.parse(r.tags) as string[]
  } catch {
    // tags 坏了按空数组
  }
  return {
    slug: r.slug,
    type: r.type as WikiPageType,
    title: r.title,
    summary: r.summary,
    status: r.status,
    evidenceLevel: r.evidence_level ?? undefined,
    tags,
    updatedAt: r.updated_at ?? undefined,
    path: r.path
  }
}

// 重扫 vault，重建 wiki_pages + wiki_fts。返回页面数
export function rebuildWikiIndex(): number {
  const pages = scanPages()
  const d = getDb()
  d.exec('BEGIN')
  try {
    d.exec('DELETE FROM wiki_pages')
    d.exec('DELETE FROM wiki_fts')
    const insertPage = d.prepare(
      'INSERT INTO wiki_pages (slug, type, title, summary, status, evidence_level, tags, updated_at, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const insertFts = d.prepare(
      'INSERT INTO wiki_fts (slug, title, summary, body) VALUES (?, ?, ?, ?)'
    )
    for (const p of pages) {
      insertPage.run(
        p.slug,
        p.type,
        p.title,
        p.summary,
        p.status,
        p.evidenceLevel ?? null,
        JSON.stringify(p.tags),
        p.updatedAt ?? null,
        p.path
      )
      insertFts.run(p.slug, p.title, p.summary, p.body)
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return pages.length
}

export function listWikiPages(): WikiPageMeta[] {
  const rows = getDb().prepare('SELECT * FROM wiki_pages').all() as unknown as WikiPageRow[]
  return rows.map(rowToMeta)
}

// 全文搜索：trigram 至少三个字符才能 MATCH；两字词、单字用 LIKE 兜底
export function searchWiki(query: string, limit = 50): WikiSearchHit[] {
  const q = query.trim()
  if (!q) return []
  const d = getDb()
  if (Array.from(q).length >= 3) {
    const matchQ = '"' + q.replace(/"/g, '""') + '"'
    const rows = d
      .prepare(
        `SELECT slug, title, snippet(wiki_fts, 3, '', '', '…', 12) AS snippet
         FROM wiki_fts WHERE wiki_fts MATCH ? ORDER BY bm25(wiki_fts) LIMIT ?`
      )
      .all(matchQ, limit) as unknown as { slug: string; title: string; snippet: string }[]
    return rows.map((r) => ({ ...r, type: typeOfSlug(r.slug), snippet: r.snippet || '' }))
  }
  const like = `%${q}%`
  const rows = d
    .prepare(
      `SELECT slug, title, substr(body, max(1, instr(body, ?) - 20), 60) AS snippet
       FROM wiki_fts WHERE title LIKE ? OR summary LIKE ? OR body LIKE ? LIMIT ?`
    )
    .all(q, like, like, like, limit) as unknown as {
    slug: string
    title: string
    snippet: string
  }[]
  return rows.map((r) => ({ ...r, type: typeOfSlug(r.slug), snippet: r.snippet || '' }))
}

function typeOfSlug(slug: string): WikiPageType {
  const row = getDb().prepare('SELECT type FROM wiki_pages WHERE slug = ?').get(slug) as
    { type: string } | undefined
  return (row?.type ?? 'concept') as WikiPageType
}

// 启动自检：FTS5 trigram 在这台机器的 Electron SQLite 里能不能搜中文三字词
let ftsOk: boolean | null = null
export function ftsSelfCheck(): boolean {
  if (ftsOk !== null) return ftsOk
  try {
    const d = new DatabaseSync(':memory:')
    d.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize = 'trigram')")
    d.prepare('INSERT INTO t (x) VALUES (?)').run('服务预热机制只在测试入口')
    const hit = d.prepare("SELECT COUNT(*) AS n FROM t WHERE t MATCH '预热机'").get() as {
      n: number
    }
    ftsOk = hit.n === 1
    d.close()
  } catch {
    ftsOk = false
  }
  return ftsOk
}
// ---- ingest runs（摄入操作记录：备份在哪、报告、状态）----

export interface IngestRunRow {
  id: string
  started_at: string
  completed_at: string | null
  status: string
  session_refs: string
  backup_path: string | null
  report: string | null
}

export function createRun(id: string, sessionRefs: unknown, backupPath: string): void {
  getDb()
    .prepare(
      "INSERT INTO ingest_runs (id, started_at, status, session_refs, backup_path) VALUES (?, ?, 'prepared', ?, ?)"
    )
    .run(id, new Date().toISOString(), JSON.stringify(sessionRefs), backupPath)
}

export function updateRun(id: string, status: string, report?: unknown): void {
  getDb()
    .prepare('UPDATE ingest_runs SET status = ?, completed_at = ?, report = ? WHERE id = ?')
    .run(status, new Date().toISOString(), report === undefined ? null : JSON.stringify(report), id)
}

export function getRun(id: string): IngestRunRow | null {
  const row = getDb().prepare('SELECT * FROM ingest_runs WHERE id = ?').get(id) as unknown as
    IngestRunRow | undefined
  return row ?? null
}

// 有没有更新的已完成 run（防止回滚旧 run 把新 run 的成果冲掉）
export function hasLaterAppliedRun(startedAt: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM ingest_runs WHERE started_at > ? AND status IN ('applied', 'issues')"
    )
    .get(startedAt) as { n: number }
  return row.n > 0
}
