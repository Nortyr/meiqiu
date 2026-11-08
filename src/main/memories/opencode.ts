import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryItem } from '../../shared/types'

// opencode 没有独立记忆库，只有规则文件；一期先管全局的
const CANDIDATES = [
  join(homedir(), '.config', 'opencode', 'AGENTS.md'),
  join(homedir(), '.config', 'opencode', 'opencode.md')
]

export function readOpencodeMemories(): MemoryItem[] {
  const items: MemoryItem[] = []
  for (const p of CANDIDATES) {
    if (!existsSync(p)) continue
    items.push({
      id: `opencode:${p}`,
      agent: 'opencode',
      kind: 'opencode-rules',
      scope: 'Global',
      title: p.split('/').pop() ?? p,
      summary: 'opencode 规则文件',
      content: readFileSync(p, 'utf8'),
      filePath: p,
      updatedAt: statSync(p).mtime.toISOString()
    })
  }
  return items
}
