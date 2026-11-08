import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionInfo } from '../../shared/types'
import { readFileHead } from './head'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
// 项目路径从前 64KB 里找第一条带 cwd 的记录（照 memx 的 readLeadingCwd）
const SCAN_BUDGET = 64 * 1024

// 目录名是 cwd 把 '/' 换成 '-'，换回来只是兜底：真实目录名里的 '-' 会被误换成 '/'
function decodeProjectDirName(name: string): string {
  const s = name.startsWith('-') ? name.slice(1) : name
  return '/' + s.split('-').join('/')
}

interface LeadingMeta {
  cwd?: string
  title?: string
}

function readLeadingMeta(path: string): LeadingMeta {
  const text = readFileHead(path, SCAN_BUDGET)
  if (!text) return {}
  const lines = text.split('\n')
  const meta: LeadingMeta = {}
  // 最后一行可能被截断，跳过
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const record = JSON.parse(line) as { cwd?: unknown; type?: string; title?: unknown }
      if (!meta.cwd && typeof record.cwd === 'string' && record.cwd) meta.cwd = record.cwd
      if (!meta.title && record.type === 'ai-title' && typeof record.title === 'string') {
        meta.title = record.title
      }
      if (meta.cwd && meta.title) break
    } catch {
      continue
    }
  }
  return meta
}

export function listClaudeSessions(): SessionInfo[] {
  const items: SessionInfo[] = []
  if (!existsSync(PROJECTS_DIR)) return items

  for (const projEntry of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!projEntry.isDirectory()) continue // 跳过 .DS_Store 之类
    const projDir = projEntry.name
    const dir = join(PROJECTS_DIR, projDir)
    for (const fileEntry of readdirSync(dir, { withFileTypes: true })) {
      // 只取顶层 .jsonl；subagents/ 子目录是子 agent 转录，不算独立会话
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.jsonl')) continue
      const name = fileEntry.name
      const path = join(dir, name)
      const sessionId = name.replace(/\.jsonl$/, '')
      const meta = readLeadingMeta(path)
      items.push({
        id: `claude-code:${sessionId}`,
        agent: 'claude-code',
        sessionId,
        project: meta.cwd ?? decodeProjectDirName(projDir),
        title: meta.title,
        updatedAt: statSync(path).mtime.toISOString(),
        path
      })
    }
  }
  return items
}
