// 主进程和界面共用的类型

export type AgentId = 'kiro' | 'claude-code' | 'codex' | 'opencode'

export const AGENT_LABELS: Record<AgentId, string> = {
  kiro: 'Kiro',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode'
}

// 一条记忆（只读视图），由各 agent 的存储读出来后统一成这个结构
export interface MemoryItem {
  id: string // 全局唯一：agent:来源内 id
  agent: AgentId
  kind: string // 来源类型，如 kiro-memory / kiro-steering / claude-memory / claude-md / codex-memory / codex-agents-md / opencode-rules
  subtype?: string // 细分类型，如 Kiro 记忆的 SEMANTIC / USER_PREFERENCE
  scope: string // 'Global' 或项目标识
  title: string
  summary: string
  content: string
  why?: string
  howToApply?: string
  sessionId?: string
  filePath: string // 来源文件或数据库路径
  updatedAt?: string
}

export interface AgentError {
  agent: AgentId
  error: string
}

export interface MemoriesResult {
  items: MemoryItem[]
  errors: AgentError[]
}

// 一条历史会话的元信息（列表页用，不读正文）
export interface SessionInfo {
  id: string // 全局唯一：agent:sessionId
  agent: AgentId
  sessionId: string
  project?: string
  title?: string
  updatedAt: string
  path: string // 会话文件路径；opencode 是 库路径#sessionId
  messageCount?: number
}

export interface SessionsResult {
  items: SessionInfo[]
  errors: AgentError[]
}

// 一条对话消息（会话内容查看）
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp?: string
}

export interface SessionContentResult {
  messages: ChatMessage[]
  truncated: boolean // 消息太多只给前一部分时为 true
  total?: number // 全部消息数（截断前的总数）
  error?: string
}

// 界面语言：'' = 跟随系统
export type Locale = 'zh' | 'en'

// 支持 ACP 连接的 provider
export type AcpProvider = 'claude-code' | 'opencode' | 'codex' | 'kiro'

// 设置
export interface SettingsResult {
  acpEnabled: boolean // 当前选中的那家（acpProvider）的开关，各家独立存
  connected: boolean
  acpProvider: AcpProvider
  acpHarnessPath: string // 用户配置的 CLI 位置，空 = 自动检测
  detectedHarnessPath: string // 自动检测到的 CLI 位置
  acpModel: string
  acpOpencodeModel: string // OpenCode 的模型（走 ACP 下发），空 = 用 opencode 自己的默认
  acpCodexModel: string // Codex 的模型（走 ACP 下发），空 = 用 codex 自己的默认
  acpKiroModel: string // Kiro 的模型（走 ACP 下发），空 = 用 kiro-cli 自己的默认
  locale: Locale | '' // 界面语言，空 = 跟随系统
}

export interface AcpConfigPatch {
  acpEnabled?: boolean // 设置的是当时选中那家的开关
  acpProvider?: AcpProvider
  acpHarnessPath?: string // Claude CLI 路径
  acpOpencodePath?: string // OpenCode CLI 路径
  acpCodexPath?: string // Codex CLI 路径
  acpKiroPath?: string // kiro-cli 路径
  acpModel?: string
  acpOpencodeModel?: string
  acpCodexModel?: string
  acpKiroModel?: string
  locale?: Locale | '' // 界面语言，'' = 跟随系统
}

// ACP 连接上的可选模型（opencode 的 configOptions；未连接或不支持时为 null）
export interface AcpModelsResult {
  current: string
  options: { value: string; name: string }[]
}

// ---- 提取 / ACP 聊天 ----

// 从会话页带到提取页的任务素材
export interface ExtractTask {
  agent: AgentId
  title?: string
  path: string // 会话文件路径
}

// 已提取到 ~/.claude/skills/ 的产物
export interface SkillProduct {
  name: string
  description: string
  path: string
}

// 消息流事件（主进程推给界面）
export type ChatEvent =
  | { type: 'text'; text: string } // assistant 流式文本块
  | { type: 'tool'; id: string; title: string; kind?: string; status: string }
  | { type: 'turn_end'; stopReason: string }
  | { type: 'error'; message: string }

// ---- 知识库（LLM Wiki）----

export type WikiPageType = 'source' | 'entity' | 'concept' | 'analysis'

