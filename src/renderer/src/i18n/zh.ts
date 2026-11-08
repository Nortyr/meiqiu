// 界面中文字典。新增文案先加在这里，en.ts 按同结构翻译（Dict 类型会强制对齐）
export const zh = {
  nav: {
    memories: '记忆',
    sessions: '会话',
    wiki: '知识库',
    settings: '设置'
  },
  common: {
    loading: '读取中',
    back: '返回',
    send: '发送',
    matches: (n: number) => `搜索中，共 ${n} 条匹配`,
    searchTitle: (kw: string) => `搜索“${kw}”`,
    readFail: (agent: string, err: string) => `${agent} 读取失败：${err}`,
    unknownProject: '未知项目'
  },
  memories: {
    searchPlaceholder: '搜索全部记忆…',
    pickScope: '在左侧选一个范围',
    noMatch: '没有匹配的记忆',
    summary: '摘要',
    content: '正文',
    source: '来源',
    sessionPrefix: '会话：',
    updatedPrefix: '更新：',
    kinds: {
      'kiro-memory': 'Kiro 记忆',
      'kiro-steering': 'steering',
      'claude-memory': '项目记忆',
      'claude-md-global': 'CLAUDE.md',
      'claude-md-project': 'CLAUDE.md',
      'codex-memory': 'Codex 记忆',
      'codex-memory-md': '记忆文件',
      'codex-agents-md': 'AGENTS.md',
      'opencode-rules': '规则文件'
    } as Record<string, string>
  },
  sessions: {
    searchPlaceholder: '搜索全部会话…',
    pickProject: '在左侧选一个项目',
    noMatch: '没有匹配的会话',
    messageCount: (n: number) => `${n} 条消息`,
    moreHint: (cap: number, rest: number) => `只显示前 ${cap} 条，还有 ${rest} 条，用搜索缩小范围`,
    loadingConversation: '正在读会话',
    truncated: (n: number) => `消息较多，只显示前 ${n} 条`,
    emptyConversation: '这个会话没有可显示的对话内容'
  },
  chat: {
    extractSkill: '提取 skill',
    ingestWiki: '摄入知识库',
    extractTitle: '把这个会话提炼成 skill',
    ingestTitle: '把这个会话的知识摄入知识库',
    enableFirstExtract: '提取 skill 需要先启用 ACP：到左侧「设置」页打开开关',
    enableFirstIngest: '摄入知识库需要先启用 ACP：到左侧「设置」页打开开关',
    prepareFail: (err: string) => `prepare 失败：${err}`,
    prepareFailGeneric: 'prepare 失败',
    rollbackConfirm: '用摄入前的备份覆盖当前知识库？',
    composerPlaceholder: (provider: string) =>
      `跟 ${provider} 说点什么，Enter 发送，Shift+Enter 换行`,
    sendFail: (err: string) => `发送失败：${err}`,
    errorPrefix: (msg: string) => `出错了：${msg}`,
    taskTag: '任务',
    taskBanner: (mode: 'extract' | 'ingest', agent: string, title: string) =>
      mode === 'ingest'
        ? `把 ${agent} 的会话「${title}」摄入知识库`
        : `从 ${agent} 的会话「${title}」提取 skill`,
    cancelTask: '取消任务',
    skillsToggle: (n: number) => `已提取 ${n} 个 skill`,
    directChat: '直接对话',
    reportRolledBack: '已回滚到摄入前的状态',
    reportSummary: (created: number, updated: number, warnings: number, errors: number) =>
      `摄入完成 — 新建 ${created} 页 · 更新 ${updated} 页` +
      (warnings > 0 ? ` · ⚠ ${warnings} 警告` : '') +
      (errors > 0 ? ` · ${errors} 错误` : ''),
    collapse: '收起',
    viewDetail: '查看',
    rollback: '回滚',
    createdPages: (list: string) => `新建：${list}`,
    updatedPages: (list: string) => `更新：${list}`,
    noChanges: 'agent 没有改动任何页面',
    noSkills: '还没有产物',
    contextPrefix: (path: string, agent: string, text: string) =>
      `请阅读会话文件 ${path}（这是 ${agent} 的历史会话），然后回答：${text}`
  },
  wiki: {
    searchPlaceholder: '搜索知识库…',
    types: {
      source: '来源',
      entity: '实体',
      concept: '概念',
      analysis: '分析'
    } as Record<string, string>,
    levels: {
      human: '人说的',
      code: '代码依据',
      inferred: '推测'
    } as Record<string, string>,
    lintKinds: {
      'broken-link': '断链',
      orphan: '孤立页',
      'deprecated-ref': '引用废弃页',
      'evidence-gone': '证据失效',
      'stale-source': '来源有新内容'
    } as Record<string, string>,
    lint: '体检',
    lintTooltip: '程序体检：断链、孤立页、证据失效',
    lintBanner: (n: number) => `体检发现 ${n} 个问题`,
    viewReport: '查看报告',
    lintReport: '体检报告',
    lintMeta: (time: string, n: number) => `${time} · ${n} 个问题`,
    lintNever: '还没体检过',
    lintRunning: '体检中…',
    lintRerun: '重新体检',
    lintClean: '没有发现问题',
    lintHint: '点「重新体检」跑一次程序检查',
    noMatch: '没有匹配的页面',
    deprecated: '已废弃',
    deprecatedBar: '这个页面已废弃，内容可能过时',
    evidencePrefix: '依据：',
    updatedPrefix: '更新',
    emptyTitle: '还没有知识页。',
    emptyHint: '到「会话」选一段会话，点输入条上方的「摄入知识库」。',
    loadingPage: '正在读页面',
    openSession: (path: string) => `打开会话：${path}`,
    groupTitle: (label: string, n: number) => `${label}（${n}）`
  },
  settings: {
    title: '设置',
    language: '语言',
    languageDesc: '界面显示语言，默认跟随系统。',
    langAuto: '跟随系统',
    langZh: '中文',
    langEn: 'English',
    provider: '提供商',
    enable: (label: string) => `启用 ${label}`,
    enableDesc:
      '开启后，会话页底部会出现对话框，可以从会话提取 skill，也可以直接对话。禁用后，已有会话内容仍会保留。',
    connStatus: '连接状态',
    connected: '已连接',
    disconnected: '未连接（发送消息时会自动重试）',
    cliPath: (label: string) => `${label} CLI 路径`,
    cliPathDesc: (label: string, detected: string) =>
      `${label} CLI 的自定义路径。留空使用自动检测${detected ? `（当前：${detected}）` : ''}。`,
    model: '模型',
    modelDescClaude: '提取 skill 和对话用的模型，默认由 Claude Code 决定。',
    modelDescOpencode: '通过 ACP 下发给 OpenCode，只影响煤球起的会话，不改 OpenCode 自己的配置。',
    modelDefault: '默认',
    modelCustom: '自定义…',
    customModel: '自定义模型',
    customModelDesc: '填模型 ID，如 claude-sonnet-4-5-20250929。',
    customModelPlaceholder: '模型 ID',
    ocModelDefault: (current: string) => `默认（${current}）`,
    ocModelsAfterConnect: '连接成功后显示可选模型',
    save: '保存并重连',
    saved: '已保存',
    saveHint: '改配置会自动断开重连'
  }
}

export type Dict = typeof zh
