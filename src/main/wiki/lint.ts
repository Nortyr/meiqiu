import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { LintIssue, LintReport, SessionInfo } from '../../shared/types'
import { getSessionContent } from '../sessions/content'
import { scanPages } from './vault'
import { getDb } from './store'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// 程序体检（不调模型）：断链、孤立页、deprecated 被引用、证据失效、来源有未摄入新内容
export function runLint(): LintReport {
  const pages = scanPages()
  const slugs = new Set(pages.map((p) => p.slug))
  const deprecated = new Set(pages.filter((p) => p.status === 'deprecated').map((p) => p.slug))
  const inbound = new Map<string, number>()
  const issues: LintIssue[] = []

  for (const p of pages) {
    // 这页引用的所有 slug：related + 正文 [[...]]
    const refs = new Set<string>([
      ...p.related,
      ...[...p.body.matchAll(/\[\[([A-Za-z0-9-]+)\]\]/g)].map((m) => m[1])
    ])
    refs.delete(p.slug)
    for (const r of refs) {
      if (!slugs.has(r)) {
        issues.push({ kind: 'broken-link', slug: p.slug, message: `引用了不存在的页面 [[${r}]]` })
      } else {
        inbound.set(r, (inbound.get(r) ?? 0) + 1)
        if (deprecated.has(r)) {
          issues.push({
            kind: 'deprecated-ref',
            slug: p.slug,
            message: `引用了已废弃的页面 [[${r}]]`
          })
        }
      }
    }

    // source 页的证据检查
    if (p.type === 'source' && p.sessionPath) {
      const filePart = p.sessionPath.split('#')[0]
      if (!existsSync(filePart)) {
        issues.push({ kind: 'evidence-gone', slug: p.slug, message: `会话文件不存在：${filePart}` })
      } else {
        const session = {
          agent: (p.agent ?? 'kiro') as SessionInfo['agent'],
          path: p.sessionPath,
          id: '',
          sessionId: '',
          updatedAt: ''
        }
        try {
          const content = getSessionContent(session, Number.MAX_SAFE_INTEGER)
          const total = content.messages.length
          // 游标落后 = 有未摄入的新内容
          if (p.ingestedThroughTurn !== undefined && total > p.ingestedThroughTurn) {
            issues.push({
              kind: 'stale-source',
              slug: p.slug,
              message: `会话新增到 ${total} 条消息，已摄入到 turn ${p.ingestedThroughTurn}，可增量摄入`
            })
          }
          // hash 对不上 = 来源内容变了（被续写或改动）
          if (p.fileHash) {
            const now = sha256(content.messages.map((m) => `${m.role}: ${m.text}`).join('\n'))
            if (!now.startsWith(p.fileHash)) {
              issues.push({
                kind: 'evidence-gone',
                slug: p.slug,
                message: '会话内容和摄入时不同（hash 变了）'
              })
            }
          }
        } catch {
          issues.push({ kind: 'evidence-gone', slug: p.slug, message: '会话解析失败' })
        }
      }
    }
  }

  // 孤立页：没有任何别的页链接过来
  for (const p of pages) {
    if (!inbound.has(p.slug)) {
      issues.push({ kind: 'orphan', slug: p.slug, message: '没有页面链接到它' })
    }
  }

  const report: LintReport = { id: 0, createdAt: new Date().toISOString(), issues }
  const d = getDb()
  d.prepare('INSERT INTO lint_reports (created_at, issues) VALUES (?, ?)').run(
    report.createdAt,
    JSON.stringify(issues)
  )
  report.id = Number((d.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id)
  return report
}

export function latestLint(): LintReport | null {
  const row = getDb()
    .prepare('SELECT id, created_at, issues FROM lint_reports ORDER BY id DESC LIMIT 1')
    .get() as { id: number; created_at: string; issues: string } | undefined
  if (!row) return null
  return { id: row.id, createdAt: row.created_at, issues: JSON.parse(row.issues) as LintIssue[] }
}
