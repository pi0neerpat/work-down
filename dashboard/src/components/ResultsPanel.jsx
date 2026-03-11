import { useState, useEffect, useMemo } from 'react'
import { CheckCircle, XCircle, Loader, Clock, Square, Activity, ListChecks, FileCode2, Wrench, Lightbulb } from 'lucide-react'
import Markdown from 'react-markdown'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig, validationConfig } from '../lib/statusConfig'
import { repoIdentityColors } from '../lib/constants'
import { mdComponents } from './mdComponents'

function parseStructuredResults(raw) {
  if (!raw) return null
  const lines = raw.split('\n')

  const fileEdited = []
  const changes = []
  const reasons = []

  let section = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const headerMatch = trimmed.match(/^##+\s*(.+)$/)
    if (headerMatch) {
      const label = headerMatch[1].toLowerCase()
      if (label.includes('file')) section = 'file'
      else if (label.includes('change')) section = 'changes'
      else if (label.includes('reason') || label.includes('why')) section = 'reasons'
      else section = null
      continue
    }

    const fileMatch = trimmed.match(/^files?\s+edited\s*:\s*(.+)$/i) || trimmed.match(/^file\s+edited\s*:\s*(.+)$/i)
    if (fileMatch) {
      fileEdited.push(fileMatch[1])
      continue
    }

    const reasonMatch = trimmed.match(/^reason\s*:\s*(.+)$/i)
    if (reasonMatch) {
      reasons.push(reasonMatch[1])
      continue
    }

    if (section === 'file') {
      fileEdited.push(trimmed.replace(/^[-*]\s*/, ''))
    } else if (section === 'changes') {
      changes.push(trimmed.replace(/^[-*]\s*/, ''))
    } else if (section === 'reasons') {
      reasons.push(trimmed.replace(/^[-*]\s*/, ''))
    } else if (/^[-*]\s+/.test(trimmed)) {
      changes.push(trimmed.replace(/^[-*]\s*/, ''))
    }
  }

  if (fileEdited.length === 0 && changes.length === 0 && reasons.length === 0) return null
  return { fileEdited, changes, reasons }
}

