import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import type {
  AcpProvider,
  ChatEvent,
  PermissionDecision,
  PermissionRequest
} from '../../shared/types'
import {
  acpEnv,
  acpProvider,
  acpSavedModel,
  detectHarnessPath,
  harnessPathFor,
  getSettings
} from '../settings'
import { mainT } from '../i18n'

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingPermission {
  rpcId: number | string
  timer: ReturnType<typeof setTimeout>
  request: PermissionRequest
}

interface SessionConfigOption {
  id: string
  type?: string
  currentValue?: string
  options?: { value: string; name?: string }[]
}

export interface CollectedPrompt {
  text: string
  tools: Extract<ChatEvent, { type: 'tool' }>[]
  stopReason: string
}

const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|cookie)/i

function sanitizeToolValue(value: unknown, depth = 0, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]'
  if (depth > 6) return '[truncated]'
  if (typeof value === 'string')
    return value.length > 100_000 ? `${value.slice(0, 100_000)}\n[truncated]` : value
  if (Array.isArray(value))
    return value.slice(0, 200).map((item) => sanitizeToolValue(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([childKey, child]) => [childKey, sanitizeToolValue(child, depth + 1, childKey)])
    )
  }
  return value
}

// 每个 Workflow Run 使用独立实例；界面聊天继续使用文件末尾的全局实例。
export class AcpClient extends EventEmitter {
  private proc: ChildProcess | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private _sessionId: string | null = null
  private modelOption: SessionConfigOption | null = null
  private connecting: Promise<string> | null = null

  constructor(
    private readonly providerOverride?: AcpProvider,
    private readonly modelOverride?: string
  ) {
    super()
  }

  get provider(): AcpProvider {
    return this.providerOverride ?? acpProvider()
  }

  get sessionId(): string | null {
    return this._sessionId
  }

  getModels(): { current: string; options: { value: string; name: string }[] } | null {
    if (!this._sessionId || !this.modelOption?.options) return null
    return {
      current: this.modelOption.currentValue ?? '',
      options: this.modelOption.options.map((o) => ({ value: o.value, name: o.name ?? o.value }))
    }
  }

  async setModel(value: string): Promise<void> {
    if (!this._sessionId) throw new Error(mainT('notConnected'))
    const result = (await this.request('session/set_config_option', {
      sessionId: this._sessionId,
      configId: 'model',
      value
    })) as { configOptions?: SessionConfigOption[] }
    const opt = result.configOptions?.find((o) => o.id === 'model')
    if (opt) this.modelOption = opt
  }

