import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WikiPage, WikiPageType } from '../../shared/types'
import { parseFrontMatter } from '../memories/frontmatter'
import { getSettings } from '../settings'

// 四类页面 → vault 子目录
const TYPE_DIRS: Record<WikiPageType, string> = {
  source: 'sources',
  entity: 'entities',
  concept: 'concepts',
  analysis: 'analyses'
}
export const WIKI_TYPES = Object.keys(TYPE_DIRS) as WikiPageType[]

// vault 位置：settings.json 的 wikiVaultPath 可改，默认 ~/.meiqiu/vault
export function getVaultPath(): string {
  const configured = getSettings().wikiVaultPath?.trim()
  return configured || join(homedir(), '.meiqiu', 'vault')
}

export function getWikiRoot(): string {
  return join(getVaultPath(), 'wiki')
}

export function getPagePath(type: WikiPageType, slug: string): string {
  return join(getWikiRoot(), TYPE_DIRS[type], `${slug}.md`)
}

// 首次启动建 vault：目录树 + 规范 + index/log；已存在的文件一律不动（人可能改过规范）
export function ensureVault(): void {
  const vault = getVaultPath()
  const wiki = getWikiRoot()
  for (const dir of Object.values(TYPE_DIRS)) {
    mkdirSync(join(wiki, dir), { recursive: true })
  }
  writeIfMissing(join(vault, 'CLAUDE.md'), VAULT_CLAUDE_MD)
  writeIfMissing(join(wiki, 'index.md'), '# 知识库目录\n\n<!-- 由 Meiqiu 程序维护，勿手改 -->\n')
  writeIfMissing(join(wiki, 'log.md'), '# 知识库日志\n\n<!-- 由 Meiqiu 程序维护，勿手改 -->\n')
}

function writeIfMissing(path: string, content: string): void {
  if (!existsSync(path)) writeFileSync(path, content)
}

// frontmatter 里的数组约定写成一行方括号：tags: [a, b]，不引入 yaml 依赖
function parseArray(value: string | undefined): string[] {
  if (!value) return []
  const t = value.trim()
  const inner = t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// 扫描 vault 里的全部页面（markdown 文件是真相，别处要用元信息都去重建 SQLite 索引）
export function scanPages(): WikiPage[] {
  const pages: WikiPage[] = []
  for (const [type, dir] of Object.entries(TYPE_DIRS) as [WikiPageType, string][]) {
    const abs = join(getWikiRoot(), dir)
    if (!existsSync(abs)) continue
    for (const file of readdirSync(abs)) {
      if (!file.endsWith('.md')) continue
      const path = join(abs, file)
      try {
        const fm = parseFrontMatter(readFileSync(path, 'utf8'))
        const fallback = file.slice(0, -3)
        pages.push({
          slug: fm.fields['slug'] || fallback,
          type,
          title: fm.fields['title'] || fallback,
          summary: fm.fields['summary'] ?? '',
          status: fm.fields['status'] || 'active',
          evidenceLevel: fm.fields['evidence_level'] || undefined,
          tags: parseArray(fm.fields['tags']),
          related: parseArray(fm.fields['related']),
          updatedAt: fm.fields['updated_at'] || undefined,
          path,
          body: fm.body,
          // source 页专有
          sessionPath: fm.fields['session_path'] || undefined,
          ingestedThroughTurn: fm.fields['ingested_through_turn']
            ? Number(fm.fields['ingested_through_turn'])
            : undefined,
          agent: fm.fields['agent'] || undefined,
          fileHash: fm.fields['file_hash'] || undefined
        })
      } catch {
        // 单个文件坏了不拖垮列表
      }
    }
  }
  return pages
}

// 按 slug 读一页；slug 全库唯一
export function readPage(slug: string): WikiPage | null {
  return scanPages().find((p) => p.slug === slug) ?? null
}

// vault 根的规范文件：摄入时令 agent 先读。改动只发新版首次创建，已有文件不覆盖
const VAULT_CLAUDE_MD = `# Meiqiu 知识库规范

这个 vault 是一个个人 LLM Wiki：把 agent 会话里值得留下的知识提炼成互相链接的 markdown 页面，持续保持最新。

## 三层

1. 原始资料：各 agent 的会话文件（Kiro / Claude Code / Codex / opencode），在 vault 之外，永不改动，是事实来源。会话正文不复制进 vault。
2. wiki/：提炼后的页面，模型可重写，保持简洁、去重、互相链接。
3. 本文件：维护契约，摄入前必读。wiki/index.md 和 wiki/log.md 由 Meiqiu 程序维护，不要手改。

## 页面

四类页面，一类一个目录，一个主题一页，文件名是 kebab-case 的 slug：

- sources/：每个被摄入的会话一页。记元信息（agent、session_path、project）、摘要、ingested_through_turn（摄入游标，下次同一会话从下一个 turn 继续）、file_hash。是证据锚点，不复制正文。
- entities/：项目、人、工具、系统。
- concepts/：机制、概念、规则。
- analyses/：对比、调查结论、综述。

## 页面格式

frontmatter（字段名照抄，数组写在一行方括号里）：

\`\`\`
---
type: source | entity | concept | analysis
slug: kebab-case-稳定不变
title: 页面标题
status: active            # 过时标 deprecated，不删页
summary: 一行摘要
tags: [标签1, 标签2]
related: [其他页slug]
evidence_level: human     # 全页最高依据级：human 人说的 > code 有代码依据 > inferred 推测
created_at: ISO 时间
updated_at: ISO 时间
---
\`\`\`

source 页另加：agent、session_path、project、turn_count、ingested_through_turn、file_hash。

正文之后两节固定：

\`\`\`
## Evidence
- supports: kiro 会话 /path/to/session turns 1-42 · 依据: 人说的
- supersedes: [[被取代的旧页slug]]    # 新说法取代旧说法时
- contradicts: [[冲突页slug]]         # 说法冲突无法裁决时并存

## Related
- [[slug]]
\`\`\`

## 依据三级（从高到低）

1. 人说的（human）：用户自己说的，或用户明确确认过的 agent 说法。
2. 有代码依据（code）：指出了具体代码位置（类、方法、行号）。
3. 推测（inferred）：agent 没给依据的推断。推测级的句子正文里要标「（推测）」。

## 写作规则

- 写当前最佳综合，不写更新日记；新证据合并进已有页面，不建新页重复。
- 只收以后还用得上的；过程描述、寒暄、一次性操作不收。
- 同一件事已有条目，只在它的 Evidence 里加出处，不新写一条。
- 只改受影响的小节，不整页重写。
- 引用必须给到具体会话和 turn 范围；不得编造会话里没有的内容。
- 给新页补 related 交叉链接；一份资料通常要改动若干页。
`
