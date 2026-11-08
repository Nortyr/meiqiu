import { watch, existsSync, type FSWatcher } from 'node:fs'
import type { WebContents } from 'electron'

interface WatchNotifyOptions {
  // 变更后攒多久再发（会话文件一直在写，太短会刷爆界面）
  debounceMs: number
  // 同一频道两次通知的最小间隔
  minIntervalMs: number
  // 发通知前要做的事（比如清缓存、重建索引）；抛错会被吞掉，下次变更再试
  beforeSend?: () => void
}

// 监听一组目录，有变更就去抖 + 限频后往界面发 channel。
// 返回取消函数（关 watcher、清定时器）。监听失败只是少了自动刷新，不影响功能
export function watchAndNotify(
  sender: WebContents,
  dirs: string[],
  channel: string,
  opts: WatchNotifyOptions
): () => void {
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  let lastSent = 0

  const notify = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const now = Date.now()
      if (now - lastSent < opts.minIntervalMs) return
      lastSent = now
      try {
        opts.beforeSend?.()
      } catch {
        // beforeSend 失败不挡通知，下次变更会再试
      }
      if (!sender.isDestroyed()) sender.send(channel)
    }, opts.debounceMs)
  }

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    try {
      watchers.push(watch(dir, { recursive: true }, notify))
    } catch {
      // 某个目录监听失败不影响其他目录
    }
  }

  return () => {
    if (timer) clearTimeout(timer)
    for (const w of watchers) w.close()
  }
}
