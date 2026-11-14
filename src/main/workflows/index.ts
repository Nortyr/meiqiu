import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type {
  PermissionDecision,
  PermissionRequest,
  WorkflowCapability,
  WorkflowPlanDraft,
  WorkflowPlanRequest,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepRun
} from '../../shared/types'
import { AcpClient, type CollectedPrompt } from '../acp/client'
import { isProviderEnabled } from '../settings'
import { generatePlan, validatePlanArtifact } from './plan'
import { runVerifier, type VerifierResult } from './verifier'
import {
  appendEvent,
  createWorkflowRun,
  finishStepRun,
  getWorkflowRun,
  insertStepRun,
  listCapabilities,
  listWorkflowRuns,
  saveCapability,
  updateWorkflowRun
} from './store'

const RUNS_ROOT = join(homedir(), '.meiqiu', 'runs')
const WORKSPACES_ROOT = join(homedir(), '.meiqiu', 'workspaces')

interface ActiveRun {
  client: AcpClient
  cancelled: boolean
}

function now(): string {
  return new Date().toISOString()
}

function workspaceName(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-')
  return `task-${stamp}-${crypto.randomUUID().slice(0, 8)}`
}

function gitEvidence(cwd: string): { status: string; diff: string } {
  try {
    return {
      status: execFileSync('/usr/bin/git', ['status', '--short'], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024
      }),
      diff: execFileSync('/usr/bin/git', ['diff', '--binary', '--no-ext-diff'], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 5 * 1024 * 1024
      })
    }
  } catch (error) {
    return { status: '', diff: `Git evidence unavailable: ${String(error)}` }
  }
}

function agentPrompt(
  plan: WorkflowPlanDraft,
  step: WorkflowStep,
  round: number,
  feedback: VerifierResult[]
): string {
  const failed = feedback.filter((r) => !r.passed)
  return `你正在执行 Meiqiu 已由用户确认并冻结的计划。\n\n完整委托：\n${plan.brief}\n\n最终目标：\n${plan.goal}\n\n当前是第 ${round} 轮，第 ${step.index + 1} 步：\n${step.text}\n\n声明边界：\n${plan.forbidden.length ? plan.forbidden.map((x) => `- ${x}`).join('\n') : '- 无额外声明'}\n${
    failed.length
      ? `\n上一轮未通过的验收：\n${failed.map((r) => `- ${r.name}: ${r.summary}\n${r.output.slice(0, 4000)}`).join('\n')}`
      : ''
  }\n\n只完成当前步骤。允许修改当前项目，但不要自行提交、push、部署或发送外部消息。完成后说明改了什么以及留下了哪些证据。`
}

export class WorkflowService extends EventEmitter {
  private active: { runId: string; state: ActiveRun } | null = null
  private queue: WorkflowRun[] = []
  private permissionOwners = new Map<string, { client: AcpClient; runId?: string }>()

  async plan(request: WorkflowPlanRequest): Promise<WorkflowPlanDraft> {
    return generatePlan(request, {
      onPermission: (permission, client) => this.forwardPermission(permission, client),
      onLog: (message) => this.emit('log', message)
    })
  }

  createWorkspace(): string {
    const workspace = join(WORKSPACES_ROOT, workspaceName())
    mkdirSync(workspace, { recursive: true })
    return workspace
  }

