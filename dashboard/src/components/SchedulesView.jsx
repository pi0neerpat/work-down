import { useState, useEffect, useCallback, useMemo } from 'react'
import { CalendarClock, Plus, Pencil, Trash2, Loader, X, Play, Clock, CheckCircle2, XCircle, SkipForward, AlertTriangle } from 'lucide-react'
import { cn } from '../lib/utils'
import { DEFAULT_REPO_COLOR, MODEL_OPTIONS, getRepoColor } from '../lib/constants'
import Toggle from './Toggle'

const SCHEDULE_TYPES = [
  { value: 'job', label: 'Dispatch Job', description: 'Tracked in notes/jobs/' },
  { value: 'prompt', label: 'Prompt', description: 'Claude --print, no job tracking' },
  { value: 'loop', label: 'Loop', description: 'Linear/parallel loop scripts' },
  { value: 'shell', label: 'Shell', description: 'Raw shell command' },
]

const LOOP_TYPES = [
  { value: 'linear-implementation', label: 'Linear Implementation' },
  { value: 'linear-review', label: 'Linear Review' },
  { value: 'parallel-review', label: 'Parallel Review' },
]

function relativeTime(dateStr) {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  if (isNaN(diff)) return null
  const abs = Math.abs(diff)
  const past = diff < 0
  if (abs < 60000) return past ? 'just now' : 'in <1m'
  if (abs < 3600000) {
    const m = Math.round(abs / 60000)
    return past ? `${m}m ago` : `in ${m}m`
  }
  if (abs < 86400000) {
    const h = Math.round(abs / 3600000)
    return past ? `${h}h ago` : `in ${h}h`
  }
  const d = Math.round(abs / 86400000)
  return past ? `${d}d ago` : `in ${d}d`
}

function EventBadge({ type }) {
  if (!type) return null
  const config = {
    completed: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Passed' },
    failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-400/10', label: 'Failed' },
    skipped: { icon: SkipForward, color: 'text-amber-400', bg: 'bg-amber-400/10', label: 'Skipped' },
    started: { icon: Loader, color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Running' },
  }
  const c = config[type] || config.started
  const Icon = c.icon
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', c.bg, c.color)}>
      <Icon size={10} className={type === 'started' ? 'animate-spin' : ''} />
      {c.label}
    </span>
  )
}