export const WIKI_TYPE_LABELS: Record<WikiPageType, string> = {
  source: '来源',
  entity: '实体',
  concept: '概念',
  analysis: '分析'
}

// 依据三级：人说的 > 有代码依据 > 推测
export type WikiEvidenceLevel = 'human' | 'code' | 'inferred'

export interface WikiPageMeta {
  slug: string
  type: WikiPageType
  title: string
  summary: string
  status: string // active | deprecated
  evidenceLevel?: string
  tags: string[]
  updatedAt?: string
  path: string
  // source 页专有
  sessionPath?: string // 原会话路径（证据锚）
  ingestedThroughTurn?: number // 摄入游标：下次从这之后继续
  agent?: string // 会话来自哪家 agent
  fileHash?: string // 摄入时的内容 hash（前缀）
}

// ---- 知识库体检 ----

// 问题类型：断链 / 孤立页 / deprecated 被引用 / 证据失效 / 来源有未摄入新内容
export type LintIssueKind =
  'broken-link' | 'orphan' | 'deprecated-ref' | 'evidence-gone' | 'stale-source'

export interface LintIssue {
  kind: LintIssueKind
  slug?: string
  message: string
}

export interface LintReport {
  id: number
  createdAt: string
  issues: LintIssue[]
}

export interface WikiPage extends WikiPageMeta {
  related: string[]
  body: string // frontmatter 之后的 markdown 全文
}

export interface WikiListResult {
  pages: WikiPageMeta[]
  vaultPath: string
  ftsOk: boolean
  error?: string
}

export interface WikiSearchHit {
  slug: string
  title: string
  type: WikiPageType
  snippet: string
}

// ---- 摄入管线 ----

// prepare 的产出：预填指令 + run 信息；没新内容时给 error
export interface IngestPrepareResult {
  runId?: string
  instruction?: string
  fromTurn?: number
  toTurn?: number
  turnCount?: number
  estimatedTokens?: number
  incremental?: boolean // true = 这个会话以前摄入过
  error?: string
}

// 摄入后的校验报告
export interface IngestReport {
  runId: string
  status: string // applied | failed | rolled-back
  created: string[] // 新建页的 slug
  updated: string[] // 更新页的 slug
  warnings: string[]
  errors: string[]
  backupPath?: string
}

// preload 暴露给界面的接口
export interface MeiqiuApi {
  listMemories(): Promise<MemoriesResult>
  // agent 改了记忆文件时主进程推事件；返回取消订阅函数
  onMemoriesChanged(cb: () => void): () => void
  listSessions(): Promise<SessionsResult>
  onSessionsChanged(cb: () => void): () => void
  getSessionContent(session: SessionInfo): Promise<SessionContentResult>
  // 起 ACP 会话（重复调用复用已有连接；forceNew = 保留进程但换一个全新会话）
  chatStart(forceNew?: boolean): Promise<{ sessionId: string }>
  // 发一轮对话；流式消息走 onChatEvent
  chatSend(text: string): Promise<void>
  onChatEvent(cb: (e: ChatEvent) => void): () => void
  listSkills(): Promise<SkillProduct[]>
  // 提取 skill 的预填指令（主进程拼接，引用内置 skill-creator 的路径）
  skillExtractInstruction(session: SessionInfo): Promise<string>
  getSettings(): Promise<SettingsResult>
  saveSettings(patch: AcpConfigPatch): Promise<SettingsResult>
  // 当前 ACP 连接的可选模型；未连接或那家不支持时为 null
  acpModels(): Promise<AcpModelsResult | null>
  // 知识库
  wikiList(): Promise<WikiListResult>
  wikiPage(slug: string): Promise<WikiPage | null>
  wikiSearch(query: string): Promise<WikiSearchHit[]>
  onWikiChanged(cb: () => void): () => void
  // 摄入管线：prepare 给预填指令；finish 在 turn_end 后校验落盘；rollback 用备份回滚
  wikiIngestPrepare(session: SessionInfo): Promise<IngestPrepareResult>
  wikiIngestFinish(runId: string): Promise<IngestReport>
  wikiIngestRollback(runId: string): Promise<IngestReport>
  // 程序体检：跑一次 / 拿最近一次报告
  wikiLint(): Promise<LintReport>
  wikiLintLatest(): Promise<LintReport | null>
}
