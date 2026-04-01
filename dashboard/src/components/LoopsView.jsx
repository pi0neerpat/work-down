import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCcw, Clock, Code2, ScanSearch, GitFork } from 'lucide-react'
import { cn, timeAgo } from '../lib/utils'
import { repoIdentityColors, AGENT_OPTIONS, getAgentBrandColor } from '../lib/constants'
import { useAgentModels } from '../lib/useAgentModels'
import AgentIcon from './AgentIcon'

const LOOP_TYPES = [
  { id: 'linear-implementation', label: 'Linear Impl',     icon: Code2 },
  { id: 'linear-review',         label: 'Linear Review',   icon: ScanSearch },
  { id: 'parallel-review',       label: 'Parallel Review', icon: GitFork },
]

/** Compact agent + model picker — mirrors DispatchSettingsRow's Agent+Model section */
function AgentModelPicker({ label, value, onChange }) {
  const models = useAgentModels(value.agent)

  // Snap model to first option when agent changes and current model isn't valid
  useEffect(() => {
    if (models.length > 0 && !models.find(m => m.value === value.model)) {
      onChange({ ...value, model: models[0].value })
    }
  }, [models, onChange, value])

  return (
    <div>
      {label && <label className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</label>}
      <div className="flex items-center gap-1.5">
        <div className="flex gap-1">
          {AGENT_OPTIONS.map(opt => {
            const isSelected = value.agent === opt.id
            const brandColor = getAgentBrandColor(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChange({ agent: opt.id, model: '' })}
                style={isSelected ? { color: brandColor, borderColor: `${brandColor}40`, backgroundColor: `${brandColor}18` } : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium border transition-colors',
                  isSelected
                    ? 'border-transparent'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                )}
              >
                <AgentIcon agent={opt.id} size={12} />
                {opt.label}
              </button>
            )
          })}
        </div>
        <select
          value={value.model}
          onChange={e => onChange({ ...value, model: e.target.value })}
          className="h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground focus:outline-none focus:border-primary/30 w-44"
        >
          {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
    </div>
  )
}

function defaultAgentModel() {
  return { agent: 'claude', model: '' }
}

function fmtAgent({ agent, model }) {
  return model ? `${agent}:${model}` : agent
}

function classifyLoop(job) {
  if (job.status === 'completed' || job.loopState?.complete) return 'completed'
  if (job.status === 'failed') return 'failed'
  if (job.status === 'in_progress') return 'active'
  return 'active'
}

const STATUS_COLORS = {
  active: '#4ade80',
  completed: '#8bab8f',
  rejected: '#f87171',
  failed: '#f87171',
}

function getLoopTypeIcon(loopTypeId) {
  return LOOP_TYPES.find(lt => lt.id === loopTypeId)?.icon || RefreshCcw
}

