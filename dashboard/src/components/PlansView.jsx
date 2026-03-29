import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Pencil, Check, Play, AlertTriangle, RotateCcw, Wrench } from 'lucide-react'
import { useAgentModels } from '../lib/useAgentModels'
import DispatchSettingsRow from './DispatchSettingsRow'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../lib/utils'
import { repoIdentityColors } from '../lib/constants'
import { mdComponents } from './mdComponents'

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Date.now() - new Date(isoStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function stripMetadata(content) {
  return content
    .split('\n')
    .filter(l => !l.match(/^(Dispatched|Job|Status):\s*/))
    .join('\n')
    .replace(/^\n+/, '')
}

const JOB_STATUS_CHIP = {
  in_progress: { label: 'running', color: 'var(--status-active)' },
  needs_validation: { label: 'review', color: 'var(--status-review)' },
  completed: { label: 'done', color: 'var(--status-complete)' },
  failed: { label: 'failed', color: 'var(--status-failed)' },
}

function resolveJobStatus(plan, swarm) {
  if (!plan.jobSlug) return plan.dispatched ? 'dispatched' : null
  const agent = swarm?.agents?.find(a => a.id === plan.jobSlug)
  return agent?.status || 'dispatched'
}

function PlanCard({ plan, onSelect, swarm }) {
  const color = repoIdentityColors[plan.repo] || 'var(--primary)'
  const jobStatus = resolveJobStatus(plan, swarm)
  // Job execution state takes priority; fall back to user-set readiness
  const jobChip = jobStatus ? JOB_STATUS_CHIP[jobStatus] : null
  const showReady = !jobChip && jobStatus !== 'dispatched' && plan.planStatus === 'ready'

  return (
    <button
      onClick={() => onSelect(plan)}
      className="w-full text-left px-4 py-3 rounded-lg border border-border bg-card hover:bg-card-hover transition-colors group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-1 min-w-0 text-[13px] font-medium text-foreground truncate">
          {plan.title}
        </span>
        {jobChip ? (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ color: jobChip.color, background: `${jobChip.color}18` }}>
            {jobChip.label}
          </span>
        ) : jobStatus === 'dispatched' ? (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground border border-border">
            dispatched
          </span>
        ) : showReady ? (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ color: '#8bab8f', background: '#8bab8f18' }}>
            ready
          </span>
        ) : null}
        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ color, background: `${color}18` }}>
          {plan.repo}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground/60 w-16 text-right">
          {timeAgo(plan.lastModified)}
        </span>
      </div>
    </button>
  )
}

function readDispatchSaved() {
  try { return JSON.parse(localStorage.getItem('dispatch-settings')) || {} } catch { return {} }
}
function writeDispatchSaved(patch) {
  try {
    const prev = readDispatchSaved()
    localStorage.setItem('dispatch-settings', JSON.stringify({ ...prev, ...patch }))
  } catch {}
}

