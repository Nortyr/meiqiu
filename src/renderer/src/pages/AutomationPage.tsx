import { useEffect, useMemo, useState } from 'react'
import type {
  WorkflowCapability,
  WorkflowPlanDraft,
  WorkflowRun,
  WorkflowStep,
  WorkflowVerifier
} from '../../../shared/types'
import { AGENT_LABELS } from '../../../shared/types'
import { useSettings } from '../state/settings'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusClass(status: string): string {
  if (status === 'succeeded') return 'ok'
  if (status === 'failed' || status === 'needs_reconciliation') return 'bad'
  if (status === 'running' || status === 'queued') return 'active'
  return ''
}

interface PlanGraphProps {
  plan: WorkflowPlanDraft
  run?: WorkflowRun
  onSelectStep?: (stepId: string) => void
}

function PlanGraph({ plan, run, onSelectStep }: PlanGraphProps): React.JSX.Element {
  const latestByStep = new Map<string, WorkflowRun['stepRuns'][number]>()
  for (const stepRun of run?.stepRuns ?? []) latestByStep.set(stepRun.stepId, stepRun)

  const retryIndex = Math.max(
    0,
    plan.steps.findIndex((step) => step.id === plan.retryPolicy.retryFromStepId)
  )
  const verifyIndex = plan.steps.findIndex((step) => step.type === 'verify')
  const retryTarget = plan.steps[retryIndex]
  const hasLoop = verifyIndex > retryIndex && Boolean(retryTarget)

  return (
    <div className="plan-graph" aria-label="Plan graph">
      <div className="plan-graph-track">
        {plan.steps.map((step, index) => {
          const stepRun = latestByStep.get(step.id)
          const isCurrent = Boolean(run && run.currentStepId === step.id)
          const state = statusClass(stepRun?.status ?? (isCurrent ? 'running' : ''))
          return (
            <div className="plan-graph-item" key={step.id}>
              <button
                className={`plan-graph-node ${step.type} ${state} ${isCurrent ? 'current' : ''}`}
                onClick={() => onSelectStep?.(step.id)}
              >
                <span className="plan-graph-node-icon">
                  {stepRun?.status === 'succeeded'
                    ? '✓'
                    : stepRun?.status === 'failed'
                      ? '!'
                      : index + 1}
                </span>
                <span className="plan-graph-node-copy">
                  <span className="plan-graph-node-type">
                    {step.type === 'verify' ? 'Check' : 'Agent'}
                  </span>
                  <span className="plan-graph-node-title">{step.text}</span>
                </span>
              </button>
              {index < plan.steps.length - 1 ? (
                <span className="plan-graph-arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
      {hasLoop ? (
        <div className="plan-graph-loop">
          <span className="plan-graph-loop-line" aria-hidden="true" />
          <span className="plan-graph-loop-copy">
            {plan.retryPolicy.maxRounds}× · {retryTarget.text}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export default function AutomationPage(): React.JSX.Element {
  const { settings, t } = useSettings()
  const [brief, setBrief] = useState('')
  const [cwd, setCwd] = useState('')
  const [plan, setPlan] = useState<WorkflowPlanDraft | null>(null)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [capabilities, setCapabilities] = useState<WorkflowCapability[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  )

  const reload = async (preferredRunId?: string): Promise<void> => {
    const [nextRuns, nextCapabilities] = await Promise.all([
      window.api.workflowListRuns(),
      window.api.workflowListCapabilities()
    ])
    setRuns(nextRuns)
    setCapabilities(nextCapabilities)
    if (preferredRunId) setSelectedRunId(preferredRunId)
  }

  useEffect(() => {
    void Promise.all([window.api.workflowListRuns(), window.api.workflowListCapabilities()]).then(
      ([nextRuns, nextCapabilities]) => {
        setRuns(nextRuns)
        setCapabilities(nextCapabilities)
      }
    )
    return window.api.onWorkflowChanged((runId) => void reload(runId))
  }, [])

  const createWorkspace = async (): Promise<void> => {
    setCreatingWorkspace(true)
    setError('')
    try {
      setCwd(await window.api.workflowCreateWorkspace())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setCreatingWorkspace(false)
    }
  }

  const createPlan = async (): Promise<void> => {
    if (!brief.trim() || !cwd.trim()) return
    setPlanning(true)
    setError('')
    setSelectedRunId(null)
    try {
      setPlan(await window.api.workflowPlan({ brief, cwd }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setPlanning(false)
    }
  }

  const start = async (): Promise<void> => {
    if (!plan) return
    setStarting(true)
    setError('')
    setSaved(false)
    try {
      const run = await window.api.workflowStart(plan)
      setSelectedRunId(run.id)
      setPlan(null)
      await reload(run.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setStarting(false)
    }
  }

  const updateStep = (id: string, patch: Partial<WorkflowStep>): void => {
    if (!plan) return
    setPlan({
      ...plan,
      steps: plan.steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
    })
  }

  const updateVerifier = (id: string, patch: Partial<WorkflowVerifier>): void => {
    if (!plan) return
    setPlan({
      ...plan,
      verifiers: plan.verifiers.map((verifier) =>
        verifier.id === id ? { ...verifier, ...patch } : verifier
      )
    })
  }

  const addStep = (type: WorkflowStep['type']): void => {
    if (!plan || plan.steps.length >= 20) return
    const step: WorkflowStep = {
      id: `step-${crypto.randomUUID()}`,
      index: plan.steps.length,
      type,
      text: type === 'agent' ? t.automation.newActionText : t.automation.newCheckText,
      verifierIds: type === 'verify' ? plan.verifiers.map((verifier) => verifier.id) : undefined
    }
    setPlan({ ...plan, steps: [...plan.steps, step] })
  }

  const removeStep = (id: string): void => {
    if (!plan || plan.steps.length <= 2) return
    const steps = plan.steps
      .filter((step) => step.id !== id)
      .map((step, index) => ({ ...step, index }))
    const retryFromStepId = steps.some((step) => step.id === plan.retryPolicy.retryFromStepId)
      ? plan.retryPolicy.retryFromStepId
      : (steps.find((step) => step.type === 'agent')?.id ?? steps[0].id)
    setPlan({ ...plan, steps, retryPolicy: { ...plan.retryPolicy, retryFromStepId } })
  }

  const newTask = (): void => {
    setPlan(null)
    setSelectedRunId(null)
    setBrief('')
    setError('')
    setSaved(false)
  }

  const loadCapability = (capability: WorkflowCapability): void => {
    const next = capability.plan
    setBrief(next.brief)
    setCwd(next.cwd)
    setPlan({ ...next, id: crypto.randomUUID(), version: 1, createdAt: new Date().toISOString() })
    setSelectedRunId(null)
    setError('')
  }

  const saveCurrentCapability = async (): Promise<void> => {
    if (!selectedRun) return
    try {
      await window.api.workflowSaveCapability(selectedRun.id)
      setSaved(true)
      await reload(selectedRun.id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="automation-page">
      <aside className="automation-tree">
        <button className="btn-primary automation-new" onClick={newTask}>
          {t.automation.newTask}
        </button>
        <div className="automation-tree-section">
          <div className="group-title">{t.automation.recentRuns}</div>
          {runs.length === 0 ? <div className="muted small">{t.automation.noRuns}</div> : null}
          {runs.map((run) => (
            <button
              key={run.id}
              className={`automation-tree-row ${selectedRunId === run.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedRunId(run.id)
                setPlan(null)
              }}
            >
              <span className={`run-dot ${statusClass(run.status)}`} />
              <span className="tree-label">{run.plan.name}</span>
              <span className="small muted">{run.round}</span>
            </button>
          ))}
        </div>
        {capabilities.length ? (
          <div className="automation-tree-section">
            <div className="group-title">{t.automation.capabilities}</div>
            {capabilities.map((capability) => (
              <button
                key={capability.id}
                className="automation-tree-row"
                onClick={() => loadCapability(capability)}
              >
                <span className="capability-mark">◆</span>
                <span className="tree-label">{capability.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </aside>

      <section className="automation-main">
        {!plan && !selectedRun ? (
          <div className="automation-compose">
            <div className="automation-kicker">{t.automation.kicker}</div>
            <h1>{t.automation.title}</h1>
            <p className="automation-lead">{t.automation.lead}</p>
            {!settings?.acpEnabled ? (
              <div className="setup-hint">{t.automation.enableAcp}</div>
            ) : null}
            <label className="field">
              <span className="field-label">{t.automation.workspace}</span>
              <div className="workspace-input-row">
                <input
                  className="field-input"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  placeholder={t.automation.workspacePlaceholder}
                />
                <button
                  className="btn-ghost"
                  disabled={creatingWorkspace}
                  onClick={() => void createWorkspace()}
                >
                  {creatingWorkspace
                    ? t.automation.creatingWorkspace
                    : t.automation.createWorkspace}
                </button>
              </div>
              <span className="muted small workspace-hint">{t.automation.workspaceHint}</span>
            </label>
            <label className="field">
              <span className="field-label">{t.automation.brief}</span>
              <textarea
                className="automation-brief"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder={t.automation.briefPlaceholder}
              />
            </label>
            <div className="automation-actions">
              <span className="muted small">{t.automation.briefHint}</span>
              <button
                className="btn-primary"
                disabled={!settings?.acpEnabled || !brief.trim() || !cwd.trim() || planning}
                onClick={createPlan}
              >
                {planning ? t.automation.planning : t.automation.makePlan}
              </button>
            </div>
          </div>
        ) : null}

        {plan ? (
          <div className="automation-review">
            <header className="automation-header">
              <div>
                <div className="automation-kicker">{t.automation.planDraft}</div>
                <input
                  className="automation-title-input"
                  value={plan.name}
                  onChange={(event) => setPlan({ ...plan, name: event.target.value })}
                />
              </div>
              <button className="btn-ghost" onClick={newTask}>
                {t.automation.discard}
              </button>
            </header>

            <section className="automation-section">
              <div className="automation-section-title">{t.automation.goal}</div>
              <textarea
                className="automation-goal"
                value={plan.goal}
                onChange={(event) => setPlan({ ...plan, goal: event.target.value })}
              />
            </section>

            <section className="automation-section">
              <div className="automation-section-heading">
                <div className="automation-section-title">{t.automation.structure}</div>
                <span className="muted small">{t.automation.structureHint}</span>
              </div>
              <PlanGraph
                plan={plan}
                onSelectStep={(stepId) =>
                  document.getElementById(`plan-step-${stepId}`)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                  })
                }
              />
            </section>

            <section className="automation-section">
              <div className="automation-section-heading">
                <div className="automation-section-title">{t.automation.steps}</div>
                <div>
                  <button className="step-add" onClick={() => addStep('agent')}>
                    + {t.automation.addAction}
                  </button>
                  <button className="step-add" onClick={() => addStep('verify')}>
                    + {t.automation.addCheck}
                  </button>
                </div>
              </div>
              <div className="plan-list">
                {plan.steps.map((step) => (
                  <div className="plan-row" id={`plan-step-${step.id}`} key={step.id}>
                    <span className="plan-index">{step.index + 1}</span>
                    <span className={`plan-type ${step.type}`}>
                      {t.automation.stepTypes[step.type]}
                    </span>
                    <textarea
                      value={step.text}
                      onChange={(event) => updateStep(step.id, { text: event.target.value })}
                    />
                    <button
                      className="step-remove"
                      disabled={plan.steps.length <= 2}
                      title={t.automation.removeStep}
                      onClick={() => removeStep(step.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="automation-section">
              <div className="automation-section-title">{t.automation.verifiers}</div>
              <div className="verifier-list">
                {plan.verifiers.map((verifier) => (
                  <div className="verifier-row" key={verifier.id}>
                    <div className="verifier-name">
                      <span className="check-mark">✓</span>
                      <input
                        value={verifier.name}
                        onChange={(event) =>
                          updateVerifier(verifier.id, { name: event.target.value })
                        }
                      />
                    </div>
                    {verifier.type === 'command' ? (
                      <input
                        className="verifier-command"
                        value={verifier.command ?? ''}
                        onChange={(event) =>
                          updateVerifier(verifier.id, { command: event.target.value })
                        }
                      />
                    ) : (
                      <span className="muted small">{verifier.path}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="automation-section automation-limits">
              <div>
                <div className="automation-section-title">{t.automation.limits}</div>
                <span>{t.automation.rounds}</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={plan.retryPolicy.maxRounds}
                  onChange={(event) =>
                    setPlan({
                      ...plan,
                      retryPolicy: { ...plan.retryPolicy, maxRounds: Number(event.target.value) }
                    })
                  }
                />
                <span>{t.automation.minutes}</span>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={plan.retryPolicy.maxMinutes}
                  onChange={(event) =>
                    setPlan({
                      ...plan,
                      retryPolicy: { ...plan.retryPolicy, maxMinutes: Number(event.target.value) }
                    })
                  }
                />
              </div>
              <div>
                <div className="automation-section-title">{t.automation.boundaries}</div>
                <input
                  className="field-input"
                  value={plan.forbidden.join('；')}
                  onChange={(event) =>
                    setPlan({
                      ...plan,
                      forbidden: event.target.value
                        .split(/[；;]/)
                        .map((item) => item.trim())
                        .filter(Boolean)
                    })
                  }
                />
                <div className="muted small boundary-note">{t.automation.boundaryNote}</div>
              </div>
            </section>

            <div className="permission-awareness">
              <strong>{t.automation.executionEnvironment}</strong>
              <span>{AGENT_LABELS[plan.provider]}</span>
              {plan.model ? <span>{plan.model}</span> : null}
              <span className="muted">{plan.cwd}</span>
              <span className="muted">
                {t.automation.permissionMode}: {plan.permissionMode}
              </span>
              <span className="muted">{plan.permissionConfigPath}</span>
              <span className="muted">{t.automation.permissionInherited}</span>
            </div>
            <div className="automation-actions">
              <span className="muted small">{t.automation.freezeHint}</span>
              <button className="btn-primary" disabled={starting} onClick={start}>
                {starting ? t.automation.starting : t.automation.start}
              </button>
            </div>
          </div>
        ) : null}

        {selectedRun ? (
          <RunDetail
            run={selectedRun}
            saved={saved || capabilities.some((item) => item.sourceRunId === selectedRun.id)}
            onCancel={() => window.api.workflowCancel(selectedRun.id)}
            onSave={saveCurrentCapability}
            t={t}
          />
        ) : null}

        {error ? <div className="automation-error">{error}</div> : null}
      </section>
    </div>
  )
}

function RunDetail({
  run,
  saved,
  onCancel,
  onSave,
  t
}: {
  run: WorkflowRun
  saved: boolean
  onCancel: () => void
  onSave: () => void
  t: ReturnType<typeof useSettings>['t']
}): React.JSX.Element {
  const active = run.status === 'running' || run.status === 'queued'
  const [artifactPath, setArtifactPath] = useState<string | null>(null)
  const [artifactText, setArtifactText] = useState('')
  const [artifactLoading, setArtifactLoading] = useState(false)
  const latestByStep = new Map<string, WorkflowRun['stepRuns'][number]>()
  for (const stepRun of run.stepRuns) latestByStep.set(stepRun.stepId, stepRun)

  const toggleArtifact = async (path: string): Promise<void> => {
    if (artifactPath === path) {
      setArtifactPath(null)
      setArtifactText('')
      return
    }
    setArtifactPath(path)
    setArtifactText('')
    setArtifactLoading(true)
    try {
      setArtifactText(await window.api.workflowReadArtifact(run.id, path))
    } catch (error) {
      setArtifactText(errorText(error))
    } finally {
      setArtifactLoading(false)
    }
  }

  return (
    <div className="run-detail">
      <header className="automation-header run-header">
        <div>
          <div className="automation-kicker">
            {t.automation.runLabel(run.round)} · {new Date(run.startedAt).toLocaleString()}
          </div>
          <h1>{run.plan.name}</h1>
        </div>
        <div className="run-header-actions">
          <span className={`run-status ${statusClass(run.status)}`}>
            {t.automation.statuses[run.status]}
          </span>
          {active ? (
            <button className="btn-ghost" onClick={onCancel}>
              {t.automation.cancelRun}
            </button>
          ) : null}
          {run.status === 'succeeded' ? (
            <button className="btn-primary" disabled={saved} onClick={onSave}>
              {saved ? t.automation.savedCapability : t.automation.saveCapability}
            </button>
          ) : null}
        </div>
      </header>

      <div className="run-goal">{run.plan.goal}</div>
      <section className="automation-section run-structure">
        <div className="automation-section-title">{t.automation.structure}</div>
        <PlanGraph
          plan={run.plan}
          run={run}
          onSelectStep={(stepId) =>
            document.getElementById(`run-step-${stepId}`)?.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            })
          }
        />
      </section>
      <div className="run-step-list">
        {run.plan.steps.map((step) => {
          const stepRun = latestByStep.get(step.id)
          const isCurrent = active && run.currentStepId === step.id
          return (
            <div
              className={`run-step ${isCurrent ? 'current' : ''}`}
              id={`run-step-${step.id}`}
              key={step.id}
            >
              <span className={`run-step-state ${statusClass(stepRun?.status ?? '')}`}>
                {stepRun?.status === 'succeeded'
                  ? '✓'
                  : stepRun?.status === 'failed'
                    ? '!'
                    : step.index + 1}
              </span>
              <div className="run-step-main">
                <div>{step.text}</div>
                {stepRun ? (
                  <div className="muted small">
                    {t.automation.roundLabel(stepRun.round)}
                    {stepRun.error ? ` · ${stepRun.error}` : ''}
                  </div>
                ) : null}
                {stepRun?.rawLogPath ? (
                  <button
                    className="artifact-toggle"
                    onClick={() => void toggleArtifact(stepRun.rawLogPath!)}
                  >
                    {artifactPath === stepRun.rawLogPath
                      ? t.automation.hideLog
                      : t.automation.viewLog}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {artifactPath ? (
        <div className="artifact-viewer">
          <div className="artifact-path">{artifactPath}</div>
          <pre>{artifactLoading ? t.automation.loadingLog : artifactText}</pre>
        </div>
      ) : null}

      {run.error ? (
        <div className={`run-diagnosis ${run.status === 'needs_reconciliation' ? 'warning' : ''}`}>
          <strong>{t.automation.stopped}</strong>
          <p>{run.error}</p>
          {run.status === 'needs_reconciliation' ? (
            <p className="muted">{t.automation.reconciliationHint}</p>
          ) : null}
        </div>
      ) : null}
      {run.reportPath ? (
        <div className="permission-awareness">
          <strong>{t.automation.evidence}</strong>
          <span className="artifact-path">{run.reportPath}</span>
        </div>
      ) : null}
    </div>
  )
}
