import { useState, useEffect, useRef } from 'react'
import { Send, Bot, Sparkles } from 'lucide-react'
import { cn } from '../lib/utils'
import { repoIdentityColors, AGENT_OPTIONS } from '../lib/constants'
import { useAgentModels } from '../lib/useAgentModels'
import Toggle from './Toggle'

const AGENT_ICONS = { claude: Bot, codex: Sparkles }

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

export default function DispatchView({ overview, onDispatch, initialRepo, initialPrompt, onDispatchComplete, settings }) {
  const repos = overview?.repos || []

  // Read from localStorage once on mount (sync, before useState defaults)
  const saved = useRef(null)
  if (saved.current === null) saved.current = readSaved()
  const s = saved.current

  const agentSettings = settings?.agents || {}

  const [agent, setAgent] = useState(s.agent || 'claude')
  const [repo, setRepo] = useState(initialRepo || s.repo || repos[0]?.name || '')
  const [baseBranch, setBaseBranch] = useState('')
  const [prompt, setPrompt] = useState(initialPrompt || '')
  const [autoMerge, setAutoMerge] = useState(s.autoMerge ?? false)
  const [plainOutput, setPlainOutput] = useState(s.plainOutput ?? agentSettings[s.agent || 'claude']?.tuiMode ?? false)
  const [dispatching, setDispatching] = useState(false)
  const [btnPhase, setBtnPhase] = useState('idle') // idle | shaking | sliding | hidden | returning

  const isCodex = agent === 'codex'
  const models = useAgentModels(agent)

  // Model: restore saved model, else use settings default (live list will snap if needed)
  const [model, setModel] = useState(() =>
    s.model || agentSettings[s.agent || 'claude']?.defaultModel || ''
  )

  // Turns: restore saved, else use settings default
  const [maxTurns, setMaxTurns] = useState(() => {
    if (s.maxTurns != null) return s.maxTurns
    return agentSettings[s.agent || 'claude']?.defaultMaxTurns ?? 10
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
    const newTurns = defaults.defaultMaxTurns ?? (newAgent === 'claude' ? 10 : null)
    const newPlainOutput = defaults.tuiMode ?? false
    setModel(newModel)
    setMaxTurns(newTurns)
    setPlainOutput(newPlainOutput)
    writeSaved({ agent: newAgent, model: newModel, maxTurns: newTurns, plainOutput: newPlainOutput })
  }

  // Persist individual fields immediately on change
  useEffect(() => { writeSaved({ agent }) }, [agent])
  useEffect(() => { writeSaved({ repo }) }, [repo])
  useEffect(() => { writeSaved({ model }) }, [model])
  useEffect(() => { writeSaved({ maxTurns }) }, [maxTurns])
  useEffect(() => { writeSaved({ autoMerge }) }, [autoMerge])
  useEffect(() => { writeSaved({ plainOutput }) }, [plainOutput])

  // Apply pre-fill when props change
  useEffect(() => { if (initialRepo) setRepo(initialRepo) }, [initialRepo])
  useEffect(() => { if (initialPrompt) setPrompt(initialPrompt) }, [initialPrompt])

  const selectedRepo = repos.find(r => r.name === repo)
  const defaultBranch = selectedRepo?.git?.branch || 'main'
  const branchOptions = selectedRepo?.git?.branches || []

  async function handleDispatch(e) {
    e.preventDefault()
    if (!prompt.trim() || !repo || btnPhase !== 'idle') return

    // Kick off button animation — disable only after content slides out
    setBtnPhase('shaking')
    setTimeout(() => setBtnPhase('sliding'), 400)
    setTimeout(() => setBtnPhase('hidden'), 800)

    setDispatching(true)
    try {
      await onDispatch?.({
        repo,
        taskText: prompt.trim(),
        originalTask: initialPrompt || null,
        baseBranch: baseBranch.trim() || defaultBranch,
        model,
        maxTurns: isCodex ? null : maxTurns,
        autoMerge,
        plainOutput: !isCodex && plainOutput,
        agent,
      })
      setPrompt('')
      onDispatchComplete?.()
    } catch (err) {
      console.error('Dispatch failed:', err)
    } finally {
      setDispatching(false)
      setTimeout(() => setBtnPhase('returning'), 1800)
      setTimeout(() => setBtnPhase('idle'), 2400)
    }
  }

  return (
    <div>
      <form onSubmit={handleDispatch} className="space-y-3">

        {/* Repo + Branch row */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
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

        {/* Prompt */}
        <div>
          <label htmlFor="dispatch-prompt" className="block text-[11px] font-medium text-muted-foreground mb-1">
            Task Prompt
          </label>
          <textarea
            id="dispatch-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the task for the worker..."
            rows={4}
            className={cn(
              'w-full px-3 py-2 rounded-md border border-border bg-card',
              'text-[13px] text-foreground placeholder:text-muted-foreground/40 leading-relaxed',
              'focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10',
              'resize-y'
            )}
          />
        </div>

        {/* Agent + Model + Turns + Plain + Merge + Submit */}
        <div className="flex items-start gap-3">
          {/* Agent selector — vertical stack */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Agent</label>
            <div className="flex flex-col gap-1">
              {AGENT_OPTIONS.map(opt => {
                const Icon = AGENT_ICONS[opt.id] || Bot
                const isSelected = agent === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => switchAgent(opt.id)}
                    style={isSelected ? { color: '#8bab8f', borderColor: '#8bab8f40', backgroundColor: '#8bab8f18' } : undefined}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors',
                      isSelected
                        ? 'border-transparent'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                    )}
                  >
                    <Icon size={13} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="w-44">
            <label htmlFor="dispatch-model" className="block text-[11px] font-medium text-muted-foreground mb-1">
              Model
            </label>
            <select
              id="dispatch-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground focus:outline-none focus:border-primary/30"
            >
              {models.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="w-20">
            <label htmlFor="dispatch-turns" className="block text-[11px] font-medium text-muted-foreground mb-1">
              Turns
            </label>
            <input
              id="dispatch-turns"
              type="number"
              min={1}
              max={200}
              value={isCodex ? '' : (maxTurns ?? '')}
              disabled={isCodex}
              onChange={(e) => setMaxTurns(parseInt(e.target.value) || 10)}
              placeholder={isCodex ? 'N/A' : '10'}
              title={isCodex ? 'N/A for Codex' : undefined}
              className={cn(
                'w-full h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground font-mono focus:outline-none focus:border-primary/30',
                isCodex && 'opacity-40 cursor-not-allowed'
              )}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">TUI</label>
            <div className="h-8 flex items-center">
              <Toggle
                checked={!isCodex && plainOutput}
                onChange={setPlainOutput}
                disabled={isCodex}
                title={isCodex ? 'Codex always runs in quiet mode' : 'Disable TUI (-p flag)'}
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Auto-Merge</label>
            <div className="h-8 flex items-center">
              <Toggle checked={autoMerge} onChange={setAutoMerge} />
            </div>
          </div>

          <div className="flex-1" />

          <div>
            <div aria-hidden="true" className="text-[11px] mb-1 invisible select-none">·</div>
            <button
              type="submit"
              style={{
                background: 'linear-gradient(135deg, #8bab8f 0%, #6d9472 100%)',
                color: '#1a1b1e',
                boxShadow: btnPhase !== 'idle'
                  ? '0 0 18px 4px rgba(139,171,143,0.45)'
                  : '0 0 8px 2px rgba(139,171,143,0.18)',
                transition: 'box-shadow 400ms ease',
                opacity: (!prompt.trim() || !repo) && btnPhase === 'idle' ? 0.4 : 1,
                cursor: (!prompt.trim() || !repo) && btnPhase === 'idle' ? 'not-allowed' : 'pointer',
                ...(btnPhase === 'hidden' && { transform: 'translateX(400px)' }),
              }}
              className={cn(
                'inline-flex items-center gap-2.5 pl-5 pr-6 h-10 rounded-full text-[13px] font-semibold shrink-0',
                btnPhase === 'idle' && 'transition-transform duration-150 ease-out hover:scale-105 active:scale-[0.97]',
                btnPhase === 'shaking' && 'animate-dispatch-shake',
                btnPhase === 'sliding' && 'animate-dispatch-btn-out',
                btnPhase === 'returning' && 'animate-dispatch-btn-in',
              )}
            >
              <Send size={15} />
              Dispatch
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
