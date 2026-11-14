import type { Dict } from './zh'

// English dictionary. The Dict type from zh.ts enforces the same shape
export const en: Dict = {
  nav: {
    memories: 'Memories',
    sessions: 'Sessions',
    wiki: 'Wiki',
    automation: 'Automation',
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
    newChat: 'New chat',
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
  permissions: {
    title: 'Harness permission request',
    pending: (n) => `${n} pending`,
    unknownTool: 'Tool name unavailable',
    noDetail: 'This Harness did not provide the full command or path.',
    remember: 'remember',
    rememberWarning: 'The Harness will store this decision and may stop asking',
    cancel: 'Cancel this action'
  },
  automation: {
    newTask: 'New task',
    recentRuns: 'Recent runs',
    noRuns: 'No runs yet',
    capabilities: 'Capabilities',
    kicker: 'Goal delegation',
    title: 'Give MeiQiu a complete goal',
    lead: 'Describe the goal, your proposed approach, context, and limits. MeiQiu creates a reviewable plan before changing anything.',
    enableAcp: 'Enable an ACP Harness in Settings before using automation.',
    workspace: 'Working directory',
    workspacePlaceholder: 'Choose an existing directory or create a temporary workspace',
    createWorkspace: 'New temporary workspace',
    creatingWorkspace: 'Creating…',
    workspaceHint:
      'Use a temporary workspace for non-project tasks. It lives under ~/.meiqiu/workspaces/.',
    brief: 'Complete task brief',
    briefPlaceholder:
      'Example: Upgrade a project to React 19, or listen for Lark messages and save events in the workspace. Include your approach, limits, and completion criteria.',
    briefHint:
      'Planning only reads the project and may write plan.json only in MeiQiu’s draft directory.',
    planning: 'Planning…',
    makePlan: 'Create plan',
    planDraft: 'Plan to confirm',
    discard: 'Discard',
    goal: 'Goal',
    structure: 'Execution structure',
    structureHint: 'Read only · Click a node to find its step',
    steps: 'Execution list',
    addAction: 'Add action',
    addCheck: 'Add check',
    removeStep: 'Remove step',
    newActionText: 'Describe the work for the Agent',
    newCheckText: 'Run the confirmed verifiers',
    verifiers: 'Completion evidence',
    limits: 'Limits',
    rounds: 'Max rounds',
    minutes: 'Max minutes',
    boundaries: 'Declared boundaries',
    boundaryNote:
      'In v1 these boundaries instruct the Agent; MeiQiu does not enforce them in code.',
    executionEnvironment: 'Execution environment',
    permissionMode: 'Permission source',
    permissionInherited:
      'Permissions follow the current Harness configuration. Requests appear as decision cards.',
    freezeHint: 'Starting freezes the plan, commands, Harness, model, and working directory.',
    starting: 'Starting…',
    start: 'Start run',
    runLabel: (round) => `Round ${round}`,
    roundLabel: (round) => `Round ${round}`,
    cancelRun: 'Cancel',
    saveCapability: 'Save as capability',
    savedCapability: 'Saved as capability',
    stopped: 'The run stopped here',
    reconciliationHint:
      'The Agent may have changed files before the response was interrupted. MeiQiu will not replay it automatically; inspect the workspace diff first.',
    evidence: 'Result evidence',
    viewLog: 'View raw output',
    hideLog: 'Hide raw output',
    loadingLog: 'Loading raw output…',
    stepTypes: {
      agent: 'Action',
      verify: 'Check',
      review: 'Review',
      approval: 'Human'
    },
    statuses: {
      queued: 'Queued',
      running: 'Running',
      waiting_input: 'Needs input',
      needs_reconciliation: 'Needs reconciliation',
      succeeded: 'Succeeded',
      failed: 'Not passed',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted'
    }
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
