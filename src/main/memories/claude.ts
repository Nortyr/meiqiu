import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryItem } from '../../shared/types'
import { parseFrontMatter } from './frontmatter'

const CLAUDE_DIR = join(homedir(), '.claude')
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects')

// Claude Code 项目目录名是把绝对路径的 '/' 换成 '-'，这里换回来做展示
function projectName(dirName: string): string {
  return dirName.replace(/^-/, '/').replace(/-/g, '/')
}

export function readClaudeMemories(): MemoryItem[] {
  const items: MemoryItem[] = []

  // 全局 CLAUDE.md
  const globalMd = join(CLAUDE_DIR, 'CLAUDE.md')
  if (existsSync(globalMd)) {
    items.push(claudeMdItem(globalMd, 'Global', 'claude-md-global'))
  }

  if (!existsSync(PROJECTS_DIR)) return items

  for (const proj of readdirSync(PROJECTS_DIR)) {
    const projDir = join(PROJECTS_DIR, proj)
    const scope = projectName(proj)

    // 项目记忆：memory/ 下每条一个 .md，MEMORY.md 是索引不单独算
    const memDir = join(projDir, 'memory')
    if (existsSync(memDir)) {
      for (const name of readdirSync(memDir)) {
        if (!name.endsWith('.md') || name === 'MEMORY.md') continue
        const p = join(memDir, name)
        const text = readFileSync(p, 'utf8')
        const fm = parseFrontMatter(text)
        items.push({
          id: `claude-code:${proj}/${name}`,
          agent: 'claude-code',
          kind: 'claude-memory',
          scope,
          title: fm.fields['name'] ?? name.replace(/\.md$/, ''),
          summary: fm.fields['description'] ?? '',
          content: fm.body,
          sessionId: fm.nested['metadata']?.['originSessionId'],
          filePath: p,
          updatedAt: fm.nested['metadata']?.['modified'] ?? statSync(p).mtime.toISOString()
        })
      }
    }

    // 项目里的 CLAUDE.md（项目路径是目录名解码出来的，文件不一定存在）
    const projMd = join(scope, 'CLAUDE.md')
    if (existsSync(projMd)) {
      items.push(claudeMdItem(projMd, scope, 'claude-md-project'))
    }
  }
  return items
}

function claudeMdItem(path: string, scope: string, kind: string): MemoryItem {
  return {
    id: `claude-code:${kind}:${path}`,
    agent: 'claude-code',
    kind,
    scope,
    title: kind === 'claude-md-global' ? 'CLAUDE.md（全局）' : 'CLAUDE.md（项目）',
    summary: 'Claude Code 规则文件',
    content: readFileSync(path, 'utf8'),
    filePath: path,
    updatedAt: statSync(path).mtime.toISOString()
  }
}
