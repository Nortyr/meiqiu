/* eslint-disable react-refresh/only-export-components -- context 文件：Provider 和 hook 必须同文件 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatEvent, IngestReport, SessionInfo, SkillProduct } from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'
import { useSettings } from '../state/settings'

// ACP 聊天状态。挂在 App 层（ChatProvider），不随页面切换卸载——
// 以前在 SessionsPage 里，切页会丢聊天记录，摄入跑到一半切页还会丢 turn_end
// 之后的 wikiIngestFinish，ingest run 永远停在 prepared
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
}

export interface ToolItem {
  id: string
  title: string
  status: string
}

export type TaskMode = 'extract' | 'ingest'

interface ChatContextValue {
  messages: ChatMessage[]
  tools: ToolItem[]
  running: boolean
  connected: boolean
  input: string
  setInput: (v: string) => void
  task: SessionInfo | null
  taskMode: TaskMode
  ingestReport: IngestReport | null
  skills: SkillProduct[]
  showSkills: boolean
  hintText: string | null
  clearHint: () => void
  // 聊天视图是否开着：切页时记住，回来直接恢复到聊天视图
  chatViewOpen: boolean
  setChatViewOpen: (v: boolean) => void
  // 这轮对话绑定的会话（从某个会话进入聊天时带上它的上下文）；null = 直接对话
  contextSession: SessionInfo | null
  send: (text: string) => Promise<void>
  // 在看某个会话时发问：绑定的不是这个会话就先重开一轮对话，再带上下文发送
  sendFromConversation: (text: string, session: SessionInfo) => Promise<void>
  // 手动重开一轮对话（清消息 + 主进程换新 ACP 会话），回到直接对话
  newChat: () => Promise<void>
  startExtract: (session: SessionInfo) => Promise<void>
  startIngest: (session: SessionInfo) => Promise<void>
  clearTask: () => void
  toggleSkills: () => void
  dismissReport: () => void
  rollbackIngest: () => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ChatProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { settings, t } = useSettings()
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const [task, setTask] = useState<SessionInfo | null>(null)
  const [taskMode, setTaskMode] = useState<TaskMode>('extract')
  const [ingestReport, setIngestReport] = useState<IngestReport | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [running, setRunning] = useState(false)
  const [skills, setSkills] = useState<SkillProduct[]>([])
  const [showSkills, setShowSkills] = useState(false)
  const [hintText, setHintText] = useState<string | null>(null)
  const [chatViewOpen, setChatViewOpen] = useState(false)
  // 这轮对话绑定的会话；换会话进入聊天时要重开对话，否则上下文是错的
  const [contextSession, setContextSession] = useState<SessionInfo | null>(null)

  // 摄入 run id 在事件回调里读，用 ref 避免闭包过期
  const ingestRunRef = useRef<string | null>(null)
  const setIngestRun = (runId: string | null): void => {
    ingestRunRef.current = runId
  }

  // 设置加载完 / 变化后：启用过就连，并把主进程的连接状态同步过来
  useEffect(() => {
    if (!settings) return
    setConnected(settings.connected)
    if (settings.acpEnabled && !settings.connected) {
      window.api
        .chatStart()
        .then(() => setConnected(true))
        .catch(() => setConnected(false))
    }
  }, [settings])

  // 流式事件：语言切换时重订阅（错误文案要用最新的 t）
  useEffect(
    () =>
      window.api.onChatEvent((ev: ChatEvent) => {
        if (ev.type === 'text') {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), { ...last, text: last.text + ev.text }]
            }
            return [...prev, { role: 'assistant', text: ev.text, streaming: true }]
          })
        } else if (ev.type === 'tool') {
          setTools((prev) => {
            const i = prev.findIndex((x) => x.id === ev.id)
            if (i === -1) return [...prev, { id: ev.id, title: ev.title, status: ev.status }]
            // tool_call_update 只带状态不带标题：标题为空时保留原来的
            const old = prev[i]
            const item = { id: ev.id, title: ev.title || old.title, status: ev.status }
            return [...prev.slice(0, i), item, ...prev.slice(i + 1)]
          })
        } else if (ev.type === 'turn_end') {
          setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)))
          setRunning(false)
          window.api.listSkills().then(setSkills)
          // 摄入任务：agent 写完了，主进程校验落盘出报告
          if (ingestRunRef.current) {
            window.api.wikiIngestFinish(ingestRunRef.current).then(setIngestReport)
          }
        } else if (ev.type === 'error') {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', text: t.chat.errorPrefix(ev.message) }
          ])
          setRunning(false)
        }
      }),
    [t]
  )

  useEffect(() => {
    window.api.listSkills().then(setSkills)
  }, [])

  const send = async (text: string): Promise<void> => {
    if (!text || running) return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setTools([])
    setInput('')
    setRunning(true)
    try {
      // 没连上就先连（比如设置里刚开、或进程死后第一次发）
      if (!connected) {
        await window.api.chatStart()
        setConnected(true)
      }
      await window.api.chatSend(text)
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', text: t.chat.sendFail(errText(e)) }])
      setConnected(false) // 标成未连接，下条消息自动重连
      setRunning(false)
    }
  }

  // 重开一轮对话：清界面状态 + 主进程换新 ACP 会话（进程保留，session 换新）。
  // bound = 这轮对话绑定的会话；null = 直接对话
  const resetChat = async (bound: SessionInfo | null): Promise<void> => {
    setMessages([])
    setTools([])
    setTask(null)
    setIngestRun(null)
    setIngestReport(null)
    setInput('')
    setContextSession(bound)
    if (connected) {
      try {
        await window.api.chatStart(true)
      } catch {
        setConnected(false) // 换新会话失败：标未连接，发送时自动重连
      }
    }
  }

  // 在看某个会话时发问：绑定的不是这个会话就先重开，再把这个会话的文件作为上下文带上
  const sendFromConversation = async (text: string, session: SessionInfo): Promise<void> => {
    if (!text || running) return
    if (contextSession?.id !== session.id) {
      await resetChat(session)
      await send(withSessionContext(text, session, t))
    } else {
      await send(text)
    }
  }

  const newChat = async (): Promise<void> => {
    if (running) return
    await resetChat(null)
  }

  // 点「提取 skill」：主进程拼好预填指令放进输入框，不自动发；没启用 ACP 就提示去设置
  const startExtract = async (s: SessionInfo): Promise<void> => {
    if (!settings?.acpEnabled) {
      setHintText(t.chat.enableFirstExtract)
      return
    }
    setHintText(null)
    // 任务换到别的会话：旧对话的上下文已经不适用，重开一轮
    if (contextSession?.id !== s.id && !running) await resetChat(s)
    else setContextSession(s)
    setTask(s)
    setTaskMode('extract')
    setIngestRun(null)
    setIngestReport(null)
    setInput(await window.api.skillExtractInstruction(s))
  }

  // 点「摄入知识库」：主进程 prepare（冻结转写 + 备份）后预填指令，不自动发
  const startIngest = async (s: SessionInfo): Promise<void> => {
    if (!settings?.acpEnabled) {
      setHintText(t.chat.enableFirstIngest)
      return
    }
    setHintText(null)
    try {
      const prep = await window.api.wikiIngestPrepare(s)
      if (prep.error || !prep.instruction || !prep.runId) {
        setHintText(t.chat.prepareFail(prep.error ?? ''))
        return
      }
      // 同 startExtract：任务换到别的会话就重开一轮对话
      if (contextSession?.id !== s.id && !running) await resetChat(s)
      else setContextSession(s)
      setTask(s)
      setTaskMode('ingest')
      setIngestRun(prep.runId)
      setIngestReport(null)
      setInput(prep.instruction)
    } catch (e) {
      setHintText(t.chat.prepareFail(errText(e)))
    }
  }

  const clearTask = (): void => {
    setTask(null)
    setIngestRun(null)
    setIngestReport(null)
  }

  // 摄入出问题时的回滚：用 prepare 前的备份覆盖回来
  const rollbackIngest = async (): Promise<void> => {
    if (!ingestReport) return
    if (!window.confirm(t.chat.rollbackConfirm)) return
    setIngestReport(await window.api.wikiIngestRollback(ingestReport.runId))
  }

  return (
    <ChatContext.Provider
      value={{
        messages,
        tools,
        running,
        connected,
        input,
        setInput,
        task,
        taskMode,
        ingestReport,
        skills,
        showSkills,
        hintText,
        clearHint: () => setHintText(null),
        chatViewOpen,
        setChatViewOpen,
        contextSession,
        send,
        sendFromConversation,
        newChat,
        startExtract,
        startIngest,
        clearTask,
        toggleSkills: () => setShowSkills((v) => !v),
        dismissReport: () => setIngestReport(null),
        rollbackIngest
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat 必须在 ChatProvider 内使用')
  return ctx
}

// 正在看某个会话时发问，把这个会话的文件作为上下文带上（只带这轮对话的第一条）
export function withSessionContext(
  text: string,
  session: SessionInfo,
  t: ReturnType<typeof useSettings>['t']
): string {
  return t.chat.contextPrefix(session.path, AGENT_LABELS[session.agent], text)
}
