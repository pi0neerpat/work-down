import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Loader, Clock, Square, Activity, ListChecks, GitMerge, Scissors, Network, Trash2, Send, RotateCcw } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig, validationConfig } from '../lib/statusConfig'
import { repoIdentityColors, MODEL_OPTIONS, FOLLOWUP_TEMPLATES } from '../lib/constants'
import { mdComponents } from './mdComponents'

function ResultsSummary({ text }) {
  return (
    <div className="rounded-lg border border-card-border bg-card px-5 py-4 text-sm text-foreground/90 leading-loose">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Result Summary</p>
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</Markdown>
    </div>
  )
}

function AgentActions({ detail, agentId, onJobsRefresh, onOverviewRefresh, onStartTask, onBack, onRemoveSession, showToast, showFeedbackMsg }) {
  const [merging, setMerging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSplitInput, setShowSplitInput] = useState(false)
  const [showSubtaskInput, setShowSubtaskInput] = useState(false)
  const [splitText, setSplitText] = useState('')
  const [subtaskText, setSubtaskText] = useState('')
  const [dispatching, setDispatching] = useState(false)

  async function handleMerge() {
    setMerging(true)
    try {
      const res = await fetch(`/api/jobs/${agentId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      showFeedbackMsg(`Merged ${data.merged} → ${data.into}`)
      showToast?.(`Branch merged into ${data.into}`, 'success')
    } catch (err) {
      showFeedbackMsg(err.message, true)
    } finally {
      setMerging(false)
    }
  }

  async function handleAddTask(text, label) {
    if (!text.trim() || !detail?.repo) return
    try {
      const res = await fetch('/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: detail.repo, text: text.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to add task')
      }
      showFeedbackMsg(`${label} added to ${detail.repo}`)
      onOverviewRefresh?.()
      return true
    } catch (err) {
      showFeedbackMsg(err.message, true)
      return false
    }
  }

  async function handleSplitSubmit() {
    const lines = splitText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    let added = 0
    for (const line of lines) {
      const ok = await handleAddTask(line, 'Subtask')
      if (ok) added++
    }
    if (added > 0) {
      showToast?.(`${added} subtask${added > 1 ? 's' : ''} created`, 'success')
      setSplitText('')
      setShowSplitInput(false)
    }
  }

  async function handleSubtaskSubmit() {
    const ok = await handleAddTask(subtaskText, 'Subtask')
    if (ok) {
      showToast?.('Subtask added', 'success')
      setSubtaskText('')
      setShowSubtaskInput(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 3000)
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/jobs/${agentId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }
      showToast?.('Job deleted', 'info')
      onRemoveSession?.()
      onJobsRefresh?.()
      onBack?.()
    } catch (err) {
      showFeedbackMsg(err.message, true)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleFollowUpDispatch(prompt, model, autoMerge, originalTask = null) {
    if (!detail?.repo) return
    setDispatching(true)
    try {
      const sessionId = await onStartTask?.(prompt, detail.repo, {
        model,
        autoMerge,
        originalTask: originalTask || prompt,
      })
      if (!sessionId) {
        throw new Error('Failed to start follow-up worker')
      }
    } catch (err) {
      showFeedbackMsg(err.message || 'Dispatch failed', true)
    } finally {
      setDispatching(false)
    }
  }

  return (
    <div className="mt-6 pt-5 border-t border-border space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Agent Actions</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            {merging ? <Loader size={12} className="animate-spin" /> : <GitMerge size={12} />}
            Merge
          </button>
          <button
            onClick={() => { setShowSplitInput(v => !v); setShowSubtaskInput(false) }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-colors',
              showSplitInput
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-card-hover'
            )}
          >
            <Scissors size={12} /> Split
          </button>
          <button
            onClick={() => { setShowSubtaskInput(v => !v); setShowSplitInput(false) }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-colors',
              showSubtaskInput
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-card-hover'
            )}
          >
            <Network size={12} /> Subtask
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors',
              confirmDelete
                ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                : 'border border-status-failed-border/50 text-status-failed/60 hover:text-status-failed hover:bg-status-failed-bg'
            )}
          >
            {deleting ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {confirmDelete ? 'Confirm?' : 'Delete'}
          </button>
        </div>

        {/* Split input — multiple tasks, one per line */}
        {showSplitInput && (
          <div className="mt-2 space-y-2 animate-slide-in">
            <textarea
              value={splitText}
              onChange={(e) => setSplitText(e.target.value)}
              placeholder="Enter subtasks, one per line..."
              rows={3}
              className="w-full px-2.5 py-2 rounded-md border border-border bg-card text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 resize-y"
            />
            <button
              onClick={handleSplitSubmit}
              disabled={!splitText.trim()}
              className="h-7 px-3 rounded-md text-[11px] font-medium bg-primary text-primary-foreground disabled:opacity-40"
            >
              Add {splitText.split('\n').filter(l => l.trim()).length || 0} subtask(s)
            </button>
          </div>
        )}

        {/* Subtask input — single task */}
        {showSubtaskInput && (
          <div className="mt-2 flex items-center gap-2 animate-slide-in">
            <input
              value={subtaskText}
              onChange={(e) => setSubtaskText(e.target.value)}
              placeholder="Subtask description..."
              className="flex-1 h-8 rounded-md border border-border bg-card px-2.5 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubtaskSubmit() }}
            />
            <button
              onClick={handleSubtaskSubmit}
              disabled={!subtaskText.trim()}
              className="h-8 px-3 rounded-md text-[11px] font-medium bg-primary text-primary-foreground disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Follow-up dispatch — visible when completed/review/stopped */}
      {(detail.validation === 'needs_validation' || detail.status === 'completed' || detail.status === 'killed') && (
        <FollowUpChat
          repoName={detail.repo}
          detail={detail}
          onDispatch={handleFollowUpDispatch}
          dispatching={dispatching}
        />
      )}
    </div>
  )
}

function FollowUpChat({ repoName, detail, onDispatch, dispatching }) {
  const [chatModel, setChatModel] = useState(MODEL_OPTIONS[0].value)
  const [chatAutoMerge, setChatAutoMerge] = useState(false)
  const [chatPrompt, setChatPrompt] = useState('')
  const [activeTemplate, setActiveTemplate] = useState(null)

  async function handleDispatch() {
    if (!chatPrompt.trim()) return
    const basePrompt = chatPrompt.trim()
    const contextLine = detail?.id ? `Previous job context: notes/jobs/${detail.id}.md` : ''
    const hasContext = contextLine && basePrompt.includes(contextLine)
    const promptWithContext = contextLine && !hasContext
      ? `${basePrompt}\n\n---\n${contextLine}`
      : basePrompt
    await onDispatch?.(promptWithContext, chatModel, chatAutoMerge, basePrompt)
    setChatPrompt('')
    setActiveTemplate(null)
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Continue as New Job</p>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <select
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-card text-[11px] text-foreground focus:outline-none focus:border-primary/30"
          >
            {MODEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setChatAutoMerge(v => !v)}
            className={cn(
              'w-7 h-[16px] rounded-full border transition-colors relative shrink-0 overflow-hidden',
              chatAutoMerge
                ? 'bg-primary/20 border-primary/40'
                : 'bg-card border-border'
            )}
          >
            <span
              className={cn(
                'absolute top-[2px] left-[2px] w-2.5 h-2.5 rounded-full transition-transform duration-200',
                chatAutoMerge
                  ? 'translate-x-[11px] bg-primary'
                  : 'translate-x-0 bg-muted-foreground/40'
              )}
            />
          </button>
          <span className="text-[11px] text-foreground/70">Auto-merge</span>
        </div>

        {detail && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {FOLLOWUP_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setChatPrompt(tpl.prompt(detail))
                  setActiveTemplate(tpl.id)
                }}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full border font-medium transition-all',
                  activeTemplate === tpl.id
                    ? 'bg-primary/12 border-primary/35 text-foreground'
                    : 'bg-card border-border text-muted-foreground/60 hover:text-muted-foreground hover:border-border'
                )}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-start gap-2">
          <textarea
            value={chatPrompt}
            onChange={(e) => {
              setChatPrompt(e.target.value)
              setActiveTemplate(null)
            }}
            placeholder="Send follow-up instructions to a new worker..."
            rows={8}
            className={cn(
              'flex-1 px-2.5 py-2 rounded-md border border-border bg-card',
              'text-[12px] text-foreground placeholder:text-muted-foreground/40 leading-relaxed',
              'focus:outline-none focus:border-primary/30 resize-y'
            )}
          />
          <button
            onClick={handleDispatch}
            disabled={!chatPrompt.trim() || dispatching}
            className={cn(
              'h-9 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 shrink-0',
              'bg-primary text-primary-foreground hover:brightness-110',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {dispatching ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
            Dispatch
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ResultsPanel({ agentId, hasLiveTerminal = false, onJobsRefresh, onOverviewRefresh, onStartTask, onResumeJob, onBack, onRemoveSession, showToast }) {
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

  async function handleMarkDone() {
    const text = detail?.originalTask || detail?.taskName
    if (!text || !detail?.repo) return
    setMarkingDone(true)
    try {
      const res = await fetch('/api/tasks/done-by-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: detail.repo, text }),
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

  async function handleResume() {
    if (!agentId || !onResumeJob) return
    setActionLoading(true)
    try {
      await onResumeJob(agentId)
      onJobsRefresh?.()
      onOverviewRefresh?.()
      showFeedbackMsg('Job resumed')
    } catch (err) {
      showFeedbackMsg(err.message || 'Resume failed', true)
    } finally {
      setActionLoading(false)
    }
  }

  if (!agentId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Activity size={24} className="mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground/50">Select a job to view results</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground">
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

        <div className="flex items-center gap-2 shrink-0">
          {!hasLiveTerminal && (
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-card-hover transition-all disabled:opacity-50"
            >
              <span className="flex items-center gap-1.5"><RotateCcw size={12} /> Resume</span>
            </button>
          )}
          {detail.status === 'in_progress' && hasLiveTerminal && (
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
              {killing ? <Loader size={12} className="animate-spin-slow" /> : confirmKill ? 'Confirm Stop?' : <span className="flex items-center gap-1.5"><Square size={12} /> Stop</span>}
            </button>
          )}
        </div>
      </div>

      {detail.results && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Results</p>
          <ResultsSummary text={detail.results} />
        </div>
      )}

      {detail.rawContent && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Full Job Output</p>
          <div className="rounded-lg border border-card-border bg-card px-5 py-4 text-sm text-foreground/90 leading-loose">
            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{detail.rawContent}</Markdown>
          </div>
        </div>
      )}

      {detail.validationNotes && (
        <div className="mb-5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Validation</p>
          <div className="rounded-lg border border-status-review-border bg-status-review-bg px-4 py-3 text-xs text-foreground/80 leading-relaxed">
            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{detail.validationNotes}</Markdown>
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

      {(canAct || (!taskMarked && detail.status === 'completed')) && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {canAct && (
              <>
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
              </>
            )}

            {!taskMarked && detail.status === 'completed' && (
              <button
                onClick={handleMarkDone}
                disabled={markingDone}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ml-auto',
                  'border border-border bg-card text-foreground/80 hover:bg-card-hover disabled:opacity-50'
                )}
                title="Mark matching task as done in todo"
              >
                {markingDone ? <Loader size={13} className="animate-spin-slow" /> : <ListChecks size={13} />}
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

      <AgentActions
        detail={detail}
        agentId={agentId}
        onJobsRefresh={onJobsRefresh}
        onOverviewRefresh={onOverviewRefresh}
        onStartTask={onStartTask}
        onBack={onBack}
        onRemoveSession={onRemoveSession}
        showToast={showToast}
        showFeedbackMsg={showFeedbackMsg}
      />
    </div>
  )
}
