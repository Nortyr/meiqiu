import { openSync, readSync, closeSync } from 'node:fs'

// 只读文件开头一段（会话元信息通常在开头，不用整读）。读失败返回 undefined
export function readFileHead(path: string, budget: number): string | undefined {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(budget)
    const n = readSync(fd, buf, 0, budget, 0)
    if (n === 0) return undefined
    return buf.toString('utf8', 0, n)
  } catch {
    return undefined
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // 已关闭
      }
    }
  }
}
