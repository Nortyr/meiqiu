import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import type { MemoriesResult, MemoryItem, AgentError, AgentId } from '../../shared/types'
import { invalidateSessionsCache } from '../sessions'
import { watchAndNotify } from '../watch'
import { readKiroMemories } from './kiro'
import { readClaudeMemories } from './claude'
import { readCodexMemories } from './codex'
import { readOpencodeMemories } from './opencode'

const READERS: [AgentId, () => MemoryItem[]][] = [
  ['kiro', readKiroMemories],
  ['claude-code', readClaudeMemories],
  ['codex', readCodexMemories],
  ['opencode', readOpencodeMemories]
]

// 一家读挂了不影响其他家
export function listMemories(): MemoriesResult {
  const items: MemoryItem[] = []
  const errors: AgentError[] = []
  for (const [agent, read] of READERS) {
    try {
      items.push(...read())
    } catch (e) {
      errors.push({ agent, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { items, errors }
}

// 监听各 agent 的记忆和会话目录。记忆和会话分开限频通知：
// agent 跑起来会话文件一直在写，每写一次就触发重扫会卡界面，
// 所以同一频道 5 秒内最多通知一次
const MEMORY_DIRS = [
  join(homedir(), '.kiro', 'memories'),
  join(homedir(), '.kiro', 'steering'),
  join(homedir(), '.codex'),
  join(homedir(), '.config', 'opencode')
]

const SESSION_DIRS = [
  join(homedir(), '.kiro', 'sessions'),
  join(homedir(), '.claude', 'projects'),
  join(homedir(), '.codex', 'sessions'),
  join(homedir(), '.local', 'share', 'opencode'),
  join(homedir(), 'Library', 'Application Support', 'kiro-cli')
]

export function watchMemories(sender: WebContents): () => void {
  const unwatchMemories = watchAndNotify(sender, MEMORY_DIRS, 'memories:changed', {
    debounceMs: 500,
    minIntervalMs: 5000
  })
  const unwatchSessions = watchAndNotify(sender, SESSION_DIRS, 'sessions:changed', {
    debounceMs: 2000,
    minIntervalMs: 5000,
    beforeSend: invalidateSessionsCache
  })
  return () => {
    unwatchMemories()
    unwatchSessions()
  }
}
