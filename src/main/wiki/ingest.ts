import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, relative } from 'node:path'
import { homedir } from 'node:os'
import type {
  IngestPrepareResult,
  IngestReport,
  SessionInfo,
  WikiPageType
} from '../../shared/types'
import { AGENT_LABELS, WIKI_TYPE_LABELS } from '../../shared/types'
import { getSessionContent } from '../sessions/content'
import { parseFrontMatter } from '../memories/frontmatter'
import { getVaultPath, getWikiRoot, scanPages } from './vault'
import {
  createRun,
  getRun,
  hasLaterAppliedRun,
  listWikiPages,
  rebuildWikiIndex,
  updateRun
} from './store'

interface SessionRef {
  agent: string
  path: string
  title?: string
  fromTurn: number
  toTurn: number
  turnCount: number
  hash: string
}

const MEIQIU_DIR = join(homedir(), '.meiqiu')
const SKILLS_DIR = join(MEIQIU_DIR, 'skills')

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// ---- prepare：冻结转写 + 备份 + 预填指令 ----

export function prepareIngest(session: SessionInfo): IngestPrepareResult {
  // 全量解析（不传渲染上限），转写文件给 agent 读，turn 号以解析后的消息序为准
  const content = getSessionContent(session, Number.MAX_SAFE_INTEGER)
  if (content.error) return { error: content.error }
  const messages = content.messages
  if (messages.length === 0) return { error: '这个会话没有可摄入的对话内容' }

  const transcriptAll = messages.map((m) => `${m.role}: ${m.text}`).join('\n')
  const hash = sha256(transcriptAll)
  const total = messages.length

  // 增量游标：已有 source 页就只读新 turn
  const source = scanPages().find((p) => p.type === 'source' && p.sessionPath === session.path)
  const cursor = source?.ingestedThroughTurn ?? 0
  const fromTurn = cursor + 1
  const toTurn = total
  if (fromTurn > toTurn) {
    return { error: `这个会话共 ${total} 条消息，此前已摄入到 turn ${cursor}，没有新内容` }
  }

  const runId = crypto.randomUUID()
  const runDir = join(MEIQIU_DIR, 'ingest', runId)
  mkdirSync(runDir, { recursive: true })

  // 冻结转写：只有本次范围内的 turn，编号就是证据引用里的 turn 号
  const lines = messages
    .slice(fromTurn - 1, toTurn)
    .map((m, i) => `### turn ${fromTurn + i}（${m.role === 'user' ? '用户' : '助手'}）\n${m.text}`)
  const transcriptPath = join(runDir, 'transcript.md')
  writeFileSync(
    transcriptPath,
    `# 会话转写（冻结）\n- agent：${AGENT_LABELS[session.agent]}\n- 原会话：${session.path}\n` +
      `- turns：${fromTurn}-${toTurn} / 共 ${total}\n\n---\n\n${lines.join('\n\n')}\n`
  )

  // 摄入前备份 vault（markdown 很小，整目录拷贝）
  const backupDir = join(MEIQIU_DIR, 'backups', runId)
  mkdirSync(backupDir, { recursive: true })
  const wikiRoot = getWikiRoot()
  if (existsSync(wikiRoot)) cpSync(wikiRoot, join(backupDir, 'wiki'), { recursive: true })
  pruneBackups(20)

  const ref: SessionRef = {
    agent: session.agent,
    path: session.path,
    title: session.title,
    fromTurn,
    toTurn,
    turnCount: total,
    hash
  }
  createRun(runId, [ref], backupDir)

  const vault = getVaultPath()
  const incremental = cursor > 0
  const instruction =
    `请把一段会话的知识摄入知识库。先读 ${join(SKILLS_DIR, 'wiki-ingest', 'SKILL.md')} 和 ${join(vault, 'CLAUDE.md')}，严格按它们执行。\n\n` +
    `素材：\n` +
    `- 转写文件（读内容以此为准，turns 已编号）：${transcriptPath}\n` +
    `- 原会话（Evidence 引用用它）：${AGENT_LABELS[session.agent]} 会话 ${session.path}\n` +
    `- 处理范围：turns ${fromTurn}-${toTurn}（会话共 ${total} 条消息${incremental ? `，增量：此前已摄入到 turn ${cursor}` : ''}）\n\n` +
    `source 页要求：\n` +
    (incremental && source
      ? `- 更新已有 source 页 ${source.path}\n`
      : `- 在 sources/ 下新建这个会话的 source 页\n`) +
    `- frontmatter 写：agent: ${session.agent}，session_path: ${session.path}，turn_count: ${total}，` +
    `ingested_through_turn: ${toTurn}，file_hash: ${hash.slice(0, 12)}` +
    (session.project ? `，project: ${session.project}` : '') +
    `\n\n写完按 SKILL.md 的自检清单过一遍，然后告诉我新建/更新了哪些页。`

  return {
    runId,
    instruction,
    fromTurn,
    toTurn,
    turnCount: total,
    estimatedTokens: Math.ceil(readFileSync(transcriptPath, 'utf8').length / 4),
    incremental
  }
}

