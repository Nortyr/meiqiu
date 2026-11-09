import { useEffect, useState } from 'react'
import type { AcpModelsResult, Locale } from '../../../shared/types'
import { useSettings } from '../state/settings'
import Loading from '../components/Loading'

// 预设模型；「默认」就是存空串，交给 Claude Code 自己定
const MODEL_OPTIONS = [
  { value: '', labelKey: 'modelDefault' },
  { value: 'claude-opus-4-5', label: 'Opus 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: '__custom__', labelKey: 'modelCustom' }
] as const

const PROVIDER_LABELS: Record<'claude-code' | 'opencode' | 'codex', string> = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex'
}

function SettingsPage(): React.JSX.Element {
  const { settings, save: saveSettings, t } = useSettings()
  const [harnessPath, setHarnessPath] = useState('')
  const [modelChoice, setModelChoice] = useState('')
  const [customModel, setCustomModel] = useState('')
  // OpenCode 的模型列表要从 ACP 连接上拿（未连接时为空）
  const [ocModels, setOcModels] = useState<AcpModelsResult | null>(null)
  const [ocModel, setOcModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // 设置从 context 来：初次加载和保存后都同步本地编辑态（render 期间的派生状态调整）
  const [prevSettings, setPrevSettings] = useState(settings)
  if (settings !== prevSettings) {
    setPrevSettings(settings)
    if (settings) {
      setHarnessPath(settings.acpHarnessPath)
      const preset = MODEL_OPTIONS.some((o) => o.value === settings.acpModel)
      setModelChoice(preset ? settings.acpModel : '__custom__')
      setCustomModel(preset ? '' : settings.acpModel)
      setOcModel(
        settings.acpProvider === 'codex' ? settings.acpCodexModel : settings.acpOpencodeModel
      )
    }
  }

  // opencode/codex 的模型列表要从 ACP 连接上拿（未连接时为空）
  const provider = settings?.acpProvider ?? 'claude-code'
  const acpEnabled = settings?.acpEnabled ?? false
  useEffect(() => {
    if (provider === 'claude-code' || !acpEnabled) return
    window.api.acpModels().then((m) => {
      setOcModels(m)
      if (m) {
        setOcModel((prev) => (m.options.some((o) => o.value === prev) ? prev : m.current))
      }
    })
  }, [provider, acpEnabled])

  if (!settings) return <Loading />

  const providerLabel = PROVIDER_LABELS[provider]
  const detected = settings.detectedHarnessPath

  const save = (patch: Parameters<typeof saveSettings>[0]): void => {
    if (busy) return
    setBusy(true)
    setSaved(false)
    saveSettings(patch)
      .then(() => setSaved(true))
      .finally(() => setBusy(false))
  }

  const modelLabel = (o: (typeof MODEL_OPTIONS)[number]): string =>
    'label' in o ? o.label : t.settings[o.labelKey]

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>{t.settings.title}</h1>
      </header>

      <h2 className="group-title">{t.settings.language}</h2>
      <div className="settings-card">
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{t.settings.language}</div>
            <div className="setting-desc">{t.settings.languageDesc}</div>
          </div>
          <div className="setting-control">
            <select
              className="field-input"
              value={settings.locale}
              onChange={(e) => save({ locale: e.target.value as Locale | '' })}
            >
              <option value="">{t.settings.langAuto}</option>
              <option value="zh">{t.settings.langZh}</option>
              <option value="en">{t.settings.langEn}</option>
            </select>
          </div>
        </div>
      </div>

      <h2 className="group-title">{t.settings.provider}</h2>
      <div className="provider-tabs">
        <button
          className={`tab ${provider === 'claude-code' ? 'active' : ''}`}
          onClick={() => save({ acpProvider: 'claude-code' })}
        >
          Claude Code
        </button>
        <button
          className={`tab ${provider === 'opencode' ? 'active' : ''}`}
          onClick={() => save({ acpProvider: 'opencode' })}
        >
          OpenCode
        </button>
        <button
          className={`tab ${provider === 'codex' ? 'active' : ''}`}
          onClick={() => save({ acpProvider: 'codex' })}
        >
          Codex
        </button>
      </div>
      <div className="settings-card">
        {/* 启用 */}
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{t.settings.enable(providerLabel)}</div>
            <div className="setting-desc">{t.settings.enableDesc}</div>
          </div>
          <div className="setting-control">
            <button
              className={`switch ${settings.acpEnabled ? 'on' : ''}`}
              onClick={() => save({ acpEnabled: !settings.acpEnabled })}
              disabled={busy}
              role="switch"
              aria-checked={settings.acpEnabled}
            >
              <span className="switch-knob" />
            </button>
          </div>
        </div>

        {settings.acpEnabled && (
          <>
            {/* 连接状态 */}
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-name">{t.settings.connStatus}</div>
              </div>
              <div className="setting-control right">
                <span className={`conn-status ${settings.connected ? 'ok' : ''}`}>
                  {settings.connected ? t.settings.connected : t.settings.disconnected}
                </span>
              </div>
            </div>

            {/* CLI 路径 */}
            <div className="setting-item">
              <div className="setting-info">
                <div className="setting-name">{t.settings.cliPath(providerLabel)}</div>
                <div className="setting-desc">
                  {t.settings.cliPathDesc(providerLabel, detected)}
                </div>
              </div>
              <div className="setting-control">
                <input
                  className="field-input"
                  value={harnessPath}
                  onChange={(e) => {
                    setHarnessPath(e.target.value)
                    setSaved(false)
                  }}
                  placeholder={
                    detected ||
                    (provider === 'opencode'
                      ? '/usr/local/bin/opencode'
                      : provider === 'codex'
                        ? '/usr/local/bin/codex'
                        : '/usr/local/bin/claude')
                  }
                />
              </div>
            </div>

            {/* 模型：opencode 的模型走 ACP 下发；Claude Code 的走环境变量 */}
            {provider === 'claude-code' && (
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-name">{t.settings.model}</div>
                  <div className="setting-desc">{t.settings.modelDescClaude}</div>
                </div>
                <div className="setting-control">
                  <select
                    className="field-input"
                    value={modelChoice}
                    onChange={(e) => {
                      setModelChoice(e.target.value)
                      setSaved(false)
                    }}
                  >
                    {MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {modelLabel(o)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {provider === 'claude-code' && modelChoice === '__custom__' && (
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-name">{t.settings.customModel}</div>
                  <div className="setting-desc">{t.settings.customModelDesc}</div>
                </div>
                <div className="setting-control">
                  <input
                    className="field-input"
                    value={customModel}
                    onChange={(e) => {
                      setCustomModel(e.target.value)
                      setSaved(false)
                    }}
                    placeholder={t.settings.customModelPlaceholder}
                  />
                </div>
              </div>
            )}

            {/* opencode/codex 的模型：走 ACP 下发，只影响煤球起的会话 */}
            {provider !== 'claude-code' && (
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-name">{t.settings.model}</div>
                  <div className="setting-desc">{t.settings.modelDescAcp(providerLabel)}</div>
                </div>
                <div className="setting-control">
                  {ocModels ? (
                    <select
                      className="field-input"
                      value={ocModel}
                      onChange={(e) => {
                        setOcModel(e.target.value)
                        setSaved(false)
                      }}
                    >
                      <option value="">{t.settings.ocModelDefault(ocModels.current)}</option>
                      {Object.entries(
                        ocModels.options.reduce<Record<string, AcpModelsResult['options']>>(
                          (acc, o) => {
                            const g = o.value.split('/')[0]
                            ;(acc[g] ??= []).push(o)
                            return acc
                          },
                          {}
                        )
                      ).map(([group, options]) => (
                        <optgroup key={group} label={group}>
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  ) : (
                    <span className="muted small">{t.settings.ocModelsAfterConnect}</span>
                  )}
                </div>
              </div>
            )}

            <div className="setting-actions">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  save({
                    [provider === 'opencode'
                      ? 'acpOpencodePath'
                      : provider === 'codex'
                        ? 'acpCodexPath'
                        : 'acpHarnessPath']: harnessPath,
                    acpModel: modelChoice === '__custom__' ? customModel : modelChoice,
                    acpOpencodeModel: provider === 'opencode' ? ocModel : settings.acpOpencodeModel,
                    acpCodexModel: provider === 'codex' ? ocModel : settings.acpCodexModel
                  })
                }
              >
                {t.settings.save}
              </button>
              {saved && <span className="conn-status ok">{t.settings.saved}</span>}
              <span className="muted small">{t.settings.saveHint}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default SettingsPage
