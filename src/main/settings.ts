import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { AcpProvider, Locale, SettingsResult } from '../shared/types'

// 用户设置持久化在 ~/.meiqiu/settings.json
const SETTINGS_PATH = join(homedir(), '.meiqiu', 'settings.json')

export interface AcpConfig {
  acpProvider?: AcpProvider
  acpEnabledClaudeCode?: boolean // Claude Code 的开关，各家独立
  acpEnabledOpencode?: boolean // OpenCode 的开关，各家独立
  acpEnabledCodex?: boolean // Codex 的开关，各家独立
  acpEnabledKiro?: boolean // Kiro 的开关，各家独立
  acpHarnessPath?: string // Claude CLI 路径
  acpOpencodePath?: string // OpenCode CLI 路径
  acpCodexPath?: string // Codex CLI 路径
  acpKiroPath?: string // kiro-cli 路径
  acpModel?: string
  acpOpencodeModel?: string // OpenCode 的模型，连上后走 ACP 下发
  acpCodexModel?: string // Codex 的模型，连上后走 ACP 下发
  acpKiroModel?: string // Kiro 的模型，连上后走 ACP 下发
  acpEnabled?: boolean // 旧版全局开关，读取时迁移掉
  wikiVaultPath?: string // 知识库 vault 位置，空 = ~/.meiqiu/vault
  locale?: Locale | '' // 界面语言，空/缺省 = 跟随系统
}

const PATH_KEYS: Record<
  AcpProvider,
  'acpHarnessPath' | 'acpOpencodePath' | 'acpCodexPath' | 'acpKiroPath'
> = {
  'claude-code': 'acpHarnessPath',
  opencode: 'acpOpencodePath',
  codex: 'acpCodexPath',
  kiro: 'acpKiroPath'
}

export function harnessPathFor(s: AcpConfig, provider: AcpProvider): string {
  return s[PATH_KEYS[provider]] ?? ''
}

export function harnessPathOf(s: AcpConfig): string {
  return harnessPathFor(s, s.acpProvider ?? 'claude-code')
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
    const key = ENABLED_KEYS[s.acpProvider ?? 'claude-code']
    if (s[key] === undefined) s[key] = s.acpEnabled
    delete s.acpEnabled
  }
  return s
}

export function getSettings(): AcpConfig {
  return readFile()
}

const ENABLED_KEYS: Record<
  AcpProvider,
  'acpEnabledClaudeCode' | 'acpEnabledOpencode' | 'acpEnabledCodex' | 'acpEnabledKiro'
> = {
  'claude-code': 'acpEnabledClaudeCode',
  opencode: 'acpEnabledOpencode',
  codex: 'acpEnabledCodex',
  kiro: 'acpEnabledKiro'
}

function enabledOf(s: AcpConfig, provider: AcpProvider): boolean {
  return s[ENABLED_KEYS[provider]] === true
}

export function isProviderEnabled(provider: AcpProvider): boolean {
  return enabledOf(readFile(), provider)
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
    next[ENABLED_KEYS[provider]] = acpEnabled
  }
  mkdirSync(join(homedir(), '.meiqiu'), { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2))
}

// PATH 里找不到时的常见安装位置
const HARNESS_CANDIDATES: Record<'claude' | 'opencode' | 'codex' | 'kiro-cli', string[]> = {
  claude: [],
  opencode: [
    join(homedir(), '.opencode/bin/opencode'), // 官方安装脚本
    '/Applications/OpenCode.app/Contents/Resources/opencode-cli' // 桌面版自带
  ],
  codex: [],
  'kiro-cli': [join(homedir(), '.local/bin/kiro-cli')] // 官方安装脚本
}

// 自动检测 CLI 的位置：先 PATH，再常见安装位置
export function detectHarnessPath(bin: 'claude' | 'opencode' | 'codex' | 'kiro-cli'): string {
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
export function acpEnv(
  provider: AcpProvider = acpProvider(),
  modelOverride?: string
): Record<string, string> {
  const s = readFile()
  const env: Record<string, string> = {}
  // 用户配了 CLI 的位置就把它所在目录放到 PATH 最前
  const hp = harnessPathFor(s, provider).trim()
  if (hp) env.PATH = `${dirname(hp)}:${process.env.PATH ?? ''}`
  // 模型只对 Claude Code 生效；opencode/codex/kiro 的模型走 ACP 下发
  const claudeModel = modelOverride?.trim() || s.acpModel?.trim()
  if (claudeModel && provider === 'claude-code') {
    env.ANTHROPIC_MODEL = claudeModel
  }
  return env
}

// 各家在 app 里配的、要走 ACP configOptions 下发的模型（Claude Code 没有，走环境变量）
export function acpSavedModel(provider: AcpProvider): string {
  const s = readFile()
  if (provider === 'opencode') return s.acpOpencodeModel?.trim() ?? ''
  if (provider === 'codex') return s.acpCodexModel?.trim() ?? ''
  if (provider === 'kiro') return s.acpKiroModel?.trim() ?? ''
  return ''
}

export function acpProvider(): AcpProvider {
  return readFile().acpProvider ?? 'claude-code'
}

export function harnessPermissionInfo(provider: AcpProvider): {
  mode: string
  configPath: string
} {
  const candidates: Record<AcpProvider, string[]> = {
    'claude-code': [
      join(homedir(), '.claude', 'settings.local.json'),
      join(homedir(), '.claude', 'settings.json')
    ],
    codex: [join(homedir(), '.codex', 'config.toml')],
    opencode: [join(homedir(), '.config', 'opencode', 'opencode.json')],
    kiro: [join(homedir(), '.kiro', 'settings.json')]
  }
  const configPath = candidates[provider].find(existsSync) ?? candidates[provider][0]
  return {
    mode: existsSync(configPath) ? '用户配置 + Harness/adapter 默认' : 'Harness/adapter 默认',
    configPath
  }
}

export function toResult(connected: boolean): SettingsResult {
  const s = readFile()
  const provider = s.acpProvider ?? 'claude-code'
  return {
    acpEnabled: enabledOf(s, provider),
    connected,
    acpProvider: provider,
    acpHarnessPath: harnessPathOf(s),
    detectedHarnessPath: detectHarnessPath(
      provider === 'opencode'
        ? 'opencode'
        : provider === 'codex'
          ? 'codex'
          : provider === 'kiro'
            ? 'kiro-cli'
            : 'claude'
    ),
    acpModel: s.acpModel ?? '',
    acpOpencodeModel: s.acpOpencodeModel ?? '',
    acpCodexModel: s.acpCodexModel ?? '',
    acpKiroModel: s.acpKiroModel ?? '',
    locale: s.locale ?? ''
  }
}
