import type { Dict } from './zh'

// English dictionary. The Dict type from zh.ts enforces the same shape
export const en: Dict = {
  nav: {
    memories: 'Memories',
    sessions: 'Sessions',
    wiki: 'Wiki',
    settings: 'Settings'
  },
  common: {
    loading: 'Loading',
    back: 'Back',
    send: 'Send',
    matches: (n) => `${n} match${n === 1 ? '' : 'es'}`,
    searchTitle: (kw) => `Search "${kw}"`,
    readFail: (agent, err) => `Failed to read ${agent}: ${err}`,
    unknownProject: 'Unknown project'
  },
  memories: {
    searchPlaceholder: 'Search all memories…',
    pickScope: 'Pick a scope on the left',
    noMatch: 'No matching memories',
    summary: 'Summary',
    content: 'Content',
    source: 'Source',
    sessionPrefix: 'Session: ',
    updatedPrefix: 'Updated: ',
    kinds: {
      'kiro-memory': 'Kiro memory',
      'kiro-steering': 'steering',
      'claude-memory': 'Project memory',
      'claude-md-global': 'CLAUDE.md',
      'claude-md-project': 'CLAUDE.md',
      'codex-memory': 'Codex memory',
      'codex-memory-md': 'Memory file',
      'codex-agents-md': 'AGENTS.md',
      'opencode-rules': 'Rules file'
    }
  },
  sessions: {
    searchPlaceholder: 'Search all sessions…',
    pickProject: 'Pick a project on the left',
    noMatch: 'No matching sessions',
    messageCount: (n) => `${n} messages`,
    moreHint: (cap, rest) => `Showing the first ${cap} only, ${rest} more — narrow down by search`,
    loadingConversation: 'Reading session',
    truncated: (n) => `Too many messages, showing the first ${n} only`,
    emptyConversation: 'This session has no displayable conversation'
  },
  chat: {
    extractSkill: 'Extract skill',
    ingestWiki: 'Ingest into wiki',
    extractTitle: 'Distill this session into a skill',
    ingestTitle: 'Ingest the knowledge of this session into the wiki',
    enableFirstExtract: 'Extracting skills requires ACP: turn it on in Settings on the left',
    enableFirstIngest: 'Ingesting into the wiki requires ACP: turn it on in Settings on the left',
    prepareFail: (err) => `Prepare failed: ${err}`,
    prepareFailGeneric: 'Prepare failed',
    rollbackConfirm: 'Overwrite the current wiki with the pre-ingest backup?',
    composerPlaceholder: (provider) =>
      `Say something to ${provider}. Enter to send, Shift+Enter for a new line`,
    sendFail: (err) => `Send failed: ${err}`,
    errorPrefix: (msg) => `Something went wrong: ${msg}`,
    taskTag: 'Task',
    taskBanner: (mode, agent, title) =>
      mode === 'ingest'
        ? `Ingest the ${agent} session "${title}" into the wiki`
        : `Extract a skill from the ${agent} session "${title}"`,
    cancelTask: 'Cancel task',
    skillsToggle: (n) => `~/.claude/skills · ${n}`,
    skillsSearch: 'Search skills…',
    directChat: 'Direct chat',
    reportRolledBack: 'Rolled back to the pre-ingest state',
    reportSummary: (created, updated, warnings, errors) =>
      `Ingest done — ${created} created · ${updated} updated` +
      (warnings > 0 ? ` · ⚠ ${warnings} warning${warnings === 1 ? '' : 's'}` : '') +
      (errors > 0 ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''),
    collapse: 'Collapse',
    viewDetail: 'View',
    rollback: 'Rollback',
    createdPages: (list) => `Created: ${list}`,
    updatedPages: (list) => `Updated: ${list}`,
    noChanges: 'The agent did not change any page',
    noSkills: 'No skills in this directory',
    contextPrefix: (path, agent, text) =>
      `Read the session file at ${path} (a past ${agent} session), then answer: ${text}`
  },
  wiki: {
    searchPlaceholder: 'Search the wiki…',
    types: {
      source: 'Sources',
      entity: 'Entities',
      concept: 'Concepts',
      analysis: 'Analyses'
    },
    levels: {
      human: 'Said by human',
      code: 'Code-backed',
      inferred: 'Inferred'
    },
    lintKinds: {
      'broken-link': 'Broken links',
      orphan: 'Orphan pages',
      'deprecated-ref': 'Refs to deprecated',
      'evidence-gone': 'Evidence gone',
      'stale-source': 'Source has new content'
    },
    lint: 'Lint',
    lintTooltip: 'Programmatic lint: broken links, orphan pages, stale evidence',
    lintBanner: (n) => `Lint found ${n} issue${n === 1 ? '' : 's'}`,
    viewReport: 'View report',
    lintReport: 'Lint report',
    lintMeta: (time, n) => `${time} · ${n} issue${n === 1 ? '' : 's'}`,
    lintNever: 'Never linted yet',
    lintRunning: 'Linting…',
    lintRerun: 'Run lint again',
    lintClean: 'No issues found',
    lintHint: 'Click "Run lint again" to run a programmatic check',
    noMatch: 'No matching pages',
    deprecated: 'Deprecated',
    deprecatedBar: 'This page is deprecated and may be outdated',
    evidencePrefix: 'Evidence: ',
    updatedPrefix: 'Updated',
    emptyTitle: 'No wiki pages yet.',
    emptyHint: 'Pick a session in "Sessions" and click "Ingest into wiki" above the input bar.',
    loadingPage: 'Reading page',
    openSession: (path) => `Open session: ${path}`,
    groupTitle: (label, n) => `${label} (${n})`
  },
  settings: {
    title: 'Settings',
    language: 'Language',
    languageDesc: 'Display language. Follows the system by default.',
    langAuto: 'System',
    langZh: '中文',
    langEn: 'English',
    provider: 'Provider',
    enable: (label) => `Enable ${label}`,
    enableDesc:
      'When enabled, a chat bar appears at the bottom of the Sessions page: distill sessions into skills, ingest them into the wiki, or just chat. Disabling keeps existing session content.',
    connStatus: 'Connection',
    connected: 'Connected',
    disconnected: 'Not connected (auto-retries when sending)',
    cliPath: (label) => `${label} CLI path`,
    cliPathDesc: (label, detected) =>
      `Custom path to the ${label} CLI. Leave empty for auto-detection${detected ? ` (current: ${detected})` : ''}.`,
    model: 'Model',
    modelDescClaude: 'Model for skill extraction and chat. Decided by Claude Code by default.',
    modelDescAcp: (label) =>
      `Sent to ${label} over ACP. Only affects sessions started by MeiQiu; ${label}'s own config is untouched.`,
    modelDefault: 'Default',
    modelCustom: 'Custom…',
    customModel: 'Custom model',
    customModelDesc: 'Model ID, e.g. claude-sonnet-4-5-20250929.',
    customModelPlaceholder: 'Model ID',
    ocModelDefault: (current) => `Default (${current})`,
    ocModelsAfterConnect: 'Available models appear once connected',
    save: 'Save & reconnect',
    saved: 'Saved',
    saveHint: 'Changing settings auto-disconnects and reconnects'
  }
}
