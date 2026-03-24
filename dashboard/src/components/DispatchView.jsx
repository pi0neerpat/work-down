import { useState, useEffect, useRef } from 'react'
import { Send, Loader } from 'lucide-react'
import { cn } from '../lib/utils'
import { repoIdentityColors, MODEL_OPTIONS } from '../lib/constants'

export default function DispatchView({ overview, onDispatch, initialRepo, initialPrompt, onDispatchComplete }) {
  const repos = overview?.repos || []

  // Read saved settings synchronously so useState gets correct initial values.
  // Previously a restore useEffect ran after mount, but the save useEffect also
  // fired on mount with default values — overwriting localStorage before the
  // queued state updates from the restore could trigger a second save.
  const saved = useRef(null)
  if (saved.current === null) {
    try { saved.current = JSON.parse(localStorage.getItem('dispatch-settings')) || {} }
    catch { saved.current = {} }
  }

  const [repo, setRepo] = useState(initialRepo || saved.current.repo || repos[0]?.name || '')
  const [baseBranch, setBaseBranch] = useState('')
  const [prompt, setPrompt] = useState(initialPrompt || '')
  const [model, setModel] = useState(saved.current.model || MODEL_OPTIONS[0].value)
  const [maxTurns, setMaxTurns] = useState(saved.current.maxTurns ?? 10)
  const [autoMerge, setAutoMerge] = useState(saved.current.autoMerge ?? false)
  const [dispatching, setDispatching] = useState(false)

  // Persist settings on change so they survive route navigation / refresh
  useEffect(() => {
    try {
      localStorage.setItem('dispatch-settings', JSON.stringify({ repo, model, maxTurns, autoMerge }))
    } catch {}
  }, [repo, model, maxTurns, autoMerge])

  // Apply pre-fill when props change
  useEffect(() => {
    if (initialRepo) setRepo(initialRepo)
  }, [initialRepo])

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt)
  }, [initialPrompt])

  const selectedRepo = repos.find(r => r.name === repo)
  const defaultBranch = selectedRepo?.git?.branch || 'main'

  async function handleDispatch(e) {
    e.preventDefault()
    if (!prompt.trim() || !repo || dispatching) return

    setDispatching(true)
    try {
      await onDispatch?.({
        repo,
        taskText: prompt.trim(),
        originalTask: initialPrompt || null,
        baseBranch: baseBranch.trim() || defaultBranch,
        model,
        maxTurns,
        autoMerge,
      })
      setPrompt('')
      onDispatchComplete?.()
    } catch (err) {
      console.error('Dispatch failed:', err)
    } finally {
      setDispatching(false)
    }
  }

  const branchOptions = selectedRepo?.git?.branches || []

  return (
    <div>
      <h2 className="text-[16px] font-semibold text-foreground mb-3">Dispatch Worker</h2>

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

        {/* Model + Max Turns + Auto-merge — single row */}
        <div className="flex items-end gap-3">
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
              {MODEL_OPTIONS.map(opt => (
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
              value={maxTurns}
              onChange={(e) => setMaxTurns(parseInt(e.target.value) || 10)}
              className="w-full h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground font-mono focus:outline-none focus:border-primary/30"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <div className="flex items-center gap-2 pb-0.5">
            <button
              type="button"
              onClick={() => setAutoMerge(v => !v)}
              className={cn(
                'w-7 h-[16px] rounded-full border transition-colors relative shrink-0 overflow-hidden',
                autoMerge
                  ? 'bg-primary/20 border-primary/40'
                  : 'bg-card border-border'
              )}
            >
              <span
                className={cn(
                  'absolute top-[2px] left-[2px] w-2.5 h-2.5 rounded-full transition-transform duration-200',
                  autoMerge
                    ? 'translate-x-[11px] bg-primary'
                    : 'translate-x-0 bg-muted-foreground/40'
                )}
              />
            </button>
            <span className="text-[11px] text-foreground/70 whitespace-nowrap">Auto-merge</span>
          </div>

          <div className="flex-1" />

          {/* Submit — right-aligned */}
          <button
            type="submit"
            disabled={!prompt.trim() || !repo || dispatching}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-semibold transition-all shrink-0',
              'bg-primary text-primary-foreground hover:brightness-110',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {dispatching ? (
              <Loader size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Dispatch
          </button>
        </div>
      </form>
    </div>
  )
}