  async connect(cwd: string): Promise<string> {
    if (this._sessionId) return this._sessionId
    if (this.connecting) return this.connecting
    this.connecting = this.doConnect(cwd)
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  async newSession(cwd: string): Promise<string> {
    if (!this.proc) return this.connect(cwd)
    return this.startSession(cwd)
  }

  private async doConnect(cwd: string): Promise<string> {
    const provider = this.provider
    const harnessPath = harnessPathFor(getSettings(), provider).trim()
    if (provider === 'opencode') {
      const bin = harnessPath || detectHarnessPath('opencode') || 'opencode'
      this.proc = spawn(bin, ['acp'], {
        env: { ...process.env, ...acpEnv(provider, this.modelOverride) },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } else if (provider === 'kiro') {
      const bin = harnessPath || detectHarnessPath('kiro-cli') || 'kiro-cli'
      this.proc = spawn(bin, ['acp'], {
        env: { ...process.env, ...acpEnv(provider, this.modelOverride) },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } else {
      const require = createRequire(import.meta.url)
      const pkg =
        provider === 'codex'
          ? '@agentclientprotocol/codex-acp/dist/index.js'
          : '@agentclientprotocol/claude-agent-acp/dist/index.js'
      const bin = require.resolve(pkg)
      this.proc = spawn(process.execPath, [bin], {
        env: { ...process.env, ...acpEnv(provider), ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }

    const proc = this.proc
    proc.stderr!.on('data', (d) => this.emit('log', String(d)))
    proc.on('error', (err) => {
      this.emit('log', `spawn 失败: ${err.message}`)
      this.rejectPending(err)
      this.dispose()
    })
    proc.on('exit', (code) => {
      this.emit('log', `adapter 退出 code=${code}`)
      if (this.proc === proc) this.proc = null
      this.rejectPending(new Error(mainT('disconnected')))
      this.clearSessionState()
      this.emit('disposed')
    })
    proc.stdout!.on('data', (chunk) => this.onData(String(chunk)))

    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
    })
    return this.startSession(cwd)
  }

  private async startSession(cwd: string): Promise<string> {
    const provider = this.provider
    const result = (await this.request('session/new', { cwd, mcpServers: [] })) as {
      sessionId: string
      configOptions?: SessionConfigOption[]
    }
    this._sessionId = result.sessionId
    this.modelOption = result.configOptions?.find((o) => o.id === 'model') ?? null
    const savedModel = this.modelOverride?.trim() || acpSavedModel(provider)
    if (
      savedModel &&
      savedModel !== this.modelOption?.currentValue &&
      this.modelOption?.options?.some((o) => o.value === savedModel)
    ) {
      try {
        await this.setModel(savedModel)
      } catch {
        // 下发失败就用 Harness 默认模型，不阻断任务。
      }
    }
    return this._sessionId
  }

  async prompt(text: string, timeoutMs = 30 * 60_000): Promise<void> {
    if (!this._sessionId) throw new Error(mainT('notConnected'))
    const result = (await this.request(
      'session/prompt',
      {
        sessionId: this._sessionId,
        prompt: [{ type: 'text', text }]
      },
      timeoutMs
    )) as { stopReason?: string }
    this.emit('event', {
      type: 'turn_end',
      stopReason: result?.stopReason ?? 'end_turn'
    } satisfies ChatEvent)
  }

  async promptCollect(text: string, timeoutMs = 30 * 60_000): Promise<CollectedPrompt> {
    let output = ''
    const tools: CollectedPrompt['tools'] = []
    let stopReason = 'end_turn'
    const listener = (event: ChatEvent): void => {
      if (event.type === 'text') output += event.text
      else if (event.type === 'tool') {
        const index = tools.findIndex((tool) => tool.id === event.id)
        if (index === -1) tools.push(event)
        else {
          const previous = tools[index]
          tools[index] = {
            ...previous,
            ...Object.fromEntries(
              Object.entries(event).filter(([, value]) => value !== undefined && value !== '')
            )
          } as Extract<ChatEvent, { type: 'tool' }>
        }
      } else if (event.type === 'turn_end') stopReason = event.stopReason
    }
    this.on('event', listener)
    try {
      await this.prompt(text, timeoutMs)
      return { text: output, tools, stopReason }
    } finally {
      this.off('event', listener)
    }
  }

  cancelPrompt(): void {
    if (!this._sessionId) return
    this.send({
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: this._sessionId }
    })
  }

  respondPermission(decision: PermissionDecision): boolean {
    const pending = this.pendingPermissions.get(decision.requestId)
    if (!pending) return false
    this.pendingPermissions.delete(decision.requestId)
    clearTimeout(pending.timer)
    const valid = pending.request.options.some((o) => o.optionId === decision.optionId)
    this.send({
      jsonrpc: '2.0',
      id: pending.rpcId,
      result:
        !decision.cancelled && decision.optionId && valid
          ? { outcome: { outcome: 'selected', optionId: decision.optionId } }
          : { outcome: { outcome: 'cancelled' } }
    })
    this.emit('permission-resolved', decision.requestId)
    return true
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let msg: JsonRpcMessage
      try {
        msg = JSON.parse(line)
      } catch {
        this.emit('log', `无法解析的行: ${line.slice(0, 120)}`)
        continue
      }
      if (typeof msg.id === 'number' && (msg.result !== undefined || msg.error !== undefined)) {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          clearTimeout(p.timer)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      } else if (msg.method && msg.id !== undefined) {
        this.onAgentRequest(msg)
      } else if (msg.method) {
        this.onNotification(msg)
      }
    }
  }

  private onAgentRequest(msg: JsonRpcMessage): void {
    if (msg.method !== 'session/request_permission') {
      this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } })
      return
    }

    const params = (msg.params ?? {}) as {
      toolCall?: Record<string, unknown>
      options?: { optionId?: string; name?: string; kind?: string }[]
    }
    const toolCall = params.toolCall ?? {}
    const requestId = crypto.randomUUID()
    const request: PermissionRequest = {
      requestId,
      provider: this.provider,
      toolCall: {
        title: typeof toolCall.title === 'string' ? toolCall.title : undefined,
        kind: typeof toolCall.kind === 'string' ? toolCall.kind : undefined,
        locations: sanitizeToolValue(toolCall.locations),
        content: sanitizeToolValue(toolCall.content),
        rawInput: sanitizeToolValue(toolCall.rawInput)
      },
      options: (params.options ?? [])
        .filter((o): o is { optionId: string; name?: string; kind?: string } => Boolean(o.optionId))
        .map((o) => ({
          optionId: o.optionId,
          name: o.name ?? o.kind ?? o.optionId,
          kind: o.kind ?? ''
        })),
      createdAt: new Date().toISOString()
    }
    const timer = setTimeout(() => {
      this.respondPermission({ requestId, cancelled: true })
    }, 5 * 60_000)
    this.pendingPermissions.set(requestId, { rpcId: msg.id!, timer, request })
    this.emit('permission', request)
  }

  private onNotification(msg: JsonRpcMessage): void {
    if (msg.method !== 'session/update') return
    const update = (msg.params as { update?: Record<string, unknown> }).update
    if (!update) return
    const kind = update.sessionUpdate
    if (kind === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string }
      if (content?.type === 'text' && content.text) {
        this.emit('event', { type: 'text', text: content.text } satisfies ChatEvent)
      }
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      this.emit('event', {
        type: 'tool',
        id: String(update.toolCallId ?? ''),
        title: String(update.title ?? ''),
        kind: typeof update.kind === 'string' ? update.kind : undefined,
        status: String(update.status ?? 'pending'),
        rawInput: sanitizeToolValue(update.rawInput),
        rawOutput: sanitizeToolValue(update.rawOutput),
        content: sanitizeToolValue(update.content),
        locations: sanitizeToolValue(update.locations)
      } satisfies ChatEvent)
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 60_000
  ): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private send(msg: JsonRpcMessage): void {
    this.proc?.stdin?.write(JSON.stringify(msg) + '\n')
  }

  private rejectPending(error: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(error)
    }
    this.pending.clear()
    for (const p of this.pendingPermissions.values()) clearTimeout(p.timer)
    this.pendingPermissions.clear()
  }

  private clearSessionState(): void {
    this._sessionId = null
    this.modelOption = null
    this.connecting = null
  }

  dispose(): void {
    this.cancelPrompt()
    for (const requestId of [...this.pendingPermissions.keys()]) {
      this.respondPermission({ requestId, cancelled: true })
    }
    this.rejectPending(new Error(mainT('disconnected')))
    this.clearSessionState()
    const proc = this.proc
    this.proc = null
    if (proc) proc.kill()
    this.emit('disposed')
  }
}

export const acpClient = new AcpClient()
