import type { WebContents } from 'electron'
import type { WikiListResult, WikiPage, WikiSearchHit } from '../../shared/types'
import { ensureVault, getVaultPath, readPage } from './vault'
import { ftsSelfCheck, listWikiPages, rebuildWikiIndex, searchWiki } from './store'
import { watchAndNotify } from '../watch'

// 启动时初始化：建 vault、重建索引、自检。知识库挂了不拖垮 app 启动
export function initWiki(): void {
  ensureVault()
  const count = rebuildWikiIndex()
  console.log(
    `[wiki] vault: ${getVaultPath()}，页面 ${count} 条，FTS trigram 自检${ftsSelfCheck() ? '通过' : '失败'}`
  )
}

export function listWiki(): WikiListResult {
  return { pages: listWikiPages(), vaultPath: getVaultPath(), ftsOk: ftsSelfCheck() }
}

export function getWikiPage(slug: string): WikiPage | null {
  return readPage(slug)
}

export function searchWikiPages(query: string): WikiSearchHit[] {
  return searchWiki(query)
}

// 监听 vault：agent 或人在外部改了页面，重建索引并通知界面刷新
export function watchWiki(sender: WebContents): () => void {
  return watchAndNotify(sender, [getVaultPath()], 'wiki:changed', {
    debounceMs: 500,
    minIntervalMs: 5000,
    beforeSend: () => {
      rebuildWikiIndex()
    }
  })
}
