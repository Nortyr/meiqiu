import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative as relativePath, resolve } from 'node:path'
import type {
  AcpProvider,
  PermissionRequest,
  WorkflowPlanDraft,
  WorkflowPlanRequest,
  WorkflowStep,
  WorkflowVerifier
} from '../../shared/types'
import { AcpClient } from '../acp/client'
import {
  acpProvider,
  acpSavedModel,
  getSettings,
  harnessPermissionInfo,
  isProviderEnabled
} from '../settings'

const ROOT = join(homedir(), '.meiqiu', 'workflow-drafts')
const STEP_TYPES = new Set(['agent', 'verify'])
const VERIFIER_TYPES = new Set(['command', 'artifact', 'diff'])

function projectFingerprint(cwd: string): string | null {
  try {
    const status = execFileSync('/usr/bin/git', ['status', '--porcelain', '-z'], {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 2 * 1024 * 1024
    })
    const diff = execFileSync('/usr/bin/git', ['diff', '--binary', '--no-ext-diff'], {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024
    })
    return createHash('sha256').update(status).update('\0').update(diff).digest('hex')
  } catch {
    return null
  }
}

function workspaceFingerprint(cwd: string): string {
  const gitFingerprint = projectFingerprint(cwd)
  if (gitFingerprint !== null) return `git:${gitFingerprint}`
  return `tree:${directoryFingerprint(cwd)}`
}

