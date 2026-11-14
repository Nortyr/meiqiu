import type {
  WorkflowCapability,
  WorkflowPlanDraft,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun
} from '../../shared/types'
import { getDb } from '../wiki/store'

let initialized = false

function init(): void {
  if (initialized) return
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_plans (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      PRIMARY KEY (id, version)
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      plan_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_step_id TEXT,
      round INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      error TEXT,
      report_path TEXT,
      plan_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_step_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      round INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      input_ref TEXT,
      output_ref TEXT,
      raw_log_path TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS workflow_capabilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_run_id TEXT NOT NULL UNIQUE,
      plan_json TEXT NOT NULL
    );
  `)
  // v1 不盲目自动重放：执行中的 Run 可能已经产生副作用，必须人工核对。
  const stoppedAt = new Date().toISOString()
  db.prepare(
    "UPDATE workflow_runs SET status = 'needs_reconciliation', completed_at = ?, error = COALESCE(error, 'App exited while an action may have been in flight') WHERE status = 'running'"
  ).run(stoppedAt)
  db.prepare(
    "UPDATE workflow_runs SET status = 'interrupted', completed_at = ?, error = COALESCE(error, 'App exited before execution started') WHERE status = 'queued'"
  ).run(stoppedAt)
  initialized = true
}

export function savePlan(plan: WorkflowPlanDraft): void {
  init()
  getDb()
    .prepare(
      'INSERT OR REPLACE INTO workflow_plans (id, version, created_at, plan_json) VALUES (?, ?, ?, ?)'
    )
    .run(plan.id, plan.version, plan.createdAt, JSON.stringify(plan))
}

export function createWorkflowRun(run: WorkflowRun): void {
  init()
  savePlan(run.plan)
  getDb()
    .prepare(
      `INSERT INTO workflow_runs
       (id, plan_id, plan_version, status, current_step_id, round, started_at, completed_at, error, report_path, plan_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.planId,
      run.planVersion,
      run.status,
      run.currentStepId ?? null,
      run.round,
      run.startedAt,
      run.completedAt ?? null,
      run.error ?? null,
      run.reportPath ?? null,
      JSON.stringify(run.plan)
    )
  appendEvent(run.id, 'run-created', { planId: run.planId, version: run.planVersion })
}

export function updateWorkflowRun(
  id: string,
  patch: Partial<
    Pick<WorkflowRun, 'status' | 'round' | 'completedAt' | 'error' | 'reportPath'> & {
      currentStepId: string | null
    }
  >
): void {
  init()
  const current = getWorkflowRun(id)
  if (!current) return
  getDb()
    .prepare(
      `UPDATE workflow_runs SET status = ?, current_step_id = ?, round = ?, completed_at = ?, error = ?, report_path = ? WHERE id = ?`
    )
    .run(
      patch.status ?? current.status,
      patch.currentStepId === undefined ? (current.currentStepId ?? null) : patch.currentStepId,
      patch.round ?? current.round,
      patch.completedAt === undefined ? (current.completedAt ?? null) : patch.completedAt,
      patch.error === undefined ? (current.error ?? null) : patch.error,
      patch.reportPath === undefined ? (current.reportPath ?? null) : patch.reportPath,
      id
    )
}