function ScheduleForm({ repos, initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '')
  const [repo, setRepo] = useState(initial?.repo || repos[0]?.name || '')
  const [cron, setCron] = useState(initial?.cron || '0 9 * * 1-5')
  const [prompt, setPrompt] = useState(initial?.prompt || '')
  const [model, setModel] = useState(initial?.model || 'claude-opus-4-6')
  const [type, setType] = useState(initial?.type || 'job')
  const [loopType, setLoopType] = useState(initial?.loopType || 'linear-implementation')
  const [agentSpec, setAgentSpec] = useState(initial?.agentSpec || '')
  const [command, setCommand] = useState(initial?.command || '')
  const [recurring, setRecurring] = useState(initial?.recurring ?? true)

  const needsPrompt = type === 'prompt' || type === 'job'
  const needsLoop = type === 'loop'
  const needsCommand = type === 'shell'

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !repo || !cron.trim()) return
    if (needsPrompt && !prompt.trim()) return
    if (needsLoop && !loopType) return
    if (needsCommand && !command.trim()) return
    onSave({
      name: name.trim(), repo, cron: cron.trim(), prompt: prompt.trim(), model, type,
      loopType: needsLoop ? loopType : undefined,
      agentSpec: agentSpec.trim() || undefined,
      command: needsCommand ? command.trim() : undefined,
      recurring,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-card-border bg-card p-4 space-y-3 animate-fade-up">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Daily code review"
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground focus:outline-none focus:border-primary/30"
          >
            {SCHEDULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Repo</label>
          <select
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground focus:outline-none focus:border-primary/30"
          >
            {repos.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Cron Expression</label>
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 9 * * 1-5"
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
            style={{ fontFamily: 'var(--font-mono)' }}
          />
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">min hour dom month dow</p>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={recurring}
          onChange={e => setRecurring(e.target.checked)}
          className="rounded border-border"
        />
        <span className="text-[11px] text-muted-foreground">Recurring (auto-disables after one run if unchecked)</span>
      </label>

      {(needsPrompt || needsLoop) && (
        <div className="grid grid-cols-2 gap-3">
          {needsPrompt && (
            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-muted-foreground mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground focus:outline-none focus:border-primary/30"
              >
                {MODEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
          {needsLoop && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">Loop Type</label>
                <select
                  value={loopType}
                  onChange={(e) => setLoopType(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground focus:outline-none focus:border-primary/30"
                >
                  {LOOP_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-muted-foreground mb-1">Agent Spec (optional)</label>
                <input
                  value={agentSpec}
                  onChange={(e) => setAgentSpec(e.target.value)}
                  placeholder="claude:claude-opus-4-6"
                  className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
                />
              </div>
            </>
          )}
        </div>
      )}

      {needsPrompt && (
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Task for the scheduled worker..."
            rows={3}
            className="w-full px-2.5 py-2 rounded-md border border-border bg-background text-[12px] text-foreground placeholder:text-muted-foreground/40 leading-relaxed focus:outline-none focus:border-primary/30 resize-y"
          />
        </div>
      )}

      {needsCommand && (
        <div>
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Shell Command</label>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="./scripts/backup.sh"
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-40"
        >
          {saving ? <Loader size={12} className="animate-spin" /> : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground border border-border hover:bg-card-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function AdjacentSchedules({ schedules }) {
  if (!schedules || schedules.length === 0) return null
  return (
    <div className="mt-2 px-2 py-1.5 rounded border border-border/50 bg-background/50">
      <p className="text-[10px] font-medium text-muted-foreground/60 mb-1">Nearby schedules:</p>
      {schedules.map(s => (
        <div key={s.id} className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
          <span className="font-mono">{s.cron}</span>
          <span>{s.name}</span>
          <span className="text-muted-foreground/30">{s.repo}</span>
        </div>
      ))}
    </div>
  )
}

export default function SchedulesView({ overview }) {
  const repos = overview?.repos || []
  const [schedules, setSchedules] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [runningId, setRunningId] = useState(null)
  const [mutationError, setMutationError] = useState(null)

  const fetchSchedules = useCallback(async () => {
    try {
      const [schedRes, eventsRes] = await Promise.all([
        fetch('/api/schedules'),
        fetch('/api/schedule-events?limit=50'),
      ])
      if (schedRes.ok) {
        const data = await schedRes.json()
        setSchedules(data.schedules || [])
      }
      if (eventsRes.ok) {
        const data = await eventsRes.json()
        setEvents(data.events || [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSchedules()
    const interval = setInterval(fetchSchedules, 15000)
    return () => clearInterval(interval)
  }, [fetchSchedules])

  // Count recent failures
  const recentFailures = useMemo(() => {
    const oneDayAgo = Date.now() - 86400000
    return events.filter(e =>
      e.type === 'failed' && new Date(e.finishedAt || e.at).getTime() > oneDayAgo
    )
  }, [events])

  // Map scheduleId → latest event
  const latestEventBySchedule = useMemo(() => {
    const map = {}
    for (const e of events) {
      if (!map[e.scheduleId]) map[e.scheduleId] = e
    }
    return map
  }, [events])

  async function handleCreate(data) {
    setSaving(true)
    setMutationError(null)
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setShowForm(false)
        await fetchSchedules()
      } else {
        const body = await res.json().catch(() => ({}))
        setMutationError(body.error || `Create failed (${res.status})`)
      }
    } catch (err) {
      setMutationError(err.message || 'Create failed')
    }
    setSaving(false)
  }

  async function handleUpdate(id, data) {
    setSaving(true)
    setMutationError(null)
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setEditingId(null)
        await fetchSchedules()
      } else {
        const body = await res.json().catch(() => ({}))
        setMutationError(body.error || `Update failed (${res.status})`)
      }
    } catch (err) {
      setMutationError(err.message || 'Update failed')
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      setTimeout(() => setConfirmDelete(prev => prev === id ? null : prev), 3000)
      return
    }
    setMutationError(null)
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
      setConfirmDelete(null)
      await fetchSchedules()
    } catch (err) {
      setMutationError(err.message || 'Delete failed')
    }
  }

  async function handleToggle(id) {
    try {
      await fetch(`/api/schedules/${id}/toggle`, { method: 'POST' })
      await fetchSchedules()
    } catch {}
  }

  async function handleRunNow(id) {
    setRunningId(id)
    try {
      // Fire schedule run via the server (which shells out to cli.js schedule run)
      await fetch(`/api/schedules/${id}/run`, { method: 'POST' })
      await fetchSchedules()
    } catch {}
    setRunningId(null)
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader size={20} className="mx-auto text-muted-foreground/30 animate-spin-slow" />
      </div>
    )
  }

  return (
    <div>
      {/* Mutation error banner */}
      {mutationError && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/5 flex items-center justify-between gap-2">
          <span className="text-[12px] text-red-300">{mutationError}</span>
          <button onClick={() => setMutationError(null)} className="text-red-400 hover:text-red-300 text-xs shrink-0">dismiss</button>
        </div>
      )}

      {/* Failure banner */}
      {recentFailures.length > 0 && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/5 flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <span className="text-[12px] text-red-300">
            {recentFailures.length} scheduled job{recentFailures.length > 1 ? 's' : ''} failed in the last 24h
          </span>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[16px] font-semibold text-foreground">Scheduled Dispatches</h2>
          <p className="text-[12px] text-muted-foreground/60 mt-1">
            Define recurring tasks that automatically dispatch workers.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null) }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-primary text-primary-foreground hover:brightness-110 transition-all"
          >
            <Plus size={14} />
            Add Schedule
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6">
          <ScheduleForm
            repos={repos}
            onSave={handleCreate}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        </div>
      )}

      {schedules.length === 0 && !showForm ? (
        <div className="py-16 text-center rounded-lg border border-dashed border-border">
          <CalendarClock size={28} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60">No schedules defined.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all"
          >
            <Plus size={12} />
            Create Schedule
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map(schedule => {
            const repoColor = getRepoColor(overview, schedule.repo)
            const isEditing = editingId === schedule.id
            const latestEvent = latestEventBySchedule[schedule.id]
            const typeConfig = SCHEDULE_TYPES.find(t => t.value === schedule.type) || SCHEDULE_TYPES[0]

            if (isEditing) {
              return (
                <ScheduleForm
                  key={schedule.id}
                  repos={repos}
                  initial={schedule}
                  onSave={(data) => handleUpdate(schedule.id, data)}
                  onCancel={() => setEditingId(null)}
                  saving={saving}
                />
              )
            }

            return (
              <div
                key={schedule.id}
                className={cn(
                  'rounded-lg border border-card-border bg-card px-4 py-3 animate-fade-up',
                  !schedule.enabled && 'opacity-50'
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Toggle */}
                  <Toggle
                    checked={schedule.enabled}
                    onChange={() => handleToggle(schedule.id)}
                    size="md"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-foreground">{schedule.name}</p>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
                        style={{ background: `${repoColor}15`, color: repoColor, border: `1px solid ${repoColor}30` }}
                      >
                        {schedule.repo}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-card-hover text-muted-foreground">
                        {typeConfig.label}
                      </span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded',
                        schedule.recurring
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-amber-500/10 text-amber-400'
                      )}>
                        {schedule.recurring ? 'Recurring' : 'One-shot'}
                      </span>
                      {latestEvent && <EventBadge type={latestEvent.type} />}
                      {schedule.running && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-400">
                          <Loader size={10} className="animate-spin" /> Running
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/60">
                      <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                        {schedule.description || schedule.cron}
                      </span>
                      {schedule.nextRun && schedule.enabled && (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={10} />
                          Next: {relativeTime(schedule.nextRun)}
                        </span>
                      )}
                      {schedule.lastRun && (
                        <span>Last: {relativeTime(schedule.lastRun)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Run Now button */}
                    <button
                      onClick={() => handleRunNow(schedule.id)}
                      disabled={runningId === schedule.id || !schedule.enabled}
                      className="p-1.5 rounded text-muted-foreground/40 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors disabled:opacity-30"
                      title="Run now"
                    >
                      {runningId === schedule.id
                        ? <Loader size={12} className="animate-spin" />
                        : <Play size={12} />}
                    </button>
                    <button
                      onClick={() => setEditingId(schedule.id)}
                      className="p-1.5 rounded text-muted-foreground/40 hover:text-foreground hover:bg-card-hover transition-colors"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(schedule.id)}
                      className={cn(
                        'p-1.5 rounded transition-colors',
                        confirmDelete === schedule.id
                          ? 'text-status-failed bg-status-failed-bg'
                          : 'text-muted-foreground/40 hover:text-status-failed hover:bg-status-failed-bg'
                      )}
                      title={confirmDelete === schedule.id ? 'Click again to confirm' : 'Delete'}
                    >
                      {confirmDelete === schedule.id ? <X size={12} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-foreground/60 line-clamp-2">
                  {schedule.type === 'loop'
                    ? `Loop: ${schedule.loopType || 'linear-implementation'}${schedule.agentSpec ? ` (${schedule.agentSpec})` : ''}`
                    : schedule.type === 'shell'
                      ? `$ ${schedule.command}`
                      : schedule.prompt}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
