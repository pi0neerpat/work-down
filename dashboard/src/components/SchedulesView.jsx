import { useState, useEffect, useCallback } from 'react'
import { CalendarClock, Plus, Pencil, Trash2, Loader, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { DEFAULT_REPO_COLOR, MODEL_OPTIONS, getRepoColor } from '../lib/constants'
import Toggle from './Toggle'

function ScheduleForm({ repos, initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name || '')
  const [repo, setRepo] = useState(initial?.repo || repos[0]?.name || '')
  const [cron, setCron] = useState(initial?.cron || '0 9 * * 1-5')
  const [prompt, setPrompt] = useState(initial?.prompt || '')
  const [model, setModel] = useState(initial?.model || 'claude-opus-4-6')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !repo || !cron.trim() || !prompt.trim()) return
    onSave({ name: name.trim(), repo, cron: cron.trim(), prompt: prompt.trim(), model })
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
          <label className="block text-[10px] font-medium text-muted-foreground mb-1">Repo</label>
          <select
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground focus:outline-none focus:border-primary/30"
          >
            {repos.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <div>
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
      </div>

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

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim() || !prompt.trim()}
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

export default function SchedulesView({ overview }) {
  const repos = overview?.repos || []
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules')
      if (res.ok) {
        const data = await res.json()
        setSchedules(data.schedules || [])
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSchedules()
  }, [fetchSchedules])

  async function handleCreate(data) {
    setSaving(true)
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setShowForm(false)
        await fetchSchedules()
      }
    } catch {}
    setSaving(false)
  }

  async function handleUpdate(id, data) {
    setSaving(true)
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        setEditingId(null)
        await fetchSchedules()
      }
    } catch {}
    setSaving(false)
  }

  async function handleDelete(id) {
    if (confirmDelete !== id) {
      setConfirmDelete(id)
      setTimeout(() => setConfirmDelete(prev => prev === id ? null : prev), 3000)
      return
    }
    try {
      await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
      setConfirmDelete(null)
      await fetchSchedules()
    } catch {}
  }

  async function handleToggle(id) {
    try {
      await fetch(`/api/schedules/${id}/toggle`, { method: 'POST' })
      await fetchSchedules()
    } catch {}
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
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-foreground">{schedule.name}</p>
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
                        style={{ background: `${repoColor}15`, color: repoColor, border: `1px solid ${repoColor}30` }}
                      >
                        {schedule.repo}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/60">
                      <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>{schedule.cron}</span>
                      {schedule.lastRun && (
                        <span>Last: {new Date(schedule.lastRun).toLocaleDateString()}</span>
                      )}
                      {schedule.nextRun && (
                        <span>Next: {new Date(schedule.nextRun).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
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

                <p className="mt-2 text-[11px] text-foreground/60 line-clamp-2">{schedule.prompt}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