function directoryFingerprint(root: string): string {
  const hash = createHash('sha256')
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    for (const entry of entries) {
      if (entry.name === '.git') continue
      const path = join(directory, entry.name)
      const relative = relativePath(root, path)
      hash.update(entry.isDirectory() ? `d:${relative}\0` : `f:${relative}\0`)
      if (entry.isDirectory()) visit(path)
      else {
        const stats = statSync(path)
        hash.update(`${stats.size}:${stats.mtimeMs}\0`)
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}

export interface PlanHooks {
  onPermission: (request: PermissionRequest, client: AcpClient) => void
  onLog?: (message: string) => void
}

function providerModel(provider: AcpProvider): string {
  const settings = getSettings()
  return provider === 'claude-code' ? (settings.acpModel ?? '') : acpSavedModel(provider)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(min, Math.min(max, n))
}

export function validatePlanArtifact(
  raw: unknown,
  meta: {
    id: string
    brief: string
    cwd: string
    provider: AcpProvider
    model?: string
    permissionMode?: string
    permissionConfigPath?: string
    createdAt: string
  }
): WorkflowPlanDraft {
  const obj = asRecord(raw, 'plan')
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  if (rawSteps.length < 2 || rawSteps.length > 20) {
    throw new Error('plan.steps must contain 2-20 steps')
  }

  const usedStepIds = new Set<string>()
  const steps: WorkflowStep[] = rawSteps.map((value, index) => {
    const step = asRecord(value, `steps[${index}]`)
    const type = nonEmpty(step.type, `steps[${index}].type`)
    if (!STEP_TYPES.has(type)) throw new Error(`steps[${index}].type is not supported in v1`)
    let id = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : `step-${index + 1}`
    if (usedStepIds.has(id)) id = `step-${index + 1}`
    usedStepIds.add(id)
    return {
      id,
      index,
      type: type as WorkflowStep['type'],
      text: nonEmpty(step.text, `steps[${index}].text`),
      verifierIds: Array.isArray(step.verifierIds)
        ? step.verifierIds.filter((x): x is string => typeof x === 'string')
        : undefined
    }
  })

  if (!steps.some((s) => s.type === 'agent')) throw new Error('plan needs an agent step')
  if (!steps.some((s) => s.type === 'verify')) throw new Error('plan needs a verify step')

  const rawVerifiers = Array.isArray(obj.verifiers) ? obj.verifiers : []
  if (rawVerifiers.length === 0 || rawVerifiers.length > 10) {
    throw new Error('plan.verifiers must contain 1-10 verifiers')
  }
  const usedVerifierIds = new Set<string>()
  const verifiers: WorkflowVerifier[] = rawVerifiers.map((value, index) => {
    const verifier = asRecord(value, `verifiers[${index}]`)
    const type = nonEmpty(verifier.type, `verifiers[${index}].type`)
    if (!VERIFIER_TYPES.has(type)) {
      throw new Error(`verifiers[${index}].type is not supported in v1`)
    }
    let id =
      typeof verifier.id === 'string' && verifier.id.trim()
        ? verifier.id.trim()
        : `verifier-${index + 1}`
    if (usedVerifierIds.has(id)) id = `verifier-${index + 1}`
    usedVerifierIds.add(id)
    const item: WorkflowVerifier = {
      id,
      type: type as WorkflowVerifier['type'],
      name: nonEmpty(verifier.name, `verifiers[${index}].name`),
      timeoutMs: clampInt(verifier.timeoutMs, 120_000, 1_000, 30 * 60_000)
    }
    if (type === 'command') item.command = nonEmpty(verifier.command, `${id}.command`)
    if (type === 'artifact') item.path = nonEmpty(verifier.path, `${id}.path`)
    if (type === 'diff' && Array.isArray(verifier.denyPaths)) {
      item.denyPaths = verifier.denyPaths.filter((x): x is string => typeof x === 'string')
    }
    return item
  })

  const knownVerifierIds = new Set(verifiers.map((v) => v.id))
  for (const step of steps) {
    for (const id of step.verifierIds ?? []) {
      if (!knownVerifierIds.has(id))
        throw new Error(`step ${step.id} references unknown verifier ${id}`)
    }
  }
  const verifySteps = steps.filter((s) => s.type === 'verify')
  if (verifySteps.every((s) => !s.verifierIds?.length)) {
    verifySteps[verifySteps.length - 1].verifierIds = verifiers.map((v) => v.id)
  }

  const retry = asRecord(obj.retryPolicy ?? {}, 'retryPolicy')
  const retryFromStepId =
    typeof retry.retryFromStepId === 'string' && usedStepIds.has(retry.retryFromStepId)
      ? retry.retryFromStepId
      : (steps.find((s) => s.type === 'agent')?.id ?? steps[0].id)

  const permissionInfo = harnessPermissionInfo(meta.provider)
  return {
    id: meta.id,
    version: 1,
    name: nonEmpty(obj.name, 'plan.name'),
    brief: meta.brief,
    goal: nonEmpty(obj.goal, 'plan.goal'),
    cwd: meta.cwd,
    provider: meta.provider,
    model: meta.model || providerModel(meta.provider) || undefined,
    permissionMode: meta.permissionMode || permissionInfo.mode,
    permissionConfigPath: meta.permissionConfigPath || permissionInfo.configPath,
    steps,
    verifiers,
    retryPolicy: {
      retryFromStepId,
      maxRounds: clampInt(retry.maxRounds, 3, 1, 10),
      maxMinutes: clampInt(retry.maxMinutes, 30, 1, 240)
    },
    forbidden: Array.isArray(obj.forbidden)
      ? obj.forbidden.filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
      : [],
    createdAt: meta.createdAt
  }
}

function planningPrompt(brief: string, planPath: string): string {
  return `你是 Meiqiu 的计划编译器。请先只读检查当前工作目录，再把用户的完整委托拆成可执行计划。\n\n用户委托：\n${brief}\n\n硬约束：\n- 这是规划阶段，不得修改当前工作目录中的任何文件，不得提交、push、部署、发消息或产生外部副作用。\n- 唯一允许写入的文件是：${planPath}\n- v1 只允许 agent 和 verify 两种步骤。步骤保持 2-8 条，面向用户写清楚。\n- verify 必须引用至少一个机器可判定的 verifier。若工作目录是代码项目，优先使用已有的 typecheck、lint、test 或 build 命令，不要杜撰不存在的脚本；非代码任务优先使用 artifact verifier 检查约定产物是否存在。\n- command verifier 会由 Meiqiu 在用户确认后原样执行，所以命令必须具体、最小且不修改项目。\n- forbidden 是声明边界，至少包含“不自动提交”和“不 push”。\n\n请把下面结构的纯 JSON 写入指定文件，不要用 Markdown 包裹：\n{\n  "name": "简短任务名",\n  "goal": "明确的完成目标",\n  "steps": [\n    {"id":"step-1","type":"agent","text":"..."},\n    {"id":"step-2","type":"verify","text":"...","verifierIds":["check-1"]}\n  ],\n  "verifiers": [\n    {"id":"check-1","type":"command","name":"类型与测试检查","command":"npm run typecheck && npm test","timeoutMs":120000}\n  ],\n  "retryPolicy":{"retryFromStepId":"step-1","maxRounds":3,"maxMinutes":30},\n  "forbidden":["不自动提交","不 push"]\n}\n\n写完后只回复计划文件已经生成。`
}

export async function generatePlan(
  request: WorkflowPlanRequest,
  hooks: PlanHooks
): Promise<WorkflowPlanDraft> {
  const brief = request.brief.trim()
  if (!brief) throw new Error('请先描述目标、方案或限制')
  const cwd = resolve(request.cwd)
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('工作目录不存在')

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const draftDir = join(ROOT, id)
  const planPath = join(draftDir, 'plan.json')
  mkdirSync(draftDir, { recursive: true })
  writeFileSync(join(draftDir, 'brief.txt'), brief)

  const provider = acpProvider()
  if (!isProviderEnabled(provider)) throw new Error('当前 Harness 未启用')
  const beforeFingerprint = workspaceFingerprint(cwd)
  const client = new AcpClient(provider)
  client.on('permission', (permission: PermissionRequest) => hooks.onPermission(permission, client))
  client.on('log', (message) => hooks.onLog?.(String(message)))
  try {
    await client.connect(cwd)
    await client.prompt(planningPrompt(brief, planPath))
    let error: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!existsSync(planPath)) throw new Error('Planner did not create plan.json')
        const raw = JSON.parse(readFileSync(planPath, 'utf8')) as unknown
        const plan = validatePlanArtifact(raw, { id, brief, cwd, provider, createdAt })
        const afterFingerprint = workspaceFingerprint(cwd)
        if (afterFingerprint !== beforeFingerprint) {
          throw new Error(
            'Planner modified the working directory during the read-only planning phase'
          )
        }
        writeFileSync(planPath, JSON.stringify(plan, null, 2))
        return plan
      } catch (e) {
        error = e
        if (
          e instanceof Error &&
          e.message === 'Planner modified the working directory during the read-only planning phase'
        ) {
          throw e
        }
        if (attempt === 0) {
          await client.prompt(
            `计划文件校验失败：${e instanceof Error ? e.message : String(e)}。请只修复 ${planPath}，仍然不要修改工作目录中的文件。`
          )
        }
      }
    }
    throw error
  } finally {
    client.dispose()
  }
}
