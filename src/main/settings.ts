import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { Locale, SettingsResult } from '../shared/types'

// 用户设置持久化在 ~/.meiqiu/settings.json
const SETTINGS_PATH = join(homedir(), '.meiqiu', 'settings.json')

export interface AcpConfig {
  acpProvider?: 'claude-code' | 'opencode'
  acpEnabledClaudeCode?: boolean // Claude Code 的开关，各家独立
  acpEnabledOpencode?: boolean // OpenCode 的开关，各家独立
  acpHarnessPath?: string // Claude CLI 路径
  acpOpencodePath?: string // OpenCode CLI 路径
  acpModel?: string
  acpOpencodeModel?: string // OpenCode 的模型，连上后走 ACP 下发
  acpEnabled?: boolean // 旧版全局开关，读取时迁移掉
  wikiVaultPath?: string // 知识库 vault 位置，空 = ~/.meiqiu/vault
  locale?: Locale | '' // 界面语言，空/缺省 = 跟随系统
}

export function harnessPathOf(s: AcpConfig): string {
  return (s.acpProvider === 'opencode' ? s.acpOpencodePath : s.acpHarnessPath) ?? ''
}

function readFile(): AcpConfig {
  let s: AcpConfig
  try {
    s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return {}
  }
  // 旧版只有一个全局 acpEnabled：迁移成当时选中那家的开关
  if (s.acpEnabled !== undefined) {
    const key = s.acpProvider === 'opencode' ? 'acpEnabledOpencode' : 'acpEnabledClaudeCode'
    if (s[key] === undefined) s[key] = s.acpEnabled
    delete s.acpEnabled
  }
  return s
}

export function getSettings(): AcpConfig {
  return readFile()
}

function enabledOf(s: AcpConfig, provider: 'claude-code' | 'opencode'): boolean {
  return provider === 'opencode' ? s.acpEnabledOpencode === true : s.acpEnabledClaudeCode === true
}

// 当前选中的那家是否启用（决定连不连、输入条出不出现）
export function isAcpEnabled(): boolean {
  const s = readFile()
  return enabledOf(s, s.acpProvider ?? 'claude-code')
}

export function saveSettings(patch: AcpConfig): void {
  const s = readFile()
  // patch 里的 acpEnabled 指「当时选中的那家」，落到那家的独立开关上
  const { acpEnabled, ...rest } = patch
  const next: AcpConfig = { ...s, ...rest }
  delete next.acpEnabled
  if (acpEnabled !== undefined) {
    const provider = rest.acpProvider ?? s.acpProvider ?? 'claude-code'
    if (provider === 'opencode') next.acpEnabledOpencode = acpEnabled
    else next.acpEnabledClaudeCode = acpEnabled
  }
  mkdirSync(join(homedir(), '.meiqiu'), { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2))
}

// PATH 里找不到时的常见安装位置
const HARNESS_CANDIDATES: Record<'claude' | 'opencode', string[]> = {
  claude: [],
  opencode: [
    join(homedir(), '.opencode/bin/opencode'), // 官方安装脚本
    '/Applications/OpenCode.app/Contents/Resources/opencode-cli' // 桌面版自带
  ]
}

// 自动检测 CLI 的位置：先 PATH，再常见安装位置
export function detectHarnessPath(bin: 'claude' | 'opencode'): string {
  try {
    const found = execSync(`which ${bin}`, { encoding: 'utf8' }).trim()
    if (found) return found
  } catch {
    // PATH 里没有，继续找候选位置
  }
  for (const p of HARNESS_CANDIDATES[bin]) {
    if (existsSync(p)) return p
  }
  return ''
}

// spawn adapter 时要带上的环境变量（只放用户填了的）
export function acpEnv(): Record<string, string> {
  const s = readFile()
  const env: Record<string, string> = {}
  // 用户配了 CLI 的位置就把它所在目录放到 PATH 最前
  const hp = harnessPathOf(s).trim()
  if (hp) env.PATH = `${dirname(hp)}:${process.env.PATH ?? ''}`
  // 模型只对 Claude Code 生效；opencode 的模型在它自己的配置里管
  if (s.acpModel?.trim() && s.acpProvider !== 'opencode') {
    env.ANTHROPIC_MODEL = s.acpModel.trim()
  }
  return env
}

export function acpProvider(): 'claude-code' | 'opencode' {
  return readFile().acpProvider ?? 'claude-code'
}

export function toResult(connected: boolean): SettingsResult {
  const s = readFile()
  const provider = s.acpProvider ?? 'claude-code'
  return {
    acpEnabled: enabledOf(s, provider),
    connected,
    acpProvider: provider,
    acpHarnessPath: harnessPathOf(s),
    detectedHarnessPath: detectHarnessPath(provider === 'opencode' ? 'opencode' : 'claude'),
    acpModel: s.acpModel ?? '',
    acpOpencodeModel: s.acpOpencodeModel ?? '',
    locale: s.locale ?? ''
  }
}