function PlanDispatchBar({ plan, swarm, settings: appSettings, onDispatch }) {
  const isFinished = ['completed', 'failed'].includes(resolveJobStatus(plan, swarm))

  // Share state with dispatch-settings so preferences stay consistent across views
  const saved = useRef(null)
  if (!saved.current) { saved.current = readDispatchSaved() }
  const s = saved.current
  const agentSettings = appSettings?.agents || {}

  const [agent, setAgentRaw] = useState(s.agent || 'claude')
  const [model, setModelRaw] = useState(s.model || agentSettings[s.agent || 'claude']?.defaultModel || '')
  const [maxTurns, setMaxTurnsRaw] = useState(() => {
    const cfg = agentSettings[s.agent || 'claude'] || {}
    return 'defaultMaxTurns' in cfg ? cfg.defaultMaxTurns : 10
  })
  const [useWorktree, setUseWorktreeRaw] = useState(s.useWorktree ?? false)
  const [autoMerge, setAutoMergeRaw] = useState(s.autoMerge ?? false)
  const [plainOutput, setPlainOutputRaw] = useState(s.plainOutput ?? !(agentSettings[s.agent || 'claude']?.tuiMode ?? true))
  const models = useAgentModels(agent)

  const [editInstructions, setEditInstructions] = useState('')
  const [implementDispatching, setImplementDispatching] = useState(false)
  const [editDispatching, setEditDispatching] = useState(false)

  const setModel = v => { setModelRaw(v); writeDispatchSaved({ model: v }) }
  const setMaxTurns = v => { setMaxTurnsRaw(v) }
  const setUseWorktree = v => { setUseWorktreeRaw(v); writeDispatchSaved({ useWorktree: v }) }
  const setAutoMerge = v => { setAutoMergeRaw(v); writeDispatchSaved({ autoMerge: v }) }
  const setPlainOutput = v => { setPlainOutputRaw(v); writeDispatchSaved({ plainOutput: v }) }

  function switchAgent(newAgent) {
    const defaults = agentSettings[newAgent] || {}
    const newModel = defaults.defaultModel || ''
    const newTurns = 'defaultMaxTurns' in defaults ? defaults.defaultMaxTurns : (newAgent === 'claude' ? 10 : null)
    const newPlainOutput = !(defaults.tuiMode ?? true)
    setAgentRaw(newAgent); setModelRaw(newModel); setMaxTurnsRaw(newTurns); setPlainOutputRaw(newPlainOutput)
    writeDispatchSaved({ agent: newAgent, model: newModel, plainOutput: newPlainOutput })
  }

  useEffect(() => {
    if (models.length > 0 && !models.find(m => m.value === model)) {
      const newModel = agentSettings[agent]?.defaultModel || models[0].value
      setModel(newModel)
    }
  }, [models])

  const isCodex = agent === 'codex'
  const sharedSettings = {
    agent, onSwitchAgent: switchAgent,
    model, setModel, models,
    maxTurns, setMaxTurns,
    useWorktree, setUseWorktree,
    autoMerge, setAutoMerge,
    plainOutput, setPlainOutput,
  }

  async function handleImplement() {
    setImplementDispatching(true)
    try {
      await onDispatch({
        repo: plan.repo, taskText: `plans/${plan.slug}.md`,
        agent, model, maxTurns: isCodex ? null : maxTurns,
        useWorktree, autoMerge, plainOutput, planSlug: plan.slug,
      })
    } finally { setImplementDispatching(false) }
  }

  async function handleEdit() {
    const basePrompt = 'Expand and refine this plan in place. Research any open questions, fill in implementation details, and update the file.'
    const taskText = `plans/${plan.slug}.md\n\n${editInstructions.trim() || basePrompt}`
    setEditDispatching(true)
    try {
      await onDispatch({
        repo: plan.repo, taskText,
        agent, model, maxTurns: isCodex ? null : maxTurns,
        useWorktree, autoMerge, plainOutput, planSlug: plan.slug,
      })
    } finally { setEditDispatching(false) }
  }

  return (
    <div className="border-t border-border pt-4 mt-2 flex flex-col gap-4">

      {/* Shared settings */}
      <div className="flex items-start gap-3 flex-wrap">
        <DispatchSettingsRow {...sharedSettings} />
      </div>

      {/* Implement row */}
      <div className="flex items-center justify-between pt-1 border-t border-border/50">
        <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">Implement</span>
        <div className="flex items-center gap-2">
          {isFinished && (
            <button
              onClick={handleImplement}
              className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors"
            >
              <RotateCcw size={12} />
              Run again
            </button>
          )}
          <div className="relative inline-flex items-center justify-center">
            <div className="absolute pointer-events-none animate-loading-halo" style={{ width: '160px', height: '52px', background: '#8bab8f', borderRadius: '50%', filter: 'blur(26px)', top: 'calc(50% - 26px)', left: 'calc(50% - 80px)', opacity: 0.5 }} />
            <button
              onClick={handleImplement}
              disabled={implementDispatching}
              style={{ background: 'linear-gradient(135deg, #8bab8f 0%, #6d9472 100%)', color: '#1a1b1e', boxShadow: '0 0 8px 2px rgba(139,171,143,0.2)' }}
              className="relative z-10 inline-flex items-center gap-1.5 pl-4 pr-5 h-9 rounded-full text-[12px] font-semibold transition-transform duration-150 hover:scale-105 active:scale-[0.97] disabled:opacity-60 disabled:scale-100"
            >
              <Play size={13} fill="currentColor" />
              {implementDispatching ? 'Starting…' : 'Dispatch'}
            </button>
          </div>
        </div>
      </div>

      {/* Edit Plan row */}
      <div className="flex flex-col gap-2 pt-1 border-t border-border/50">
        <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">Edit Plan</span>
        <textarea
          value={editInstructions}
          onChange={e => setEditInstructions(e.target.value)}
          placeholder="Edit instructions… (optional — defaults to expand and refine)"
          rows={2}
          className={cn(
            'w-full px-3 py-2 rounded-lg border border-border bg-card',
            'text-[12px] text-foreground leading-relaxed',
            'focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10',
            'resize-none placeholder:text-muted-foreground/40'
          )}
        />
        <div className="flex justify-end">
          <button
            onClick={handleEdit}
            disabled={editDispatching}
            className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-full text-[12px] font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-60"
          >
            <Wrench size={12} />
            {editDispatching ? 'Starting…' : 'Start Edit'}
          </button>
        </div>
      </div>

    </div>
  )
}

