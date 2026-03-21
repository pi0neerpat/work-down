import { useState, useEffect } from 'react'
import { Activity, CheckCircle, XCircle, AlertCircle, Loader, Clock, Ban, Square } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig, validationConfig } from '../lib/statusConfig'
import { repoIdentityColors } from '../lib/constants'
import { mdComponents } from './mdComponents'

export default function SwarmDetail({ agentId, onJobsRefresh, onOverviewRefresh }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [confirmKill, setConfirmKill] = useState(false)
  const [killing, setKilling] = useState(false)

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    setShowRejectInput(false)
    setRejectNotes('')
    setFeedback(null)
    setConfirmKill(false)

    async function fetchDetail() {
      try {
        const res = await fetch(`/api/jobs/${agentId}`)
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
      const res = await fetch(`/api/jobs/${agentId}/validate`, {
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
      onJobsRefresh?.()
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
      const res = await fetch(`/api/jobs/${agentId}/reject`, {
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
      onJobsRefresh?.()
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
      const res = await fetch(`/api/jobs/${agentId}/kill`, { method: 'POST' })
      if (res.ok) {
        onJobsRefresh?.()
        const res2 = await fetch(`/api/jobs/${agentId}`)
        if (res2.ok) setDetail(await res2.json())
      }
    } catch { /* ignore */ }
    setKilling(false)
    setConfirmKill(false)
  }

  if (!agentId) return null

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground/50">
          <Loader size={18} className="animate-spin-slow" />
          <span className="text-sm">Loading agent details...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <XCircle size={24} className="mx-auto mb-2 text-status-failed/40" />
          <p className="text-sm text-muted-foreground/50">Failed to load agent</p>
          <p className="text-xs text-muted-foreground/30 mt-1">{error}</p>
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
                background: `${repoColor}10`,
                color: repoColor,
                border: `1px solid ${repoColor}20`,
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
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground/50">
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
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0',
              confirmKill
                ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                : 'text-muted-foreground/40 hover:text-status-failed hover:bg-status-failed-bg border border-transparent hover:border-status-failed-border'
            )}
            disabled={killing}
          >
            {killing ? (
              <Loader size={12} className="animate-spin-slow" />
            ) : confirmKill ? (
              'Confirm Stop?'
            ) : (
              <span className="flex items-center gap-1.5"><Square size={12} /> Stop</span>
            )}
          </button>
        )}
      </div>

      {/* Progress timeline */}
      {detail.progressEntries?.length > 0 && (
        <div className="mb-5">
          <p className="text-[10px] text-muted-foreground/50 font-medium mb-2">
            Progress Timeline
          </p>
          <div className="relative pl-5 rounded-lg border border-card-border bg-card p-5">
            <div
              className="absolute left-[20px] top-[20px] bottom-[20px] w-px"
              style={{ background: 'rgba(140, 140, 150, 0.05)' }}
            />
            {detail.progressEntries.map((entry, i) => {
              const isLast = i === detail.progressEntries.length - 1
              return (
                <div
                  key={i}
                  className="relative flex items-start min-h-[32px] pb-2 animate-slide-in group"
                  style={{ animationDelay: `${i * 30}ms` }}
                  title={entry}
                >
                  <div
                    className="absolute -left-1 top-[3px] w-[8px] h-[8px] rounded-full border-[1.5px] shrink-0 z-10"
                    style={{
                      background: isLast ? st.dotColor : 'var(--background)',
                      borderColor: isLast ? st.dotColor : 'rgba(140, 140, 150, 0.12)',
                    }}
                  />
                  <span className="text-xs text-foreground/60 truncate leading-tight pl-3">
                    {entry}
                  </span>
                  <div
                    className="hidden group-hover:block absolute left-6 bottom-full mb-1 z-10 max-w-sm px-2.5 py-1.5 rounded-lg border border-card-border-hover shadow-xl text-xs text-foreground whitespace-normal pointer-events-none"
                    style={{ background: 'var(--background-raised)', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
                  >
                    {entry}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {detail.results && (
        <div className="mb-5">
          <p className="text-[10px] text-muted-foreground/50 font-medium mb-2">Results</p>
          <div className="rounded-lg border border-card-border bg-card px-4 py-3.5 text-xs text-foreground/70 leading-relaxed">
            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{detail.results}</Markdown>
          </div>
        </div>
      )}

      {/* Validation notes */}
      {detail.validationNotes && (
        <div className="mb-5">
          <p className="text-[10px] text-muted-foreground/50 font-medium mb-2">Validation</p>
          <div className="rounded-lg border border-status-review-border bg-status-review-bg px-4 py-3.5 text-xs text-foreground/70 leading-relaxed">
            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{detail.validationNotes}</Markdown>
          </div>
        </div>
      )}

      {/* Feedback flash */}
      {feedback && (
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-xs font-medium animate-fade-up mb-4',
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
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
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
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
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
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-status-failed-border"
                autoFocus
              />
              <button
                onClick={handleReject}
                disabled={actionLoading || !rejectNotes.trim()}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  'border border-status-failed-border bg-status-failed-bg text-status-failed',
                  'hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                Submit
              </button>
              <button
                onClick={() => { setShowRejectInput(false); setRejectNotes('') }}
                className="px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
