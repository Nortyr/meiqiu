// 极简 front matter 解析：只处理顶层的 key: value 和一层缩进的嵌套（如 metadata:）
// 够解析 Kiro steering 和 Claude Code 记忆文件的头部，不引入 yaml 依赖

export interface FrontMatter {
  fields: Record<string, string>
  nested: Record<string, Record<string, string>>
  body: string
}

export function parseFrontMatter(text: string): FrontMatter {
  const result: FrontMatter = { fields: {}, nested: {}, body: text }
  if (!text.startsWith('---')) return result

  const end = text.indexOf('\n---', 3)
  if (end === -1) return result

  const block = text.slice(3, end).trim()
  result.body = text.slice(end + 4).replace(/^\r?\n/, '')

  let currentNest: string | null = null
  for (const line of block.split(/\r?\n/)) {
    const nestedMatch = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*(.*)$/)
    if (currentNest && nestedMatch) {
      result.nested[currentNest][nestedMatch[1]] = unquote(nestedMatch[2])
      continue
    }
    const topMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (topMatch) {
      const [, key, value] = topMatch
      if (value === '') {
        currentNest = key
        result.nested[key] = {}
      } else {
        currentNest = null
        result.fields[key] = unquote(value)
      }
    }
  }
  return result
}

function unquote(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}
