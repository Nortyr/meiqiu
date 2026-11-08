import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import type { ChatEvent } from '../../shared/types'
import { acpEnv, acpProvider, detectHarnessPath, getSettings, harnessPathOf } from '../settings'
import { mainT } from '../i18n'

// ACP（Agent Client Protocol）客户端：spawn claude-agent-acp 子进程，
// 走 stdio 的换行分隔 JSON-RPC。只管 Claude Code 一家。
// 推到界面的事件契约是 shared/types.ts 的 ChatEvent（唯一出处，别在这里再定义）

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

// session/new 返回的 configOptions 里 id 为 model 的那一项（opencode；别家可能没有）
interface SessionConfigOption {
  id: string
  type?: string
  currentValue?: string
  options?: { value: string; name?: string }[]
}

export class AcpClient extends EventEmitter {
  private proc: ChildProcess | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private _sessionId: string | null = null
  private modelOption: SessionConfigOption | null = null

  get sessionId(): string | null {
    return this._sessionId
  }

  // 当前会话的可选模型；没连上或那家不提供时为 null
  getModels(): { current: string; options: { value: string; name: string }[] } | null {
    if (!this._sessionId || !this.modelOption?.options) return null
    return {
      current: this.modelOption.currentValue ?? '',
      options: this.modelOption.options.map((o) => ({ value: o.value, name: o.name ?? o.value }))
    }
  }

  // 走 ACP 的 session/set_config_option 换模型
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

  // 起进程 + initialize + session/new，返回 sessionId。重复调用复用现有会话。
  // 并发保护：两个并发 connect（自动重连 + 用户点发送）只会 spawn 一个进程，
  // 否则先完成的 sessionId 会被后完成的覆盖，第一个进程泄漏
  private connecting: Promise<string> | null = null

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

  private async doConnect(cwd: string): Promise<string> {
    const provider = acpProvider()
    const harnessPath = harnessPathOf(getSettings()).trim()
    if (provider === 'opencode') {
      // opencode 自带 acp 子命令，直接就是 ACP server；没配置就自动检测
      const bin = harnessPath || detectHarnessPath('opencode') || 'opencode'
      this.proc = spawn(bin, ['acp'], {
        env: { ...process.env, ...acpEnv() },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } else {
      const require = createRequire(import.meta.url)
      const bin = require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
      this.proc = spawn(process.execPath, [bin], {
        // Electron 的 process.execPath 是 Electron 本体，要当 Node 用
        // acpEnv() 是用户在设置里填的 CLI 路径 / 模型
        env: { ...process.env, ...acpEnv(), ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }
    this.proc.stderr!.on('data', (d) => this.emit('log', String(d)))
    // CLI 不存在等 spawn 失败：转成 Promise 拒绝，别让主进程崩
    this.proc.on('error', (err) => {
      this.emit('log', `spawn 失败: ${err.message}`)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.dispose()
    })
    this.proc.on('exit', (code) => {
      this.emit('log', `adapter 退出 code=${code}`)
      this.dispose()
    })
    this.proc.stdout!.on('data', (chunk) => this.onData(String(chunk)))

    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
    })
    const result = (await this.request('session/new', { cwd, mcpServers: [] })) as {
      sessionId: string
      configOptions?: SessionConfigOption[]
    }
    this._sessionId = result.sessionId
    this.modelOption = result.configOptions?.find((o) => o.id === 'model') ?? null
    // opencode 的模型在 app 里配：连上后把保存的模型下发下去
    const savedModel = getSettings().acpOpencodeModel?.trim()
    if (
      provider === 'opencode' &&
      savedModel &&
      savedModel !== this.modelOption?.currentValue &&
      this.modelOption?.options?.some((o) => o.value === savedModel)
    ) {
      try {
        await this.setModel(savedModel)
      } catch {
        // 下发失败就用 opencode 的默认模型，不挡聊天
      }
    }
    return this._sessionId
  }

  // 发一轮对话。消息和工具调用通过 'event' 以 ChatEvent 推出来；
  // session/prompt 返回时回合已结束，发 turn_end 让界面复位（不发的话界面会一直转圈）
  async prompt(text: string): Promise<void> {
    if (!this._sessionId) throw new Error(mainT('notConnected'))
    const result = (await this.request('session/prompt', {
      sessionId: this._sessionId,
      prompt: [{ type: 'text', text }]
    })) as { stopReason?: string }
    this.emit('event', {
      type: 'turn_end',
      stopReason: result?.stopReason ?? 'end_turn'
    } satisfies ChatEvent)
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
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        // 响应
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      } else if (msg.method && msg.id !== undefined) {
        // agent 发来的请求（权限确认等）
        this.onAgentRequest(msg)
      } else if (msg.method) {
        this.onNotification(msg)
      }
    }
  }

  // agent 问「这个工具调用允许吗」：一期自动选第一个 allow 选项，界面能看到工具调用过程
  private onAgentRequest(msg: JsonRpcMessage): void {
    if (msg.method === 'session/request_permission') {
      const params = msg.params as { options?: { optionId: string; kind?: string }[] }
      const options = params.options ?? []
      const allow =
        options.find((o) => o.kind === 'allow_always') ??
        options.find((o) => o.kind === 'allow_once') ??
        options[0]
      this.send({
        jsonrpc: '2.0',
        id: msg.id,
        result: allow
          ? { outcome: { outcome: 'selected', optionId: allow.optionId } }
          : { outcome: { outcome: 'cancelled' } }
      })
    } else {
      // 其他请求（fs 读写等，我们声明了不支持）回方法不存在
      this.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } })
    }
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
        status: String(update.status ?? 'pending')
      } satisfies ChatEvent)
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  private send(msg: JsonRpcMessage): void {
    this.proc?.stdin?.write(JSON.stringify(msg) + '\n')
  }

  dispose(): void {
    for (const p of this.pending.values()) p.reject(new Error(mainT('disconnected')))
    this.pending.clear()
    this._sessionId = null
    this.modelOption = null
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }
}

export const acpClient = new AcpClient()
