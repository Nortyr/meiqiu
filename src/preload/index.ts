import { contextBridge, ipcRenderer } from 'electron'
import type { MeiqiuApi } from '../shared/types'

// 开了 sandbox，preload 只能用 electron 自带的模块，界面只能调这里列出的接口
const api: MeiqiuApi = {
  listMemories: () => ipcRenderer.invoke('memories:list'),
  onMemoriesChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('memories:changed', listener)
    return () => ipcRenderer.removeListener('memories:changed', listener)
  },
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  onSessionsChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('sessions:changed', listener)
    return () => ipcRenderer.removeListener('sessions:changed', listener)
  },
  getSessionContent: (session) => ipcRenderer.invoke('sessions:content', session),
  chatStart: (forceNew?: boolean) => ipcRenderer.invoke('chat:start', forceNew),
  chatSend: (text) => ipcRenderer.invoke('chat:send', text),
  onChatEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: Parameters<typeof cb>[0]): void => cb(ev)
    ipcRenderer.on('chat:event', listener)
    return () => ipcRenderer.removeListener('chat:event', listener)
  },
  onPermissionRequest: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, request: Parameters<typeof cb>[0]): void =>
      cb(request)
    ipcRenderer.on('permission:request', listener)
    return () => ipcRenderer.removeListener('permission:request', listener)
  },
  respondPermission: (decision) => ipcRenderer.invoke('permission:respond', decision),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  skillExtractInstruction: (session) => ipcRenderer.invoke('skills:extract-instruction', session),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  acpModels: () => ipcRenderer.invoke('acp:models'),
  wikiList: () => ipcRenderer.invoke('wiki:list'),
  wikiPage: (slug) => ipcRenderer.invoke('wiki:page', slug),
  wikiSearch: (query) => ipcRenderer.invoke('wiki:search', query),
  onWikiChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('wiki:changed', listener)
    return () => ipcRenderer.removeListener('wiki:changed', listener)
  },
  wikiIngestPrepare: (session) => ipcRenderer.invoke('wiki:ingest-prepare', session),
  wikiIngestFinish: (runId) => ipcRenderer.invoke('wiki:ingest-finish', runId),
  wikiIngestRollback: (runId) => ipcRenderer.invoke('wiki:ingest-rollback', runId),
  wikiLint: () => ipcRenderer.invoke('wiki:lint'),
  wikiLintLatest: () => ipcRenderer.invoke('wiki:lint-latest'),
  workflowPlan: (request) => ipcRenderer.invoke('workflow:plan', request),
  workflowCreateWorkspace: () => ipcRenderer.invoke('workflow:create-workspace'),
  workflowStart: (plan) => ipcRenderer.invoke('workflow:start', plan),
  workflowGetRun: (runId) => ipcRenderer.invoke('workflow:get-run', runId),
  workflowListRuns: () => ipcRenderer.invoke('workflow:list-runs'),
  workflowCancel: (runId) => ipcRenderer.invoke('workflow:cancel', runId),
  workflowReadArtifact: (runId, path) => ipcRenderer.invoke('workflow:read-artifact', runId, path),
  workflowSaveCapability: (runId) => ipcRenderer.invoke('workflow:save-capability', runId),
  workflowListCapabilities: () => ipcRenderer.invoke('workflow:list-capabilities'),
  onWorkflowChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, runId: string): void => cb(runId)
    ipcRenderer.on('workflow:changed', listener)
    return () => ipcRenderer.removeListener('workflow:changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