function PlanDetail({ plan: initialPlan, onBack, onDispatch, settings, swarm }) {
  const [plan, setPlan] = useState(initialPlan)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [togglingReady, setTogglingReady] = useState(false)

  const color = repoIdentityColors[plan.repo] || 'var(--primary)'
  const jobStatus = resolveJobStatus(plan, swarm)
  const isRunning = jobStatus === 'in_progress'
  const isReady = plan.planStatus === 'ready'

  function enterEdit() {
    setEditContent(stripMetadata(plan.content))
    setIsEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/plans/${plan.repo}/${plan.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      })
      setPlan(p => ({ ...p, content: editContent }))
      setIsEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function toggleReady() {
    const newStatus = isReady ? null : 'ready'
    setTogglingReady(true)
    try {
      await fetch(`/api/plans/${plan.repo}/${plan.slug}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      setPlan(p => ({ ...p, planStatus: newStatus }))
    } finally {
      setTogglingReady(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={13} />
          Plans
        </button>
        <span className="text-muted-foreground/30">/</span>
        <span className="text-[13px] font-medium text-foreground flex-1 min-w-0 truncate">{plan.title}</span>
        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ color, background: `${color}18` }}>
          {plan.repo}
        </span>

        {/* Ready toggle */}
        {!isEditing && (
          <button
            onClick={toggleReady}
            disabled={togglingReady}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-medium transition-all disabled:opacity-50',
              isReady
                ? 'text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
            )}
            style={isReady ? { color: '#8bab8f', borderColor: '#8bab8f40', backgroundColor: '#8bab8f18' } : undefined}
            title={isReady ? 'Mark as draft' : 'Mark as ready'}
          >
            <Check size={12} />
            {isReady ? 'Ready' : 'Mark ready'}
          </button>
        )}

        {/* Edit / Save */}
        {isEditing ? (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] font-medium transition-colors disabled:opacity-50"
            style={{ color: '#8bab8f', borderColor: '#8bab8f40', backgroundColor: '#8bab8f18' }}
          >
            <Check size={12} />
            {saving ? 'Saving…' : 'Save'}
          </button>
        ) : (
          <button
            onClick={enterEdit}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card text-[12px] text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors"
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </div>

      {/* Active job warning */}
      {isEditing && isRunning && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md border text-[12px]"
          style={{ color: 'var(--status-review)', borderColor: 'var(--status-review-border)', backgroundColor: 'var(--status-review-bg)' }}
        >
          <AlertTriangle size={13} className="shrink-0" />
          Agent is currently working from this plan
        </div>
      )}

      {/* Content */}
      {isEditing ? (
        <textarea
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          className={cn(
            'w-full min-h-[400px] px-4 py-3 rounded-lg border border-border bg-card',
            'text-[13px] text-foreground font-mono leading-relaxed',
            'focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10',
            'resize-y'
          )}
          style={{ fontFamily: 'var(--font-mono)' }}
          autoFocus
        />
      ) : (
        <div className="px-4 py-3 rounded-lg border border-border bg-card text-[13px] text-foreground/90 leading-relaxed">
          <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{stripMetadata(plan.content)}</Markdown>
        </div>
      )}

      {/* Dispatch bar */}
      {!isEditing && (
        <PlanDispatchBar
          plan={plan}
          swarm={swarm}
          settings={settings}
          onDispatch={onDispatch}
        />
      )}
    </div>
  )
}

const FILTER_KEY = 'plansView:repoFilter'

function readSavedFilter() {
  try { return localStorage.getItem(FILTER_KEY) || null } catch { return null }
}

export default function PlansView({ overview, swarm, onDispatch, settings }) {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [repoFilter, setRepoFilter] = useState(readSavedFilter)

  const repos = overview?.repos || []

  function setRepoFilterPersisted(val) {
    try {
      if (val) localStorage.setItem(FILTER_KEY, val)
      else localStorage.removeItem(FILTER_KEY)
    } catch {}
    setRepoFilter(val)
  }

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/plans')
      if (res.ok) setPlans(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPlans() }, [fetchPlans])

  const handleBack = useCallback(() => {
    setSelectedPlan(null)
    fetchPlans() // refresh in case edits were made
  }, [fetchPlans])

  if (selectedPlan) {
    return (
      <PlanDetail
        plan={selectedPlan}
        onBack={handleBack}
        onDispatch={onDispatch}
        settings={settings}
        swarm={swarm}
      />
    )
  }

  const visiblePlans = repoFilter ? plans.filter(p => p.repo === repoFilter) : plans

  return (
    <div className="flex flex-col gap-4">
      {/* Repo filter */}
      {repos.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setRepoFilterPersisted(null)}
            className={cn(
              'px-2.5 py-1 rounded-md text-[12px] font-medium border transition-all',
              repoFilter === null
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
            )}
            style={repoFilter === null ? { borderColor: '#8bab8f40', backgroundColor: '#8bab8f10' } : undefined}
          >
            All
          </button>
          {repos.map(r => {
            const color = repoIdentityColors[r.name] || 'var(--primary)'
            const isActive = repoFilter === r.name
            return (
              <button
                key={r.name}
                onClick={() => setRepoFilterPersisted(isActive ? null : r.name)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[12px] font-medium capitalize border transition-all',
                  isActive
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                )}
                style={isActive ? { borderColor: `${color}40`, backgroundColor: `${color}10` } : undefined}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: color }} />
                {r.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Plan list */}
      {loading ? (
        <p className="text-[12px] text-muted-foreground/60 py-4">Loading plans…</p>
      ) : visiblePlans.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[13px] text-muted-foreground/60">No plans found.</p>
          <p className="text-[11px] text-muted-foreground/40 mt-1">
            Add <code className="font-mono">plans/*.md</code> files to a repo to get started.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visiblePlans.map(plan => (
            <PlanCard
              key={`${plan.repo}/${plan.slug}`}
              plan={plan}
              onSelect={setSelectedPlan}
              swarm={swarm}
            />
          ))}
        </div>
      )}
    </div>
  )
}
