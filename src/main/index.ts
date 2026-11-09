import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { listMemories, watchMemories } from './memories'
import { listSessions } from './sessions'
import { getSessionContent } from './sessions/content'
import { acpClient } from './acp/client'
import { buildExtractInstruction, ensureBundledSkills, listSkills } from './skills'
import { mainT } from './i18n'
import { getWikiPage, initWiki, listWiki, searchWikiPages, watchWiki } from './wiki'
import { finishIngest, prepareIngest, rollbackIngest } from './wiki/ingest'
import { latestLint, runLint } from './wiki/lint'
import { homedir } from 'node:os'
import { isAcpEnabled, saveSettings, toResult } from './settings'
import type { AcpConfigPatch, SessionInfo } from '../shared/types'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MeiQiu',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // agent 在外部改了记忆文件，通知界面刷新
  const unwatch = watchMemories(mainWindow.webContents)
  const unwatchWiki = watchWiki(mainWindow.webContents)
  mainWindow.on('closed', () => {
    unwatch()
    unwatchWiki()
  })

  // 外链用系统浏览器打开，不在 app 里开新窗口
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.meiqiu.app')
  // dev 下 dock 显示 Electron 本体，改成自己的名字和煤球图标
  app.setName('MeiQiu')
  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(join(app.getAppPath(), 'build', 'icon.png'))
  }

  // 开发时 F12 开 DevTools，生产环境屏蔽 Cmd+R
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 知识库：建 vault、重建索引、自检。失败不拖垮 app 启动
  try {
    initWiki()
  } catch (e) {
    console.error('[wiki] 初始化失败', e)
  }

  ipcMain.handle('memories:list', () => listMemories())
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:content', (_e, session: SessionInfo) => getSessionContent(session))
  ipcMain.handle('skills:list', () => listSkills())
  ipcMain.handle('skills:extract-instruction', (_e, session: SessionInfo) =>
    buildExtractInstruction(session)
  )

  // 知识库：页面列表 / 单页 / 全文搜索
  ipcMain.handle('wiki:list', () => listWiki())
  ipcMain.handle('wiki:page', (_e, slug: string) => getWikiPage(slug))
  ipcMain.handle('wiki:search', (_e, query: string) => searchWikiPages(query))
  // 摄入管线：prepare 预填指令；finish 在 turn_end 后校验落盘；rollback 用备份回滚
  ipcMain.handle('wiki:ingest-prepare', (_e, session: SessionInfo) => prepareIngest(session))
  ipcMain.handle('wiki:ingest-finish', (_e, runId: string) => finishIngest(runId))
  ipcMain.handle('wiki:ingest-rollback', (_e, runId: string) => rollbackIngest(runId))
  // 知识库体检
  ipcMain.handle('wiki:lint', () => runLint())
  ipcMain.handle('wiki:lint-latest', () => latestLint())

  // ACP 聊天：只有在设置里启用了才连；connect 复用已有会话
  ipcMain.handle('chat:start', async () => {
    if (!isAcpEnabled()) throw new Error(mainT('acpNotEnabled'))
    ensureBundledSkills()
    const sessionId = await acpClient.connect(homedir())
    return { sessionId }
  })
  ipcMain.handle('settings:get', () => toResult(acpClient.sessionId !== null))
  ipcMain.handle('settings:save', async (_e, patch: AcpConfigPatch) => {
    // 连接相关的配置变了就断开重连
    saveSettings(patch)
    acpClient.dispose()
    if (isAcpEnabled()) {
      try {
        ensureBundledSkills()
        await acpClient.connect(homedir())
      } catch {
        // 连接失败由 connected=false 体现
      }
    }
    return toResult(acpClient.sessionId !== null)
  })
  ipcMain.handle('chat:send', async (_e, text: string) => {
    // 连接可能已死（CLI 重装、进程崩了）：发消息时自动重连一次
    if (!acpClient.sessionId) {
      if (!isAcpEnabled()) throw new Error(mainT('acpNotEnabled'))
      ensureBundledSkills()
      await acpClient.connect(homedir())
    }
    await acpClient.prompt(text)
  })
  ipcMain.handle('acp:models', () => acpClient.getModels())

  acpClient.on('event', (ev) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('chat:event', ev)
    }
  })
  // adapter 的 stderr / 进程退出打到主进程控制台，排查连接问题用
  acpClient.on('log', (msg) => console.error('[acp]', msg))

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