export function insertStepRun(step: WorkflowStepRun, runId: string): void {
  init()
  getDb()
    .prepare(
      `INSERT INTO workflow_step_runs
       (id, run_id, step_id, step_index, round, status, started_at, completed_at, input_ref, output_ref, raw_log_path, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      step.id,
      runId,
      step.stepId,
      step.stepIndex,
      step.round,
      step.status,
      step.startedAt,
      step.completedAt ?? null,
      step.inputRef ?? null,
      step.outputRef ?? null,
      step.rawLogPath ?? null,
      step.error ?? null
    )
}

export function finishStepRun(
  id: string,
  status: WorkflowStepRun['status'],
  patch: Partial<Pick<WorkflowStepRun, 'completedAt' | 'outputRef' | 'rawLogPath' | 'error'>> = {}
): void {
  init()
  getDb()
    .prepare(
      `UPDATE workflow_step_runs SET status = ?, completed_at = ?, output_ref = ?, raw_log_path = ?, error = ? WHERE id = ?`
    )
    .run(
      status,
      patch.completedAt ?? new Date().toISOString(),
      patch.outputRef ?? null,
      patch.rawLogPath ?? null,
      patch.error ?? null,
      id
    )
}

export function appendEvent(runId: string, type: string, payload: unknown = {}): void {
  init()
  getDb()
    .prepare('INSERT INTO workflow_events (run_id, created_at, type, payload) VALUES (?, ?, ?, ?)')
    .run(runId, new Date().toISOString(), type, JSON.stringify(payload))
}

interface RunRow {
  id: string
  plan_id: string
  plan_version: number
  status: string
  current_step_id: string | null
  round: number
  started_at: string
  completed_at: string | null
  error: string | null
  report_path: string | null
  plan_json: string
}

interface StepRunRow {
  id: string
  step_id: string
  step_index: number
  round: number
  status: string
  started_at: string
  completed_at: string | null
  input_ref: string | null
  output_ref: string | null
  raw_log_path: string | null
  error: string | null
}

function rowToStepRun(row: StepRunRow): WorkflowStepRun {
  return {
    id: row.id,
    stepId: row.step_id,
    stepIndex: row.step_index,
    round: row.round,
    status: row.status as WorkflowStepRun['status'],
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    inputRef: row.input_ref ?? undefined,
    outputRef: row.output_ref ?? undefined,
    rawLogPath: row.raw_log_path ?? undefined,
    error: row.error ?? undefined
  }
}

function rowToRun(row: RunRow): WorkflowRun {
  const steps = getDb()
    .prepare('SELECT * FROM workflow_step_runs WHERE run_id = ? ORDER BY started_at, step_index')
    .all(row.id) as unknown as StepRunRow[]
  return {
    id: row.id,
    planId: row.plan_id,
    planVersion: row.plan_version,
    plan: JSON.parse(row.plan_json) as WorkflowPlanDraft,
    status: row.status as WorkflowRunStatus,
    currentStepId: row.current_step_id ?? undefined,
    round: row.round,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
    reportPath: row.report_path ?? undefined,
    stepRuns: steps.map(rowToStepRun)
  }
}

export function getWorkflowRun(id: string): WorkflowRun | null {
  init()
  const row = getDb().prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as unknown as
    RunRow | undefined
  return row ? rowToRun(row) : null
}

export function listWorkflowRuns(limit = 50): WorkflowRun[] {
  init()
  const rows = getDb()
    .prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT ?')
    .all(limit) as unknown as RunRow[]
  return rows.map(rowToRun)
}

export function saveCapability(runId: string): WorkflowCapability {
  init()
  const run = getWorkflowRun(runId)
  if (!run || run.status !== 'succeeded')
    throw new Error('Only a successful run can become a capability')
  const existing = getDb()
    .prepare('SELECT * FROM workflow_capabilities WHERE source_run_id = ?')
    .get(runId) as unknown as CapabilityRow | undefined
  if (existing) return rowToCapability(existing)
  const capability: WorkflowCapability = {
    id: crypto.randomUUID(),
    name: run.plan.name,
    plan: run.plan,
    createdAt: new Date().toISOString(),
    sourceRunId: runId
  }
  getDb()
    .prepare(
      'INSERT INTO workflow_capabilities (id, name, created_at, source_run_id, plan_json) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      capability.id,
      capability.name,
      capability.createdAt,
      capability.sourceRunId,
      JSON.stringify(capability.plan)
    )
  return capability
}

interface CapabilityRow {
  id: string
  name: string
  created_at: string
  source_run_id: string
  plan_json: string
}

function rowToCapability(row: CapabilityRow): WorkflowCapability {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    sourceRunId: row.source_run_id,
    plan: JSON.parse(row.plan_json) as WorkflowPlanDraft
  }
}

export function listCapabilities(): WorkflowCapability[] {
  init()
  const rows = getDb()
    .prepare('SELECT * FROM workflow_capabilities ORDER BY created_at DESC')
    .all() as unknown as CapabilityRow[]
  return rows.map(rowToCapability)
}
