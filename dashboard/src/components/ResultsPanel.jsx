import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, AlertCircle, Loader, Clock, Ban, Square, Activity, ListChecks } from 'lucide-react'
import Markdown from 'react-markdown'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig } from './SwarmDetail'

const validationConfig = {
  needs_validation: { icon: AlertCircle, color: 'text-status-review', bg: 'bg-status-review-bg', border: 'border-status-review-border', label: 'Needs Review' },
  validated: { icon: CheckCircle, color: 'text-status-validated', bg: 'bg-status-validated-bg', border: 'border-status-active-border', label: 'Validated' },
  rejected: { icon: XCircle, color: 'text-status-failed', bg: 'bg-status-failed-bg', border: 'border-status-failed-border', label: 'Rejected' },
}

const mdComponents = {
  p: ({ children }) => <p className="leading-relaxed mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 mb-1.5 last:mb-0">{children}</ol>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5 mb-1.5 last:mb-0">{children}</ul>,
  li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-foreground mt-3 mb-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[13px] font-semibold text-foreground mt-2.5 mb-0.5 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-xs font-semibold text-foreground mt-2 mb-0.5 first:mt-0">{children}</h4>,
  code: ({ children }) => <code className="px-1 py-0.5 rounded bg-secondary/60 text-[11px] font-mono" style={{ fontFamily: 'var(--font-mono)' }}>{children}</code>,
  a: ({ href, children }) => <a href={href} className="text-primary underline underline-offset-2" target="_blank" rel="noopener noreferrer">{children}</a>,
  hr: () => <hr className="my-2 border-border" />,
}

const repoIdentityColors = {
  marketing: '#e0b44a',
  website: '#7b8af5',
  electron: '#34c9a0',
  hub: '#6ba8e8',
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

  // Empty state — no agent selected
  if (!agentId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Activity size={24} className="mx-auto mb-2 text-muted-foreground/20" />
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
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
          st.bg,
        )}>
          <StatusIcon
            size={20}
            className={cn(st.color, detail.status === 'in_progress' && 'animate-spin-slow')}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-foreground">
              {detail.taskName || detail.id}
            </h2>
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
              style={{
                background: `${repoColor}15`,
                color: repoColor,
                border: `1px solid ${repoColor}30`,
              }}
            >
              {detail.repo}
            </span>
            {val && (
              <span className={cn(
                'text-[10px] px-2 py-0.5 rounded-full border font-medium',
                val.bg, val.color, val.border
              )}>
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

        {/* Kill button for in_progress */}
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
            {killing ? (
              <Loader size={12} className="animate-spin" />
            ) : confirmKill ? (
              'Confirm Stop?'
            ) : (
              <span className="flex items-center gap-1.5"><Square size={12} /> Stop</span>
            )}
          </button>
        )}
      </div>

      {/* Results */}
      {detail.results && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Results</p>
          <div className="rounded-lg border border-card-border bg-card px-4 py-3 text-xs text-foreground/80 leading-relaxed">
            <Markdown components={mdComponents}>{detail.results}</Markdown>
          </div>
        </div>
      )}

      {/* Validation notes */}
      {detail.validationNotes && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Validation</p>
          <div className="rounded-lg border border-status-review-border bg-status-review-bg px-4 py-3 text-xs text-foreground/80 leading-relaxed">
            <Markdown components={mdComponents}>{detail.validationNotes}</Markdown>
          </div>
        </div>
      )}

      {/* Feedback flash */}
      {feedback && (
        <div
          className={cn(
            'rounded-md px-3 py-2 text-xs font-medium animate-fade-up mb-4',
            feedback.isError
              ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
              : 'bg-status-active-bg text-status-active border border-status-active-border'
          )}
        >
          {feedback.msg}
        </div>
      )}

      {/* Validate / Reject action buttons */}
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
          </div>

          {showRejectInput && (
            <div className="flex items-center gap-2 animate-slide-in">
              <input
                type="text"
                value={rejectNotes}
                onChange={e => setRejectNotes(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleReject() }}
                placeholder="Reason for rejection (required)"
                className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-status-failed-border"
                autoFocus
              />
              <button
                onClick={handleReject}
                disabled={actionLoading || !rejectNotes.trim()}
                className={cn(
                  'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                  'border border-status-failed-border bg-status-failed-bg text-status-failed',
                  'hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                Submit
              </button>
              <button
                onClick={() => { setShowRejectInput(false); setRejectNotes('') }}
                className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mark task as done — shown after validation */}
      {detail.validation === 'validated' && detail.taskName && !taskMarked && (
        <div className="mt-4">
          <button
            onClick={handleMarkDone}
            disabled={markingDone}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              'border border-status-validated-border bg-status-validated-bg text-status-validated',
              'hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {markingDone ? <Loader size={13} className="animate-spin" /> : <ListChecks size={13} />}
            Mark Todo as Done
          </button>
        </div>
      )}
      {taskMarked && (
        <div className="mt-4 flex items-center gap-1.5 text-xs text-status-active/70">
          <CheckCircle size={13} />
          <span>Task marked as done</span>
        </div>
      )}
    </div>
  )
}
