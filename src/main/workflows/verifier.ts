import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { WorkflowVerifier } from '../../shared/types'

const OUTPUT_LIMIT = 1024 * 1024

export interface VerifierResult {
  verifierId: string
  name: string
  passed: boolean
  summary: string
  output: string
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<VerifierResult> {
  return new Promise((resolveResult) => {
    const child = spawn('/bin/zsh', ['-lc', command], {
      cwd,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let truncated = false
    const append = (chunk: Buffer): void => {
      if (output.length >= OUTPUT_LIMIT) {
        truncated = true
        return
      }
      output += chunk.toString().slice(0, OUTPUT_LIMIT - output.length)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveResult({
        verifierId: '',
        name: '',
        passed: false,
        summary: error.message,
        output
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (truncated) output += '\n[output truncated by Meiqiu]'
      resolveResult({
        verifierId: '',
        name: '',
        passed: !timedOut && code === 0,
        summary: timedOut ? `超时（${timeoutMs}ms）` : `退出码 ${code ?? 'unknown'}`,
        output
      })
    })
  })
}

function gitChangedPaths(cwd: string): Promise<string[]> {
  return new Promise((resolvePaths) => {
    execFile('/usr/bin/git', ['status', '--porcelain', '-z'], { cwd }, (error, stdout) => {
      if (error) {
        resolvePaths([])
        return
      }
      const paths = stdout
        .split('\0')
        .filter(Boolean)
        .map((line) => line.slice(3))
        .filter(Boolean)
      resolvePaths(paths)
    })
  })
}

export async function runVerifier(
  verifier: WorkflowVerifier,
  cwd: string,
  remainingMs = Number.MAX_SAFE_INTEGER
): Promise<VerifierResult> {
  if (verifier.type === 'command') {
    const timeoutMs = Math.max(1_000, Math.min(verifier.timeoutMs ?? 120_000, remainingMs))
    const result = await runCommand(verifier.command ?? '', cwd, timeoutMs)
    return { ...result, verifierId: verifier.id, name: verifier.name }
  }

  if (verifier.type === 'artifact') {
    const path = isAbsolute(verifier.path ?? '')
      ? resolve(verifier.path ?? '')
      : resolve(cwd, verifier.path ?? '')
    const exists = Boolean(verifier.path) && existsSync(path)
    const hashMatches =
      exists && verifier.expectedHash ? sha256(path) === verifier.expectedHash : true
    return {
      verifierId: verifier.id,
      name: verifier.name,
      passed: exists && hashMatches,
      summary: !exists
        ? `产物不存在：${path}`
        : hashMatches
          ? `产物存在：${path}`
          : '产物 hash 不匹配',
      output: exists && verifier.expectedHash ? `sha256=${sha256(path)}` : path
    }
  }

  if (verifier.type === 'diff') {
    const paths = await gitChangedPaths(cwd)
    const denied = paths.filter((path) =>
      (verifier.denyPaths ?? []).some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    )
    return {
      verifierId: verifier.id,
      name: verifier.name,
      passed: denied.length === 0,
      summary: denied.length ? `改动了禁止路径：${denied.join('、')}` : '改动范围通过',
      output: paths.join('\n')
    }
  }

  return {
    verifierId: verifier.id,
    name: verifier.name,
    passed: false,
    summary: `v1 尚不支持 ${verifier.type} 验收器`,
    output: ''
  }
}