export default function LoopsView({ loops, overview, onSelectJob }) {
  const jobs = loops?.jobs || []
  const repos = useMemo(() => (overview?.repos || []).map(r => r.name), [overview])

  const [repo, setRepo] = useState('')
  const [loopType, setLoopType] = useState('linear-implementation')
  const [prompt, setPrompt] = useState('')
  const [agentSpec, setAgentSpec] = useState(defaultAgentModel())
  const [reviewers, setReviewers] = useState([defaultAgentModel()])
  const [synthesizer, setSynthesizer] = useState(defaultAgentModel())
  const [implementor, setImplementor] = useState(defaultAgentModel())
  const [btnPhase, setBtnPhase] = useState('idle') // idle | shaking | sliding | hidden | returning

  // Default repo once repos are available
  useEffect(() => {
    if (repos.length > 0 && !repo) setRepo(repos[0])
  }, [repos])

  // Load prompt when repo or loopType changes
  useEffect(() => {
    if (!repo || !loopType) return
    let cancelled = false
    fetch(`/api/loops/${encodeURIComponent(repo)}/prompt?type=${encodeURIComponent(loopType)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setPrompt(d.content || '') })
      .catch(() => { if (!cancelled) setPrompt('') })
    return () => { cancelled = true }
  }, [repo, loopType])

  const isReady = !!repo

  const handleLaunch = useCallback(async () => {
    if (!isReady || btnPhase !== 'idle') return

    setBtnPhase('shaking')
    setTimeout(() => setBtnPhase('sliding'), 400)
    setTimeout(() => setBtnPhase('hidden'), 800)

    try {
      const body = { repo, loopType, promptContent: prompt }
      if (loopType === 'parallel-review') {
        body.reviewerAgents = reviewers.map(fmtAgent)
        body.synthesizerAgent = fmtAgent(synthesizer)
        body.implementorAgent = fmtAgent(implementor)
      } else {
        body.agentSpec = fmtAgent(agentSpec)
      }
      const res = await fetch('/api/loops/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Loop launch failed')
      }
      if (data.sessionId) onSelectJob?.(data.sessionId)
      setTimeout(() => setBtnPhase('returning'), 1800)
      setTimeout(() => setBtnPhase('idle'), 2400)
    } catch (err) {
      console.error('Loop launch failed:', err)
      setBtnPhase('idle')
    }
  }, [repo, loopType, prompt, agentSpec, reviewers, synthesizer, implementor, onSelectJob, isReady, btnPhase])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[13px] font-semibold text-foreground mb-1">Loops</h2>
        <p className="text-[11px] text-muted-foreground">Multi-agent implementation and review loops.</p>
      </div>

      {/* Loop list */}
      {jobs.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-2">No loop jobs yet. Launch one below.</p>
      ) : (
        <div className="space-y-2">
          {jobs.map(job => {
            const repoColor = repoIdentityColors[job.repo] || 'var(--primary)'
            const category = classifyLoop(job)
            const statusColor = STATUS_COLORS[category] || STATUS_COLORS.active
            const duration = job.durationMinutes != null ? timeAgo(null, job.durationMinutes) : null
            const TypeIcon = getLoopTypeIcon(job.loopType)
            const detailTargetId = job.status === 'in_progress' && job.session ? job.session : null
            const isClickable = Boolean(detailTargetId)

            return (
              <div
                key={job.id}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={isClickable ? () => onSelectJob?.(detailTargetId) : undefined}
                onKeyDown={isClickable ? e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectJob?.(detailTargetId)
                  }
                } : undefined}
                className={cn(
                  'w-full text-left px-3.5 py-2.5 rounded-lg border bg-card transition-colors group',
                  isClickable ? 'hover:bg-card-hover cursor-pointer' : 'cursor-default'
                )}
                style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                onMouseEnter={isClickable ? e => { e.currentTarget.style.borderColor = 'rgba(139,171,143,0.35)' } : undefined}
                onMouseLeave={isClickable ? e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)' } : undefined}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0"
                    style={{ color: statusColor, background: `${statusColor}12`, borderColor: `${statusColor}30` }}
                  >
                    <TypeIcon size={11} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{job.taskName || job.loopType || job.id}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {duration && (
                        <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1 font-mono">
                          <Clock size={9} />{duration}
                        </span>
                      )}
                      {job.loopState?.iteration > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          Iter {job.loopState.iteration}
                          {job.loopState.lastVerdict && ` · ${job.loopState.lastVerdict}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full border font-medium capitalize"
                      style={{ background: `${repoColor}10`, color: repoColor, borderColor: `${repoColor}30` }}
                    >
                      {job.repo}
                    </span>
                    <span className="text-[11px] text-muted-foreground/40 transition-colors group-hover:text-primary">
                      {isClickable ? 'View live' : 'Log only'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Launch form */}
      <div className="border border-border rounded-lg p-4 space-y-4">
        <h3 className="text-[12px] font-semibold text-foreground">Launch Loop</h3>

        {/* Repo */}
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Repository</label>
          <div className="flex gap-1.5 flex-wrap">
            {repos.map(name => {
              const color = repoIdentityColors[name] || 'var(--primary)'
              const isSelected = repo === name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setRepo(name)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[12px] font-medium capitalize border transition-all',
                    isSelected
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                  )}
                  style={isSelected ? { borderColor: `${color}40`, backgroundColor: `${color}10` } : undefined}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: color }} />
                  {name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Loop type */}
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Loop Type</label>
          <div className="flex gap-1.5 flex-wrap">
            {LOOP_TYPES.map(lt => {
              const isSelected = loopType === lt.id
              const Icon = lt.icon
              return (
                <button
                  key={lt.id}
                  type="button"
                  onClick={() => setLoopType(lt.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-all',
                    isSelected
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                  )}
                  style={isSelected ? { borderColor: 'rgba(139,171,143,0.4)', backgroundColor: 'rgba(139,171,143,0.1)' } : undefined}
                >
                  <Icon size={11} />
                  {lt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={5}
            className={cn(
              'w-full px-3 py-2 rounded-md border border-border bg-card',
              'text-[13px] text-foreground placeholder:text-muted-foreground/40 leading-relaxed',
              'focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10',
              'resize-y'
            )}
            placeholder="Describe the task for the loop..."
          />
        </div>

        {/* Agent picker for linear types */}
        {loopType !== 'parallel-review' && (
          <AgentModelPicker label="Agent" value={agentSpec} onChange={setAgentSpec} />
        )}

        {/* Parallel-review agent pickers */}
        {loopType === 'parallel-review' && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-2">Reviewer Agents</label>
              <div className="space-y-2">
                {reviewers.map((r, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <AgentModelPicker
                      value={r}
                      onChange={v => { const next = [...reviewers]; next[i] = v; setReviewers(next) }}
                    />
                    {reviewers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setReviewers(reviewers.filter((_, j) => j !== i))}
                        className="h-8 px-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors shrink-0"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setReviewers([...reviewers, defaultAgentModel()])}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  + Add reviewer
                </button>
              </div>
            </div>

            <AgentModelPicker label="Synthesizer" value={synthesizer} onChange={setSynthesizer} />
            <AgentModelPicker label="Implementor" value={implementor} onChange={setImplementor} />
          </div>
        )}

        {/* Glow launch button */}
        <div className="flex justify-end">
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
          {/* Glow layers */}
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-500"
            style={{ opacity: isReady || btnPhase !== 'idle' ? 1 : 0 }}
          >
            <div className="absolute pointer-events-none animate-loading-halo" style={{ width: '204px', height: '66px', background: '#8bab8f', borderRadius: '50%', filter: 'blur(35px)', top: 'calc(50% - 33px)', left: 'calc(50% - 102px)' }} />
            <div className="absolute pointer-events-none animate-loading-glow" style={{ width: '108px', height: '38px', background: '#8bab8f', borderRadius: '50%', filter: 'blur(19px)', top: 'calc(50% - 19px)', left: 'calc(50% - 54px)' }} />
            <div className="absolute pointer-events-none animate-loading-glow-shift" style={{ width: '90px', height: '32px', background: '#7ea89a', borderRadius: '50%', filter: 'blur(17px)', top: 'calc(50% - 16px)', left: 'calc(50% - 45px)' }} />
          </div>

          <button
            type="button"
            onClick={handleLaunch}
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
            <RefreshCcw size={15} />
            Dispatch
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