function ResultsSummary({ text }) {
  const parsed = useMemo(() => parseStructuredResults(text), [text])

  if (!parsed) {
    return (
      <div className="rounded-lg border border-card-border bg-card px-5 py-4 text-sm text-foreground/90 leading-loose">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Result Summary</p>
        <Markdown components={mdComponents}>{text}</Markdown>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {parsed.fileEdited.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
            <FileCode2 size={12} />
            File Edited
          </p>
          <div className="space-y-1">
            {parsed.fileEdited.map((item, i) => (
              <p key={`${item}-${i}`} className="font-mono text-[12px] text-foreground/90 break-all" style={{ fontFamily: 'var(--font-mono)' }}>
                {item}
              </p>
            ))}
          </div>
        </div>
      )}

      {parsed.changes.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
            <Wrench size={12} />
            Changes
          </p>
          <ul className="space-y-1 text-[13px] text-foreground/85 leading-relaxed">
            {parsed.changes.map((item, i) => (
              <li key={`${item}-${i}`} className="flex items-start gap-2">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-status-active shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsed.reasons.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
            <Lightbulb size={12} />
            Reason
          </p>
          <div className="text-[13px] text-foreground/85 leading-loose space-y-1">
            {parsed.reasons.map((item, i) => (
              <p key={`${item}-${i}`}>{item}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ResultsPanel({ agentId, onSwarmRefresh, onOverviewRefresh }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [confirmKill, setConfirmKill] = useState(false)
  const [killing, setKilling] = useState(false)
  const [taskMarked, setTaskMarked] = useState(false)
  const [markingDone, setMarkingDone] = useState(false)

  useEffect(() => {
    if (!agentId) { setDetail(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    setShowRejectInput(false)
    setRejectNotes('')
    setFeedback(null)
    setConfirmKill(false)
    setTaskMarked(false)
    setMarkingDone(false)

    async function fetchDetail() {
      try {
        const res = await fetch(`/api/swarm/${agentId}`)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const data = await res.json()
        if (!cancelled) setDetail(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDetail()
    return () => { cancelled = true }
  }, [agentId])

  function showFeedbackMsg(msg, isError = false) {
    setFeedback({ msg, isError })
    setTimeout(() => setFeedback(null), 2000)
  }

  async function handleValidate() {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/swarm/${agentId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `${res.status} ${res.statusText}`)
      }
      const result = await res.json()
      setDetail(prev => prev ? { ...prev, validation: result.validation } : prev)
      showFeedbackMsg('Validated')
      onSwarmRefresh?.()
      onOverviewRefresh?.()
    } catch (err) {
      showFeedbackMsg(err.message || 'Validate failed', true)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject() {
    if (!rejectNotes.trim()) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/swarm/${agentId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: rejectNotes.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `${res.status} ${res.statusText}`)
      }
      const result = await res.json()
      setDetail(prev => prev ? { ...prev, validation: result.validation, validationNotes: rejectNotes.trim() } : prev)
      setShowRejectInput(false)
      setRejectNotes('')
      showFeedbackMsg('Rejected')
      onSwarmRefresh?.()
      onOverviewRefresh?.()
    } catch (err) {
      showFeedbackMsg(err.message || 'Reject failed', true)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleKill() {
    if (!confirmKill) {
      setConfirmKill(true)
      setTimeout(() => setConfirmKill(false), 3000)
      return
    }
    setKilling(true)
    try {
      const res = await fetch(`/api/swarm/${agentId}/kill`, { method: 'POST' })
      if (res.ok) {
        onSwarmRefresh?.()
        const res2 = await fetch(`/api/swarm/${agentId}`)
        if (res2.ok) setDetail(await res2.json())
      }
    } catch { /* ignore */ }
    setKilling(false)
    setConfirmKill(false)
  }

  async function handleMarkDone() {
    if (!detail?.taskName || !detail?.repo) return
    setMarkingDone(true)
    try {
      const res = await fetch('/api/tasks/done-by-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: detail.repo, text: detail.taskName }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `${res.status} ${res.statusText}`)
      }
      setTaskMarked(true)
      showFeedbackMsg('Task marked as done')
      onOverviewRefresh?.()
    } catch (err) {
      showFeedbackMsg(err.message || 'Failed to mark task', true)
    } finally {
      setMarkingDone(false)
    }
  }

  if (!agentId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Activity size={24} className="mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground/50">Select a swarm agent to view results</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader size={18} className="animate-spin" />
          <span className="text-sm">Loading agent details...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <XCircle size={24} className="mx-auto mb-2 text-status-failed/50" />
          <p className="text-sm text-muted-foreground">Failed to load agent</p>
          <p className="text-xs text-muted-foreground/60 mt-1">{error}</p>
        </div>
      </div>
    )
  }

  if (!detail) return null

  const st = statusConfig[detail.status] || statusConfig.unknown
  const StatusIcon = st.icon
  const val = validationConfig[detail.validation]
  const repoColor = repoIdentityColors[detail.repo] || 'var(--primary)'
  const relativeTime = timeAgo(detail.started, detail.durationMinutes)

  const canAct = (detail.validation === 'needs_validation' || detail.validation === 'none') &&
    !(detail.validation === 'validated' || detail.validation === 'rejected')

  return (
    <div className="animate-fade-up">
      <div className="flex items-start gap-3 mb-5">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center shrink-0', st.bg)}>
          <StatusIcon size={20} className={cn(st.color, detail.status === 'in_progress' && 'animate-spin-slow')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-foreground">{detail.taskName || detail.id}</h2>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
              style={{ background: `${repoColor}15`, color: repoColor, border: `1px solid ${repoColor}30` }}
            >
              {detail.repo}
            </span>
            {val && (
              <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', val.bg, val.color, val.border)}>
                {val.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className={cn('font-medium', st.color)}>{st.label}</span>
            {relativeTime && (
              <span className="flex items-center gap-1 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                <Clock size={10} />
                {relativeTime}
              </span>
            )}
            {detail.progressCount > 0 && (
              <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                {detail.progressCount} steps
              </span>
            )}
          </div>
        </div>

        {detail.status === 'in_progress' && (
          <button
            onClick={handleKill}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all shrink-0',
              confirmKill
                ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                : 'text-muted-foreground hover:text-status-failed hover:bg-status-failed-bg border border-transparent hover:border-status-failed-border'
            )}
            disabled={killing}
          >
            {killing ? <Loader size={12} className="animate-spin" /> : confirmKill ? 'Confirm Stop?' : <span className="flex items-center gap-1.5"><Square size={12} /> Stop</span>}
          </button>
        )}
      </div>

      {detail.results && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Results</p>
          <ResultsSummary text={detail.results} />
        </div>
      )}

      {detail.validationNotes && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Validation</p>
          <div className="rounded-lg border border-status-review-border bg-status-review-bg px-4 py-3 text-xs text-foreground/80 leading-relaxed">
            <Markdown components={mdComponents}>{detail.validationNotes}</Markdown>
          </div>
        </div>
      )}

      {feedback && (
        <div className={cn('rounded-md px-3 py-2 text-xs font-medium animate-fade-up mb-4', feedback.isError
          ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
          : 'bg-status-active-bg text-status-active border border-status-active-border')}>
          {feedback.msg}
        </div>
      )}

      {canAct && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              disabled={actionLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                'border border-status-active-border bg-status-active-bg text-status-active',
                'hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <CheckCircle size={13} />
              Validate
            </button>
            <button
              onClick={() => {
                setShowRejectInput(!showRejectInput)
                setRejectNotes('')
              }}
              disabled={actionLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                'border border-status-failed-border bg-status-failed-bg text-status-failed',
                'hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <XCircle size={13} />
              Reject
            </button>
            {!taskMarked && detail.status === 'completed' && (
              <button
                onClick={handleMarkDone}
                disabled={markingDone}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  'border border-border bg-card text-foreground/80 hover:bg-card-hover disabled:opacity-50'
                )}
                title="Mark matching task as done in todo"
              >
                {markingDone ? <Loader size={13} className="animate-spin" /> : <ListChecks size={13} />}
                Mark Task Done
              </button>
            )}
          </div>

          {showRejectInput && (
            <div className="flex items-center gap-2 animate-slide-in">
              <input
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Reason for rejection..."
                className="flex-1 h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-status-review/40"
              />
              <button
                onClick={handleReject}
                disabled={!rejectNotes.trim() || actionLoading}
                className="h-8 px-3 rounded-md text-xs font-medium bg-status-failed text-white disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
