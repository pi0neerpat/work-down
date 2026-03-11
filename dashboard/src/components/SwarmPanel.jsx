import { useState } from 'react'
import { Activity, CheckCircle, XCircle, AlertCircle, Loader, ChevronDown, ChevronRight, Cpu, Clock, Ban, Square } from 'lucide-react'
import Markdown from 'react-markdown'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig, validationConfig } from '../lib/statusConfig'
import { mdComponents } from './mdComponents'

function AgentCard({ agent, index, onSwarmRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [confirmKill, setConfirmKill] = useState(false)
  const [killing, setKilling] = useState(false)

  const st = statusConfig[agent.status] || statusConfig.unknown
  const StatusIcon = st.icon
  const val = validationConfig[agent.validation]

  async function toggleExpand() {
    if (!expanded && !detail) {
      setLoading(true)
      try {
        const res = await fetch(`/api/swarm/${agent.id}`)
        if (res.ok) setDetail(await res.json())
      } catch { /* ignore */ }
      setLoading(false)
    }
    setExpanded(!expanded)
  }

  function showFeedback(msg, isError = false) {
    setFeedback({ msg, isError })
    setTimeout(() => setFeedback(null), 2000)
  }

  async function handleValidate() {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/swarm/${agent.id}/validate`, {
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
      showFeedback('Validated')
      onSwarmRefresh?.()
    } catch (err) {
      showFeedback(err.message || 'Validate failed', true)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject() {
    if (!rejectNotes.trim()) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/swarm/${agent.id}/reject`, {
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
      showFeedback('Rejected')
      onSwarmRefresh?.()
    } catch (err) {
      showFeedback(err.message || 'Reject failed', true)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleKill(e) {
    e.stopPropagation()
    if (!confirmKill) {
      setConfirmKill(true)
      setTimeout(() => setConfirmKill(false), 3000)
      return
    }
    setKilling(true)
    try {
      const res = await fetch(`/api/swarm/${agent.id}/kill`, { method: 'POST' })
      if (res.ok) {
        onSwarmRefresh?.()
      }
    } catch { /* ignore */ }
    setKilling(false)
    setConfirmKill(false)
  }

  const canAct = (agent.validation === 'needs_validation' || agent.validation === 'none') &&
    !(detail?.validation === 'validated' || detail?.validation === 'rejected')

  const relativeTime = timeAgo(agent.started, agent.durationMinutes)

  return (
    <div
      className="animate-fade-up rounded-lg border border-card-border overflow-hidden transition-all hover:border-card-border-hover"
      style={{
        animationDelay: `${index * 60}ms`,
        borderLeftWidth: '2px',
        borderLeftColor: st.borderColor,
      }}
    >
      <button
        onClick={toggleExpand}
        className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-card-hover/30 transition-colors"
      >
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
          st.bg,
        )}>
          <StatusIcon
            size={16}
            className={cn(st.color, agent.status === 'in_progress' && 'animate-spin-slow')}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground truncate">
              {agent.taskName || agent.id}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground/60 capitalize tracking-wider">
              {agent.repo}
            </span>
          </div>
          {agent.lastProgress && (
            <p className="text-xs text-muted-foreground/50 truncate mt-0.5">{agent.lastProgress}</p>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {agent.progressCount > 0 && (
            <span className="text-[10px] text-muted-foreground/40 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
              {agent.progressCount} steps
            </span>
          )}
          {relativeTime && (
            <span
              className="flex items-center gap-1 text-[11px] text-muted-foreground/40 font-mono"
              style={{ fontFamily: 'var(--font-mono)' }}
              title={`Started: ${agent.started}${agent.durationMinutes != null ? ` (${agent.durationMinutes} min)` : ''}`}
            >
              <Clock size={10} />
              {relativeTime}
            </span>
          )}
          {val && (
            <span className={cn(
              'text-[10px] px-2 py-0.5 rounded-full border font-medium',
              val.bg, val.color, val.border
            )}>
              {val.label}
            </span>
          )}
          {agent.status === 'in_progress' && (
            <button
              onClick={handleKill}
              className={cn(
                'px-2 py-1 rounded text-[10px] font-medium transition-all',
                confirmKill
                  ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                  : 'text-muted-foreground/40 hover:text-status-failed hover:bg-status-failed-bg'
              )}
              disabled={killing}
            >
              {killing ? '...' : confirmKill ? 'Stop?' : <Square size={12} />}
            </button>
          )}
          <span className="text-muted-foreground/30">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-5 bg-background/30 text-xs space-y-4 animate-slide-in">
          {loading && <p className="text-muted-foreground animate-pulse-soft">Loading details...</p>}
          {detail?.progressEntries?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/50 font-medium mb-2">
                Progress Timeline
              </p>
              <div className="relative pl-5">
                <div
                  className="absolute left-[4px] top-[5px] bottom-[5px] w-px"
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
                        className="absolute -left-5 top-[3px] w-[8px] h-[8px] rounded-full border-[1.5px] shrink-0 z-10"
                        style={{
                          background: isLast ? st.dotColor : 'var(--background)',
                          borderColor: isLast ? st.dotColor : 'rgba(140, 140, 150, 0.12)',
                        }}
                      />
                      <span className="text-foreground/60 truncate leading-tight pl-1">
                        {entry}
                      </span>
                      <div
                        className="hidden group-hover:block absolute left-6 bottom-full mb-1 z-10 max-w-sm px-2.5 py-1.5 rounded-lg border border-card-border-hover shadow-xl text-xs text-foreground whitespace-normal pointer-events-none"
                        style={{ background: 'var(--background-raised)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
                      >
                        {entry}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {detail?.results && (
            <div>
              <p className="text-[10px] text-muted-foreground/50 font-medium mb-1.5">Results</p>
              <div className="rounded-lg bg-secondary/30 px-3 py-2.5 text-foreground/70 leading-relaxed">
                <Markdown components={mdComponents}>{detail.results}</Markdown>
              </div>
            </div>
          )}
          {detail?.validationNotes && (
            <div>
              <p className="text-[10px] text-muted-foreground/50 font-medium mb-1.5">Validation</p>
              <div className="rounded-lg bg-status-review-bg px-3 py-2.5 text-foreground/70 leading-relaxed border border-status-review-border">
                <Markdown components={mdComponents}>{detail.validationNotes}</Markdown>
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={cn(
                'rounded-lg px-3 py-2 text-xs font-medium animate-fade-up',
                feedback.isError
                  ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                  : 'bg-status-active-bg text-status-active border border-status-active-border'
              )}
            >
              {feedback.msg}
            </div>
          )}

          {canAct && detail && (
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
      )}
    </div>
  )
}

export default function SwarmPanel({ swarm, onSwarmRefresh }) {
  const agents = swarm?.agents || []
  const hasActive = swarm?.summary?.active > 0
  const totalAgents = agents.length
  const completed = swarm?.summary?.completed || 0

  return (
    <section className="animate-fade-up" style={{ animationDelay: '200ms' }}>
      <div className="flex items-center gap-2 mb-4 px-1">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-muted-foreground/60" />
          <h2 className="text-[13px] font-medium text-muted-foreground/60">Swarm</h2>
        </div>
        {hasActive && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full" style={{ background: 'var(--status-active)' }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: 'var(--status-active)' }} />
          </span>
        )}
        <div className="flex-1 h-px bg-border" />
        {totalAgents > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground/40" style={{ fontFamily: 'var(--font-mono)' }}>
            {completed}/{totalAgents}
          </span>
        )}
      </div>

      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        {agents.length === 0 ? (
          <div className="py-10 text-center">
            <Cpu size={24} className="mx-auto mb-2 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/40 mb-1">No swarm tasks</p>
            <p className="text-xs text-muted-foreground/25 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
              Launch agents with /swarm
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {agents.map((agent, i) => (
              <AgentCard key={agent.id} agent={agent} index={i} onSwarmRefresh={onSwarmRefresh} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
