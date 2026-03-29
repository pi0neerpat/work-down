import { useState, useEffect, useRef } from 'react'
import { Send, FileText, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { repoIdentityColors } from '../lib/constants'
import { useAgentModels } from '../lib/useAgentModels'
import DispatchSettingsRow from './DispatchSettingsRow'

function readSaved() {
  try { return JSON.parse(localStorage.getItem('dispatch-settings')) || {} }
  catch { return {} }
}

function writeSaved(patch) {
  try {
    const prev = readSaved()
    localStorage.setItem('dispatch-settings', JSON.stringify({ ...prev, ...patch }))
  } catch {}
}

export default function DispatchView({ overview, onDispatch, initialRepo, initialPrompt, initialPlanSlug, onDispatchComplete, settings }) {
  const repos = overview?.repos || []

  // Read from localStorage once on mount (sync, before useState defaults)
  const saved = useRef(null)
  if (saved.current === null) saved.current = readSaved()
  const s = saved.current

  const agentSettings = settings?.agents || {}

  const [agent, setAgent] = useState(s.agent || 'claude')
  const [repo, setRepo] = useState(initialRepo || s.repo || repos[0]?.name || '')
  const [baseBranch, setBaseBranch] = useState('')
  const [prompt, setPrompt] = useState(initialPrompt ?? s.prompt ?? '')
  const [autoMerge, setAutoMerge] = useState(s.autoMerge ?? false)
  const [useWorktree, setUseWorktree] = useState(s.useWorktree ?? false)
  const [plainOutput, setPlainOutput] = useState(s.plainOutput ?? !(agentSettings[s.agent || 'claude']?.tuiMode ?? true))
  const [planSlug, setPlanSlug] = useState(initialPlanSlug || null)
  const [dispatching, setDispatching] = useState(false)
  const [btnPhase, setBtnPhase] = useState('idle') // idle | shaking | sliding | hidden | returning
  const [dispatchError, setDispatchError] = useState(null)

  const isCodex = agent === 'codex'
  const models = useAgentModels(agent)

  // Model: restore saved model, else use settings default (live list will snap if needed)
  const [model, setModel] = useState(() =>
    s.model || agentSettings[s.agent || 'claude']?.defaultModel || ''
  )

  // Turns: always use settings default (not persisted across dispatches)
  const [maxTurns, setMaxTurns] = useState(() => {
    const cfg = agentSettings[s.agent || 'claude'] || {}
    return 'defaultMaxTurns' in cfg ? cfg.defaultMaxTurns : 10
  })

  // When models list loads and current model isn't in it, snap to first
  useEffect(() => {
    if (models.length > 0 && !models.find(m => m.value === model)) {
      const newModel = agentSettings[agent]?.defaultModel || models[0].value
      setModel(newModel)
      writeSaved({ model: newModel })
    }
  }, [models])

  function switchAgent(newAgent) {
    setAgent(newAgent)
    const defaults = agentSettings[newAgent] || {}
    const newModel = defaults.defaultModel || ''
    const newTurns = 'defaultMaxTurns' in defaults ? defaults.defaultMaxTurns : (newAgent === 'claude' ? 10 : null)
    const newPlainOutput = !(defaults.tuiMode ?? true)
    setModel(newModel)
    setMaxTurns(newTurns)
    setPlainOutput(newPlainOutput)
    writeSaved({ agent: newAgent, model: newModel, plainOutput: newPlainOutput })
  }

  // Persist individual fields immediately on change
  useEffect(() => { writeSaved({ agent }) }, [agent])
  useEffect(() => { writeSaved({ repo }) }, [repo])
  useEffect(() => { writeSaved({ model }) }, [model])
  useEffect(() => { writeSaved({ autoMerge }) }, [autoMerge])
  useEffect(() => { writeSaved({ useWorktree }) }, [useWorktree])
  useEffect(() => { writeSaved({ plainOutput }) }, [plainOutput])
  useEffect(() => { writeSaved({ prompt }) }, [prompt])

  // Set default repo once repos load (overview may not be ready on first render)
  useEffect(() => {
    if (repos.length > 0 && (!repo || !repos.find(r => r.name === repo))) {
      const defaultRepo = repos.find(r => r.name === s.repo) || repos[0]
      if (defaultRepo) setRepo(defaultRepo.name)
    }
  }, [repos])

  // Apply pre-fill when props change
  useEffect(() => { if (initialRepo) setRepo(initialRepo) }, [initialRepo])
  useEffect(() => { if (initialPrompt) setPrompt(initialPrompt) }, [initialPrompt])
  useEffect(() => { setPlanSlug(initialPlanSlug || null) }, [initialPlanSlug])

  const selectedRepo = repos.find(r => r.name === repo)
  const defaultBranch = selectedRepo?.git?.branch || 'main'
  const branchOptions = selectedRepo?.git?.branches || []

  const isReady = repo && (planSlug || prompt.trim())

  async function handleDispatch(e) {
    e.preventDefault()
    if (!isReady || btnPhase !== 'idle') return
    setDispatchError(null)

    // Assemble final task text: plan path first, then any extra instructions
    const planPath = planSlug ? `plans/${planSlug}.md` : null
    const taskText = planPath
      ? (prompt.trim() ? `${planPath}\n\n${prompt.trim()}` : planPath)
      : prompt.trim()

    // Kick off button animation — disable only after content slides out
    setBtnPhase('shaking')
    setTimeout(() => setBtnPhase('sliding'), 400)
    setTimeout(() => setBtnPhase('hidden'), 800)

    setDispatching(true)
    try {
      await onDispatch?.({
        repo,
        taskText,
        originalTask: initialPrompt || null,
        baseBranch: baseBranch.trim() || defaultBranch,
        model,
        maxTurns: isCodex ? null : maxTurns,
        autoMerge,
        useWorktree,
        plainOutput,
        agent,
        planSlug: planSlug || undefined,
      })
      setPrompt('')
      onDispatchComplete?.()
    } catch (err) {
      console.error('Dispatch failed:', err)
      setBtnPhase('idle')
      setDispatchError(err.message)
      return
    } finally {
      setDispatching(false)
      setTimeout(() => setBtnPhase('returning'), 1800)
      setTimeout(() => setBtnPhase('idle'), 2400)
    }
  }

  return (
    <div>
      <form onSubmit={handleDispatch} className="space-y-3">

        {/* Repo row */}
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Repository</label>
          <div className="flex gap-1.5 flex-wrap">
            {repos.map(r => {
              const color = repoIdentityColors[r.name] || 'var(--primary)'
              const isSelected = repo === r.name
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => { setRepo(r.name); setBaseBranch('') }}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[12px] font-medium capitalize border transition-all',
                    isSelected
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                  )}
                  style={isSelected ? { borderColor: `${color}40`, backgroundColor: `${color}10` } : undefined}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: color }} />
                  {r.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Branch row */}
        <div className="flex items-end gap-3">
          <div className="w-44 shrink-0">
            <label htmlFor="dispatch-branch" className="block text-[11px] font-medium text-muted-foreground mb-1">
              Branch
            </label>
            <select
              id="dispatch-branch"
              value={baseBranch || defaultBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground focus:outline-none focus:border-primary/30"
            >
              {branchOptions.length > 0 ? (
                branchOptions.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))
              ) : (
                <option value={defaultBranch}>{defaultBranch}</option>
              )}
            </select>
          </div>
        </div>

        {/* Plan chip */}
        {planSlug && (
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Plan</label>
            <div className="inline-flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-md border border-border bg-card max-w-full">
              <FileText size={12} className="text-muted-foreground/60 shrink-0" />
              <span
                className="text-[12px] text-foreground/70 truncate"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                plans/{planSlug}.md
              </span>
              <button
                type="button"
                onClick={() => setPlanSlug(null)}
                className="ml-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
                title="Remove plan reference"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Prompt */}
        <div>
          <label htmlFor="dispatch-prompt" className="block text-[11px] font-medium text-muted-foreground mb-1">
            {planSlug ? 'Additional Instructions' : 'Task Prompt'}
          </label>
          <textarea
            id="dispatch-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={planSlug ? 'Additional instructions (optional)...' : 'Describe the task for the worker...'}
            rows={planSlug ? 3 : 4}
            className={cn(
              'w-full px-3 py-2 rounded-md border border-border bg-card',
              'text-[13px] text-foreground placeholder:text-muted-foreground/40 leading-relaxed',
              'focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10',
              'resize-y'
            )}
          />
        </div>

        {/* Agent + Model + Turns + TUI + Auto-merge + Worktree + Submit */}
        <div className="flex items-start gap-3 flex-wrap">
          <DispatchSettingsRow
            agent={agent} onSwitchAgent={switchAgent}
            model={model} setModel={setModel} models={models}
            maxTurns={maxTurns} setMaxTurns={setMaxTurns}
            useWorktree={useWorktree} setUseWorktree={setUseWorktree}
            autoMerge={autoMerge} setAutoMerge={setAutoMerge}
            plainOutput={plainOutput} setPlainOutput={setPlainOutput}
          />

          <div className="flex-1" />

          <div>
            <div aria-hidden="true" className="text-[11px] mb-1 invisible select-none">·</div>
            {/* Wrapper carries glow + button together through animations */}
            <div
              className={cn(
                'relative inline-flex items-center justify-center',
                btnPhase === 'idle' && 'transition-opacity duration-200',
                btnPhase === 'shaking' && 'animate-dispatch-shake',
                btnPhase === 'sliding' && 'animate-dispatch-btn-out',
                btnPhase === 'returning' && 'animate-dispatch-btn-in',
              )}
              style={{
                opacity: !isReady && btnPhase === 'idle' ? 0.4 : 1,
                ...(btnPhase === 'hidden' && { transform: 'translateX(400px)' }),
              }}
            >
              {/* Glow layers — fade in when button is ready, out when disabled */}
              <div
                className="absolute inset-0 pointer-events-none transition-opacity duration-500"
                style={{ opacity: isReady || btnPhase !== 'idle' ? 1 : 0 }}
              >
                <div className="absolute pointer-events-none animate-loading-halo" style={{ width: '204px', height: '66px', background: '#8bab8f', borderRadius: '50%', filter: 'blur(35px)', top: 'calc(50% - 33px)', left: 'calc(50% - 102px)' }} />
                <div className="absolute pointer-events-none animate-loading-glow" style={{ width: '108px', height: '38px', background: '#8bab8f', borderRadius: '50%', filter: 'blur(19px)', top: 'calc(50% - 19px)', left: 'calc(50% - 54px)' }} />
                <div className="absolute pointer-events-none animate-loading-glow-shift" style={{ width: '90px', height: '32px', background: '#7ea89a', borderRadius: '50%', filter: 'blur(17px)', top: 'calc(50% - 16px)', left: 'calc(50% - 45px)' }} />
              </div>

              <button
                type="submit"
                style={{
                  background: 'linear-gradient(135deg, #8bab8f 0%, #6d9472 100%)',
                  color: '#1a1b1e',
                  boxShadow: btnPhase !== 'idle'
                    ? '0 0 18px 4px rgba(139,171,143,0.45)'
                    : '0 0 8px 2px rgba(139,171,143,0.18)',
                  transition: 'box-shadow 400ms ease',
                  cursor: !isReady && btnPhase === 'idle' ? 'not-allowed' : 'pointer',
                }}
                className={cn(
                  'inline-flex items-center gap-2.5 pl-5 pr-6 h-10 rounded-full text-[13px] font-semibold shrink-0 relative z-10',
                  btnPhase === 'idle' && 'transition-transform duration-150 ease-out hover:scale-105 active:scale-[0.97]',
                )}
              >
                <Send size={15} />
                Dispatch
              </button>
            </div>
          </div>
        </div>
      </form>
      {dispatchError && (
        <div className="mt-3 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/10 text-[12px] text-red-400">
          {dispatchError}
        </div>
      )}
    </div>
  )
}