// 只留最近 keep 份备份（按目录修改时间，新的在前）
function pruneBackups(keep: number): void {
  const dir = join(MEIQIU_DIR, 'backups')
  if (!existsSync(dir)) return
  const entries = readdirSync(dir)
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const old of entries.slice(keep)) {
    rmSync(join(dir, old.name), { recursive: true, force: true })
  }
}

// ---- finish：agent 写完后的校验、重建 index/log、出报告 ----

export function finishIngest(runId: string): IngestReport {
  const run = getRun(runId)
  if (!run)
    return {
      runId,
      status: 'failed',
      created: [],
      updated: [],
      warnings: [],
      errors: ['run 不存在']
    }
  const refs = JSON.parse(run.session_refs) as SessionRef[]
  const backupWiki = join(run.backup_path ?? '', 'wiki')
  const wikiRoot = getWikiRoot()

  // 1. diff：备份 vs 现在的 vault
  const before = existsSync(backupWiki) ? hashVaultFiles(backupWiki) : new Map<string, string>()
  const after = hashVaultFiles(wikiRoot)
  const created: string[] = []
  const updated: string[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const changedFiles: string[] = []
  for (const [rel, h] of after) {
    if (rel === 'index.md' || rel === 'log.md') continue // 程序维护的文件不算 agent 改动
    const prev = before.get(rel)
    if (prev === undefined) {
      created.push(slugOf(rel))
      changedFiles.push(rel)
    } else if (prev !== h) {
      updated.push(slugOf(rel))
      changedFiles.push(rel)
    }
  }
  for (const rel of before.keys()) {
    if (rel === 'index.md' || rel === 'log.md') continue
    if (!after.has(rel)) errors.push(`页面被删：${rel} —— 过时应标 deprecated，不能删页`)
  }

  // 2. 逐页校验（程序检查，不调模型）
  const pagesNow = scanPages()
  for (const rel of changedFiles) {
    const abs = join(wikiRoot, rel)
    let text: string
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      warnings.push(`读不到改动页：${rel}`)
      continue
    }
    const fm = parseFrontMatter(text)
    for (const field of ['type', 'slug', 'title', 'summary']) {
      if (!fm.fields[field]) warnings.push(`${rel}：frontmatter 缺 ${field}`)
    }
    const slug = fm.fields['slug'] ?? ''
    if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      warnings.push(`${rel}：slug「${slug}」不是 kebab-case`)
    }
    if (!fm.body.includes('## Evidence')) warnings.push(`${rel}：缺 ## Evidence 节`)
    if (fm.fields['status'] === 'deprecated' && created.includes(slugOf(rel))) {
      warnings.push(`${rel}：新建的页就是 deprecated`)
    }
  }

  for (const ref of refs) {
    // 本次会话必须被引用
    const cited = changedFiles.some((rel) =>
      readFileSync(join(wikiRoot, rel), 'utf8').includes(ref.path)
    )
    if (!cited && changedFiles.length > 0) {
      warnings.push(`没有页面引用本次会话 ${ref.path}`)
    }
    // source 页必须存在且游标到位
    const sp = pagesNow.find((p) => p.type === 'source' && p.sessionPath === ref.path)
    if (!sp) {
      warnings.push(`source 页未建：${ref.path}`)
    } else if ((sp.ingestedThroughTurn ?? 0) !== ref.toTurn) {
      warnings.push(
        `source 页 ${sp.slug} 的 ingested_through_turn 是 ${sp.ingestedThroughTurn ?? 0}，应为 ${ref.toTurn}`
      )
    }
    // 来源 hash：变了说明会话被续写/改动，标出不阻塞
    const now = getSessionContent(
      {
        agent: ref.agent as SessionInfo['agent'],
        path: ref.path,
        id: '',
        sessionId: '',
        updatedAt: ''
      },
      Number.MAX_SAFE_INTEGER
    )
    const nowHash = sha256(now.messages.map((m) => `${m.role}: ${m.text}`).join('\n'))
    if (nowHash !== ref.hash) warnings.push(`来源已变化：${ref.path} 的当前 hash 和摄入时不同`)
  }

  // 3. 重建（先 db 索引，再 index.md / log.md）
  rebuildWikiIndex()
  rebuildIndexFile()
  appendLog(runId, refs, created, updated, warnings)

  const status = errors.length > 0 ? 'issues' : 'applied'
  const report: IngestReport = {
    runId,
    status,
    created,
    updated,
    warnings,
    errors,
    backupPath: run.backup_path ?? undefined
  }
  updateRun(runId, status, report)
  return report
}