  start(input: WorkflowPlanDraft): WorkflowRun {
    if (!isProviderEnabled(input.provider)) throw new Error('计划绑定的 Harness 当前未启用')
    if (!existsSync(input.cwd) || !statSync(input.cwd).isDirectory()) {
      throw new Error('计划绑定的工作目录不存在')
    }
    // renderer 属于不可信边界：开始前重新校验计划，而不是直接执行传来的命令。
    const plan = validatePlanArtifact(input, {
      id: input.id,
      brief: input.brief,
      cwd: input.cwd,
      provider: input.provider,
      model: input.model,
      permissionMode: input.permissionMode,
      permissionConfigPath: input.permissionConfigPath,
      createdAt: input.createdAt
    })
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      planId: plan.id,
      planVersion: plan.version,
      plan,
      status: 'queued',
      round: 1,
      startedAt: now(),
      stepRuns: []
    }
    const runDir = join(RUNS_ROOT, run.id)
    mkdirSync(join(runDir, 'steps'), { recursive: true })
    writeFileSync(join(runDir, 'brief.txt'), plan.brief)
    writeFileSync(join(runDir, 'plan.json'), JSON.stringify(plan, null, 2))
    writeFileSync(join(runDir, 'baseline.json'), JSON.stringify(gitEvidence(plan.cwd), null, 2))
    createWorkflowRun(run)
    this.queue.push(run)
    this.emitChanged(run.id)
    this.pump()
    return run
  }

  private pump(): void {
    if (this.active) return
    const run = this.queue.shift()
    if (!run) return
    const client = new AcpClient(run.plan.provider, run.plan.model)
    const state: ActiveRun = { client, cancelled: false }
    this.active = { runId: run.id, state }
    client.on('permission', (request: PermissionRequest) => {
      appendEvent(run.id, 'permission-requested', request)
      this.forwardPermission(request, client, run.id)
    })
    client.on('log', (message) => appendEvent(run.id, 'acp-log', { message: String(message) }))
    void this.execute(run, state).finally(() => {
      client.dispose()
      if (this.active?.runId === run.id) this.active = null
      this.emitChanged(run.id)
      this.pump()
    })
  }

  private async execute(run: WorkflowRun, active: ActiveRun): Promise<void> {
    const plan = run.plan
    const runDir = join(RUNS_ROOT, run.id)
    const startedMs = Date.now()
    const deadlineMs = startedMs + plan.retryPolicy.maxMinutes * 60_000
    const retryIndex = Math.max(
      0,
      plan.steps.findIndex((step) => step.id === plan.retryPolicy.retryFromStepId)
    )
    let feedback: VerifierResult[] = []
    updateWorkflowRun(run.id, { status: 'running' })
    appendEvent(run.id, 'run-started')
    this.emitChanged(run.id)

    try {
      await active.client.connect(plan.cwd)
      for (let round = 1; round <= plan.retryPolicy.maxRounds; round++) {
        if (Date.now() - startedMs > plan.retryPolicy.maxMinutes * 60_000) {
          throw new Error(`达到最长时间 ${plan.retryPolicy.maxMinutes} 分钟`)
        }
        updateWorkflowRun(run.id, { round })
        appendEvent(run.id, 'round-started', { round })
        let stepIndex = round === 1 ? 0 : retryIndex
        let shouldRetry = false

        for (; stepIndex < plan.steps.length; stepIndex++) {
          if (active.cancelled) throw new CancelledError()
          const step = plan.steps[stepIndex]
          updateWorkflowRun(run.id, { currentStepId: step.id, round })
          this.emitChanged(run.id)
          const result = await this.executeStep(
            run.id,
            runDir,
            plan,
            step,
            round,
            feedback,
            active,
            deadlineMs
          )
          if (!result.passed) {
            feedback = result.verifiers
            shouldRetry = true
            appendEvent(run.id, 'verification-failed', {
              stepId: step.id,
              round,
              results: result.verifiers.map((r) => ({
                verifierId: r.verifierId,
                passed: r.passed,
                summary: r.summary
              }))
            })
            break
          }
        }

        if (!shouldRetry) {
          const reportPath = join(runDir, 'report.json')
          writeFileSync(
            reportPath,
            JSON.stringify(
              {
                runId: run.id,
                status: 'succeeded',
                completedAt: now(),
                rounds: round,
                evidence: gitEvidence(plan.cwd)
              },
              null,
              2
            )
          )
          updateWorkflowRun(run.id, {
            status: 'succeeded',
            currentStepId: null,
            completedAt: now(),
            reportPath
          })
          appendEvent(run.id, 'run-succeeded', { round })
          return
        }
      }

      const error = `验收未通过，已达到 ${plan.retryPolicy.maxRounds} 轮上限`
      updateWorkflowRun(run.id, { status: 'failed', completedAt: now(), error })
      appendEvent(run.id, 'run-failed', { error })
    } catch (error) {
      if (error instanceof CancelledError) {
        updateWorkflowRun(run.id, { status: 'cancelled', completedAt: now(), error: '用户取消' })
        appendEvent(run.id, 'run-cancelled')
      } else {
        // Agent 可能已经产生本地副作用但响应丢失；不能盲目重发。
        const message = error instanceof Error ? error.message : String(error)
        updateWorkflowRun(run.id, {
          status: 'needs_reconciliation',
          completedAt: now(),
          error: message
        })
        appendEvent(run.id, 'run-needs-reconciliation', { error: message })
      }
    }
  }

  private async executeStep(
    runId: string,
    runDir: string,
    plan: WorkflowPlanDraft,
    step: WorkflowStep,
    round: number,
    feedback: VerifierResult[],
    active: ActiveRun,
    deadlineMs: number
  ): Promise<{ passed: boolean; verifiers: VerifierResult[] }> {
    const stepRunId = crypto.randomUUID()
    const stepDir = join(runDir, 'steps', stepRunId)
    mkdirSync(stepDir, { recursive: true })
    const inputPath = join(stepDir, 'input.json')
    writeFileSync(inputPath, JSON.stringify({ step, round, feedback }, null, 2))
    const stepRun: WorkflowStepRun = {
      id: stepRunId,
      stepId: step.id,
      stepIndex: step.index,
      round,
      status: 'running',
      startedAt: now(),
      inputRef: inputPath
    }
    insertStepRun(stepRun, runId)
    appendEvent(runId, 'step-started', { stepRunId, stepId: step.id, round })

    try {
      if (step.type === 'agent') {
        const before = gitEvidence(plan.cwd)
        writeFileSync(join(stepDir, 'before.json'), JSON.stringify(before, null, 2))
        const remainingMs = deadlineMs - Date.now()
        if (remainingMs <= 0) throw new Error(`达到最长时间 ${plan.retryPolicy.maxMinutes} 分钟`)
        const result: CollectedPrompt = await active.client.promptCollect(
          agentPrompt(plan, step, round, feedback),
          remainingMs
        )
        if (active.cancelled) throw new CancelledError()
        const outputPath = join(stepDir, 'output.md')
        const logPath = join(stepDir, 'tools.json')
        writeFileSync(outputPath, result.text)
        writeFileSync(logPath, JSON.stringify(result.tools, null, 2))
        writeFileSync(join(stepDir, 'after.json'), JSON.stringify(gitEvidence(plan.cwd), null, 2))
        finishStepRun(stepRunId, 'succeeded', { outputRef: outputPath, rawLogPath: logPath })
        appendEvent(runId, 'step-succeeded', { stepRunId, stepId: step.id })
        this.emitChanged(runId)
        return { passed: true, verifiers: [] }
      }

      if (step.type === 'verify') {
        const ids = step.verifierIds?.length
          ? new Set(step.verifierIds)
          : new Set(plan.verifiers.map((v) => v.id))
        const verifiers = plan.verifiers.filter((v) => ids.has(v.id))
        const results: VerifierResult[] = []
        for (const verifier of verifiers) {
          if (active.cancelled) throw new CancelledError()
          const remainingMs = deadlineMs - Date.now()
          if (remainingMs <= 0) throw new Error(`达到最长时间 ${plan.retryPolicy.maxMinutes} 分钟`)
          results.push(await runVerifier(verifier, plan.cwd, remainingMs))
        }
        const outputPath = join(stepDir, 'verifier-results.json')
        writeFileSync(outputPath, JSON.stringify(results, null, 2))
        const passed = results.length > 0 && results.every((result) => result.passed)
        finishStepRun(stepRunId, passed ? 'succeeded' : 'failed', {
          outputRef: outputPath,
          rawLogPath: outputPath,
          error: passed
            ? undefined
            : results
                .filter((r) => !r.passed)
                .map((r) => r.summary)
                .join('；')
        })
        appendEvent(runId, passed ? 'step-succeeded' : 'step-failed', {
          stepRunId,
          stepId: step.id
        })
        this.emitChanged(runId)
        return { passed, verifiers: results }
      }

      throw new Error(`v1 尚不支持 ${step.type} 步骤`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finishStepRun(stepRunId, error instanceof CancelledError ? 'cancelled' : 'failed', {
        error: message
      })
      this.emitChanged(runId)
      throw error
    }
  }

  getRun(runId: string): WorkflowRun | null {
    return getWorkflowRun(runId)
  }

  listRuns(): WorkflowRun[] {
    return listWorkflowRuns()
  }

  cancel(runId: string): void {
    if (this.active?.runId === runId) {
      this.active.state.cancelled = true
      this.active.state.client.cancelPrompt()
      appendEvent(runId, 'cancel-requested')
      return
    }
    const queued = this.queue.findIndex((run) => run.id === runId)
    if (queued >= 0) {
      this.queue.splice(queued, 1)
      updateWorkflowRun(runId, { status: 'cancelled', completedAt: now(), error: '用户取消' })
      appendEvent(runId, 'run-cancelled')
      this.emitChanged(runId)
    }
  }

  readArtifact(runId: string, path: string): string {
    const root = resolve(RUNS_ROOT, runId)
    const target = resolve(path)
    if (!target.startsWith(`${root}${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
      throw new Error('产物路径无效')
    }
    const size = statSync(target).size
    if (size > 1024 * 1024)
      return `${readFileSync(target, 'utf8').slice(0, 1024 * 1024)}\n[truncated]`
    return readFileSync(target, 'utf8')
  }

  saveCapability(runId: string): WorkflowCapability {
    return saveCapability(runId)
  }

  listCapabilities(): WorkflowCapability[] {
    return listCapabilities()
  }

  respondPermission(decision: PermissionDecision): boolean {
    const owner = this.permissionOwners.get(decision.requestId)
    if (!owner) return false
    this.permissionOwners.delete(decision.requestId)
    const handled = owner.client.respondPermission(decision)
    if (handled && owner.runId) {
      appendEvent(owner.runId, 'permission-decided', {
        requestId: decision.requestId,
        optionId: decision.optionId,
        cancelled: decision.cancelled === true
      })
    }
    return handled
  }

  private forwardPermission(request: PermissionRequest, client: AcpClient, runId?: string): void {
    this.permissionOwners.set(request.requestId, { client, runId })
    const clear = (resolvedId?: string): void => {
      if (resolvedId !== undefined && resolvedId !== request.requestId) return
      if (this.permissionOwners.get(request.requestId)?.client === client) {
        this.permissionOwners.delete(request.requestId)
      }
      client.off('permission-resolved', clear)
      client.off('disposed', clear)
    }
    client.on('permission-resolved', clear)
    client.on('disposed', clear)
    this.emit('permission', request)
  }

  private emitChanged(runId: string): void {
    this.emit('changed', runId)
  }
}

class CancelledError extends Error {}

export const workflowService = new WorkflowService()

export function ensureWorkflowStore(): void {
  // 触发 store 初始化，并把上次未结束的 Run 标为 interrupted / needs_reconciliation。
  listWorkflowRuns(1)
}
