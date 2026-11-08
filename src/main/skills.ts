import { app } from 'electron'
import { cpSync, existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { SessionInfo, SkillProduct } from '../shared/types'
import { AGENT_LABELS } from '../shared/types'
import { parseFrontMatter } from './memories/frontmatter'
import { mainLocale } from './i18n'

const MEIQIU_SKILLS = join(homedir(), '.meiqiu', 'skills')
const CLAUDE_SKILLS = join(homedir(), '.claude', 'skills')

// app 自带的 skills：resources 一份，打包后 extraResources 平铺在 resourcesPath
const BUNDLED_SKILLS = ['skill-creator', 'wiki-ingest', 'wiki-lint']

function bundledSkillDir(name: string): string {
  if (app.isPackaged) return join(process.resourcesPath, name)
  return join(app.getAppPath(), 'resources', name)
}

// 首次启动把内置 skills 复制到 ~/.meiqiu/skills/，预填指令里引用这个路径
export function ensureBundledSkills(): void {
  for (const name of BUNDLED_SKILLS) {
    const src = bundledSkillDir(name)
    const dest = join(MEIQIU_SKILLS, name)
    if (existsSync(dest) || !existsSync(src)) continue
    mkdirSync(MEIQIU_SKILLS, { recursive: true })
    cpSync(src, dest, { recursive: true })
  }
}

export function skillCreatorPath(): string {
  return join(MEIQIU_SKILLS, 'skill-creator', 'SKILL.md')
}

// 「提取 skill」的预填指令：在主进程拼（skill-creator 的路径只有主进程知道），
// 界面拿到后放进输入框，用户改完自己发
export function buildExtractInstruction(session: SessionInfo): string {
  const label = AGENT_LABELS[session.agent]
  if (mainLocale() === 'en') {
    return (
      `Read the session file at ${session.path} (a past ${label} session), ` +
      `then follow the method in ${skillCreatorPath()} to distill the reusable workflow from this session into a skill, saved under ~/.claude/skills/. ` +
      `Before writing any files, tell me what you plan to distill and the skill name, and wait for my confirmation.`
    )
  }
  return (
    `请阅读会话文件 ${session.path}（这是 ${label} 的历史会话），` +
    `然后按照 ${skillCreatorPath()} 的方法，把这次会话里可复用的做事流程提炼成一个 skill，保存到 ~/.claude/skills/ 下。` +
    `提炼之前先告诉我你打算提炼什么、skill 叫什么名字，等我确认再写文件。`
  )
}

// 已提取到 ~/.claude/skills/ 的 skill 列表
export function listSkills(): SkillProduct[] {
  if (!existsSync(CLAUDE_SKILLS)) return []
  const items: SkillProduct[] = []
  for (const name of readdirSync(CLAUDE_SKILLS)) {
    const skillMd = join(CLAUDE_SKILLS, name, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const fm = parseFrontMatter(readFileSync(skillMd, 'utf8'))
    items.push({
      name: fm.fields['name'] ?? name,
      description: fm.fields['description'] ?? '',
      path: join(CLAUDE_SKILLS, name)
    })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}
