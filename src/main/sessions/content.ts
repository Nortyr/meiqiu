import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync } from 'node:fs'
import type { ChatMessage, SessionContentResult, SessionInfo } from '../../shared/types'

// 最多返回这么多条，超出截断（一个会话可能有上万行；渲染几百条长文本会卡）。
// 摄入管线要全量，调 getSessionContent 时传大 maxMessages
const MAX_MESSAGES = 200

function ok(messages: ChatMessage[], maxMessages: number): SessionContentResult {
  return {
    messages: messages.slice(0, maxMessages),
    truncated: messages.length > maxMessages,
    total: messages.length
  }
}

function fail(error: string): SessionContentResult {
  return { messages: [], truncated: false, error }
}

export function getSessionContent(
  session: SessionInfo,
  maxMessages = MAX_MESSAGES
): SessionContentResult {
  try {
    switch (session.agent) {
      case 'kiro':
        return session.path.endsWith('.jsonl')
          ? kiroContent(session.path, maxMessages)
          : kiroCliContent(session, maxMessages)
      case 'claude-code':
        return claudeContent(session.path, maxMessages)
      case 'codex':
        return codexContent(session.path, maxMessages)
      case 'opencode':
        return opencodeContent(session, maxMessages)
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

// 逐行解析 jsonl：extract 把一条记录变成对话消息，返回 null 的行跳过；
// 单行解析失败不挡其他行。各家的 jsonl 只是 extract 规则不同
function parseJsonl(
  path: string,
  extract: (record: Record<string, unknown>) => ChatMessage | null
): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const msg = extract(JSON.parse(line) as Record<string, unknown>)
      if (msg) messages.push(msg)
    } catch {
      continue
    }
  }
  return messages
}

// ~/.kiro/sessions 的 messages.jsonl：payload.type 为 user/assistant 的是对话正文
function kiroContent(path: string, maxMessages: number): SessionContentResult {
  const messages = parseJsonl(path, (r) => {
    const p = (r as { payload?: { type?: string; content?: unknown } }).payload
    if ((p?.type !== 'user' && p?.type !== 'assistant') || typeof p.content !== 'string') {
      return null
    }
    const text = p.content.trim()
    // 流式输出的中间态也会落盘：空内容和占位符跳过
    if (!text || text === '...' || text === '…') return null
    return { role: p.type, text, timestamp: r.timestamp as string | undefined }
  })
  return ok(messages, maxMessages)
}

interface CliConversationRow {
  value: string
}

// kiro-cli 的 sqlite 存档：value 是整段会话 JSON，history 是 [{user, assistant}]
function kiroCliContent(session: SessionInfo, maxMessages: number): SessionContentResult {
  const [dbPath, conversationId] = session.path.split('#')
  if (!existsSync(dbPath)) return fail('库文件不存在')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db
      .prepare('SELECT value FROM conversations_v2 WHERE conversation_id = ?')
      .get(conversationId) as unknown as CliConversationRow | undefined
    if (!row) return fail('会话不存在')
    const parsed = JSON.parse(row.value) as { history?: unknown[] }
    const messages: ChatMessage[] = []
    for (const h of parsed.history ?? []) {
      const entry = h as { user?: unknown; assistant?: unknown }
      const u = extractCliText(entry.user)
      const a = extractCliText(entry.assistant)
      if (u) messages.push({ role: 'user', text: u })
      if (a) messages.push({ role: 'assistant', text: a })
    }
    if (messages.length === 0) return fail('这种存档格式暂时解析不出对话')
    return ok(messages, maxMessages)
  } finally {
    db.close()
  }
}

// history 条目的正文在不同版本里结构不一样，尽量兜底
function extractCliText(side: unknown): string | undefined {
  if (typeof side !== 'object' || side === null) return undefined
  const obj = side as Record<string, unknown>
  for (const key of ['content', 'message', 'text', 'prompt']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'object' && v !== null) {
      const inner =
        (v as Record<string, unknown>)['text'] ?? (v as Record<string, unknown>)['content']
      if (typeof inner === 'string' && inner.trim()) return inner
    }
  }
  return undefined
}

// Claude Code 的 jsonl：type 为 user/assistant，message.content 是字符串或 text block 数组
function claudeContent(path: string, maxMessages: number): SessionContentResult {
  const messages = parseJsonl(path, (rec) => {
    const r = rec as {
      type?: string
      isMeta?: boolean
      timestamp?: string
      message?: { content?: unknown }
    }
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta) return null
    const text = extractClaudeText(r.message?.content)
    return text ? { role: r.type, text, timestamp: r.timestamp } : null
  })
  return ok(messages, maxMessages)
}

function extractClaudeText(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      const b = block as { type?: string; text?: unknown }
      if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
    return parts.join('\n\n').trim() || undefined
  }
  return undefined
}

// Codex 的 jsonl：type=response_item 且 payload.type=message，content 是 input_text/output_text 块
function codexContent(path: string, maxMessages: number): SessionContentResult {
  const messages = parseJsonl(path, (rec) => {
    const r = rec as {
      type?: string
      timestamp?: string
      payload?: { type?: string; role?: string; content?: unknown }
    }
    const p = r.payload
    if (r.type !== 'response_item' || p?.type !== 'message') return null
    const role = p.role === 'user' ? 'user' : p.role === 'assistant' ? 'assistant' : null
    if (!role || !Array.isArray(p.content)) return null
    const parts: string[] = []
    for (const block of p.content) {
      const b = block as { type?: string; text?: unknown }
      if ((b?.type === 'input_text' || b?.type === 'output_text') && typeof b.text === 'string') {
        parts.push(b.text)
      }
    }
    const text = parts.join('\n\n').trim()
    return text ? { role, text, timestamp: r.timestamp } : null
  })
  return ok(messages, maxMessages)
}

interface OpencodeMessageRow {
  id: string
  data: string
}

interface OpencodePartRow {
  data: string
}

// opencode：message 表存角色，part 表存正文（跳过 synthetic 的工具回显）
function opencodeContent(session: SessionInfo, maxMessages: number): SessionContentResult {
  const [dbPath, sessionId] = session.path.split('#')
  if (!existsSync(dbPath)) return fail('库文件不存在')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const msgs = db
      .prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created')
      .all(sessionId) as unknown as OpencodeMessageRow[]
    const partStmt = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY time_created')
    const messages: ChatMessage[] = []
    for (const m of msgs) {
      let role: 'user' | 'assistant' | null = null
      try {
        const d = JSON.parse(m.data) as { role?: string }
        role = d.role === 'user' ? 'user' : d.role === 'assistant' ? 'assistant' : null
      } catch {
        continue
      }
      if (!role) continue
      const parts: string[] = []
      for (const p of partStmt.all(m.id) as unknown as OpencodePartRow[]) {
        try {
          const d = JSON.parse(p.data) as { synthetic?: boolean; ignored?: boolean; text?: unknown }
          if (d.synthetic || d.ignored) continue
          if (typeof d.text === 'string') parts.push(d.text)
        } catch {
          continue
        }
      }
      const text = parts.join('\n\n').trim()
      if (text) messages.push({ role, text })
    }
    return ok(messages, maxMessages)
  } finally {
    db.close()
  }
}