// ---- rollback：用摄入前的备份整个换回来 ----

export function rollbackIngest(runId: string): IngestReport {
  const run = getRun(runId)
  if (!run?.backup_path) {
    return {
      runId,
      status: 'failed',
      created: [],
      updated: [],
      warnings: [],
      errors: ['没有备份可回滚']
    }
  }
  if (hasLaterAppliedRun(run.started_at)) {
    return {
      runId,
      status: 'failed',
      created: [],
      updated: [],
      warnings: [],
      errors: ['之后又有新的摄入完成，回滚会把新成果冲掉；要回滚请先处理更新的 run']
    }
  }
  const backupWiki = join(run.backup_path, 'wiki')
  if (!existsSync(backupWiki)) {
    return {
      runId,
      status: 'failed',
      created: [],
      updated: [],
      warnings: [],
      errors: ['备份目录不存在']
    }
  }
  const wikiRoot = getWikiRoot()
  rmSync(wikiRoot, { recursive: true, force: true })
  cpSync(backupWiki, wikiRoot, { recursive: true })
  rebuildWikiIndex()
  const report: IngestReport = {
    runId,
    status: 'rolled-back',
    created: [],
    updated: [],
    warnings: [],
    errors: [],
    backupPath: run.backup_path
  }
  updateRun(runId, 'rolled-back', report)
  return report
}

// ---- 工具 ----

// vault 里全部 markdown 的相对路径 → 内容 hash（diff 用）
function hashVaultFiles(root: string): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (name.endsWith('.md')) {
        map.set(relative(root, abs), sha256(readFileSync(abs, 'utf8')))
      }
    }
  }
  walk(root)
  return map
}

function slugOf(rel: string): string {
  return basename(rel, '.md')
}

// index.md 由程序维护：按四类分组，每页一行摘要
function rebuildIndexFile(): void {
  const pages = listWikiPages()
  const order: WikiPageType[] = ['source', 'entity', 'concept', 'analysis']
  const lines = ['# 知识库目录', '', '<!-- 由 Meiqiu 程序维护，勿手改 -->', '']
  for (const type of order) {
    const group = pages.filter((p) => p.type === type)
    lines.push(`## ${WIKI_TYPE_LABELS[type]}（${group.length}）`, '')
    for (const p of group) {
      const dep = p.status === 'deprecated' ? '（已废弃）' : ''
      lines.push(`- [[${p.slug}]] ${p.summary}${dep}`)
    }
    lines.push('')
  }
  writeFileSync(join(getWikiRoot(), 'index.md'), lines.join('\n'))
}

// log.md 由程序维护：每次摄入追加一段
function appendLog(
  runId: string,
  refs: SessionRef[],
  created: string[],
  updated: string[],
  warnings: string[]
): void {
  const lines = [
    `## [${new Date().toISOString()}] ingest | ${runId}`,
    ...refs.map(
      (r) =>
        `- 会话：${AGENT_LABELS[r.agent as SessionInfo['agent']] ?? r.agent} ${r.path}（turns ${r.fromTurn}-${r.toTurn}）`
    ),
    `- 新建：${created.length ? created.map((s) => `[[${s}]]`).join('、') : '无'}`,
    `- 更新：${updated.length ? updated.map((s) => `[[${s}]]`).join('、') : '无'}`,
    ...(warnings.length ? [`- 警告：${warnings.join('；')}`] : []),
    ''
  ]
  appendFileSync(join(getWikiRoot(), 'log.md'), lines.join('\n'))
}
