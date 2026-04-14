import { useState, useMemo, useEffect, useCallback } from 'react'
import { Bot, Sparkles, AlertCircle, CheckCircle2, XCircle, Clock, GitBranch, AlertTriangle, Square, Loader, Eye, EyeOff } from 'lucide-react'
import { cn, timeAgo, truncateWithEllipsis, buildPlanPath } from '../lib/utils'
import { getRepoColor, normalizeAgentId, getAgentBrandColor } from '../lib/constants'
import { buildWorkerNavItems } from '../lib/workerUtils'
import { FilterChip, toggleFilter, BUG_COLOR, loadFilters, saveFilters } from '../lib/filterUtils.jsx'
import AgentIcon, { getAgentLabel } from './AgentIcon'

const JOB_STATUSES = ['active', 'review', 'completed', 'failed', 'rejected']
const STORAGE_KEY = 'jobsView:filters'
const READ_OVERRIDES_KEY = 'jobsView:readOverrides'

function loadReadOverrides() {
  try {
    const raw = localStorage.getItem(READ_OVERRIDES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([jobId, value]) => Boolean(jobId) && typeof value === 'boolean')
    )
  } catch {
    return {}
  }
}

function saveReadOverrides(overrides) {
  try {
    const entries = Object.entries(overrides || {}).filter(([, value]) => typeof value === 'boolean')
    if (entries.length === 0) {
      localStorage.removeItem(READ_OVERRIDES_KEY)
      return
    }
    localStorage.setItem(READ_OVERRIDES_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // noop in non-browser/private contexts
  }
}

const STATUS_LABELS = {
  active: 'Active',
  review: 'Needs Review',
  rejected: 'Rejected',
  completed: 'Completed',
  failed: 'Failed',
}

const JOB_CARD_PLAN_MAX = 36

function classifyItem(worker) {
  if (worker.validation === 'validated' || worker.runState === 'validated') return 'completed'
  if (worker.validation === 'rejected' || worker.runState === 'rejected') return 'rejected'
  if (worker.needsReview || worker.validation === 'needs_validation' || worker.runState === 'awaiting_validation') return 'review'
  if (worker.status === 'in_progress') return 'active'
  if (worker.status === 'stopped' || worker.status === 'killed') return 'review'
  if (worker.status === 'completed' && (!worker.validation || worker.validation === 'none')) return 'review'
  if (worker.status === 'completed') return 'completed'
  if (worker.status === 'failed') return 'failed'
  return 'active'
}

function buildPlanHref(worker) {
  if (!worker?.planSlug) return null
  const repo = worker.planRepo || worker.repo
  return buildPlanPath(repo, worker.planSlug)
}

export default function JobsView({
  swarm,
  jobFileToSession,
  sessionRecords,
  overview,
  onSelectJob,
  onJobsRefresh,
  showToast,
}) {
  const agents = swarm?.agents || []
  const [stoppingJobs, setStoppingJobs] = useState(new Set())
  const [confirmStopId, setConfirmStopId] = useState(null)
  const [readOverrides, setReadOverrides] = useState(() => loadReadOverrides())
  const [showReadReview, setShowReadReview] = useState(() => loadFilters(STORAGE_KEY)?.showReadReview ?? false)

  const handleStopOrphan = useCallback(async (e, worker) => {
    e.stopPropagation()
    const jobId = worker.jobId || worker.id
    if (confirmStopId !== jobId) {
      setConfirmStopId(jobId)
      setTimeout(() => setConfirmStopId(prev => prev === jobId ? null : prev), 3000)
      return
    }
    setStoppingJobs(prev => new Set(prev).add(jobId))
    setConfirmStopId(null)
    try {
      const res = await fetch(`/api/jobs/${jobId}/kill`, { method: 'POST' })
      if (res.ok) {
        showToast?.('Job stopped', 'info')
        onJobsRefresh?.()
      }
    } catch { /* SSE will refresh */ }
    setStoppingJobs(prev => { const next = new Set(prev); next.delete(jobId); return next })
  }, [confirmStopId, onJobsRefresh, showToast])

  const handleToggleRead = useCallback(async (e, worker) => {
    e.stopPropagation()
    const jobId = worker.jobId || worker.id
    const nextRead = !worker.read
    setReadOverrides(prev => ({ ...prev, [jobId]: nextRead }))
    try {
      const res = await fetch(`/api/jobs/${jobId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: nextRead }),
      })
      if (!res.ok) throw new Error('Failed to update read status')
      onJobsRefresh?.()
    } catch {
      setReadOverrides(prev => ({ ...prev, [jobId]: worker.read === true }))
      showToast?.('Failed to update read status', 'error')
    }
  }, [onJobsRefresh, showToast])

  // Build a set of bug task texts (lowercased) from overview for cross-referencing
  const bugTaskTexts = useMemo(() => {
    const texts = new Set()
    for (const repo of overview?.repos || []) {
      for (const task of repo.tasks?.allTasks || []) {
        if (task.section?.toLowerCase().includes('bug')) {
          texts.add(task.text.toLowerCase().slice(0, 40))
        }
      }
    }
    return texts
  }, [overview])

  const baseItems = useMemo(() => {
    const items = buildWorkerNavItems(agents, null, jobFileToSession, sessionRecords)
    return items.map(item => {
      const labelLower = (item.label || '').toLowerCase()
      const isBug = [...bugTaskTexts].some(bt => labelLower.includes(bt) || bt.includes(labelLower.slice(0, 40)))
      return {
        ...item,
        filterStatus: classifyItem(item),
        isBug,
      }
    })
  }, [agents, jobFileToSession, bugTaskTexts, sessionRecords])

  const allItems = useMemo(() => {
    return baseItems.map(item => {
      const jobId = item.jobId || item.id
      return {
        ...item,
        read: readOverrides[jobId] ?? item.read ?? false,
      }
    })
  }, [baseItems, readOverrides])

  // Use overview repos so all configured repos appear as filter chips (including those with no jobs)
  const repoNames = useMemo(() => {
    return (overview?.repos || []).map(r => r.name)
  }, [overview])

  const [savedFilters] = useState(() => loadFilters(STORAGE_KEY))
  const [selectedStatuses, setSelectedStatuses] = useState(() => {
    if (!savedFilters) return new Set(JOB_STATUSES)
    // Union saved statuses with any newly added statuses so new groups aren't hidden by stale cache
    return new Set([...savedFilters.statuses, ...JOB_STATUSES.filter(s => !savedFilters.statuses.has(s))])
  })
  const [selectedRepos, setSelectedRepos] = useState(() => savedFilters?.repos ?? new Set(repoNames))
  const [bugFilter, setBugFilter] = useState(() => savedFilters?.bugOnly ?? false)

  // Sync repo filter when repos change — add any newly discovered repos
  useMemo(() => {
    if (repoNames.length > 0) {
      const newRepos = repoNames.filter(r => !selectedRepos.has(r))
      if (newRepos.length > 0 && savedFilters === null) {
        setSelectedRepos(new Set([...selectedRepos, ...newRepos]))
      }
    }
  }, [repoNames.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveFilters(STORAGE_KEY, { statuses: selectedStatuses, repos: selectedRepos, bugOnly: bugFilter, showReadReview })
  }, [selectedStatuses, selectedRepos, bugFilter, showReadReview])

  useEffect(() => {
    saveReadOverrides(readOverrides)
  }, [readOverrides])

  useEffect(() => {
    setReadOverrides(prev => {
      const prevEntries = Object.entries(prev)
      if (prevEntries.length === 0) return prev

      const serverReadByJobId = new Map(
        baseItems
          .map(item => [item.jobId || item.id, item.read === true])
          .filter(([jobId]) => Boolean(jobId))
      )

      let changed = false
      const next = {}
      for (const [jobId, overrideValue] of prevEntries) {
        if (!serverReadByJobId.has(jobId)) {
          changed = true
          continue
        }
        if (serverReadByJobId.get(jobId) === overrideValue) {
          changed = true
          continue
        }
        next[jobId] = overrideValue
      }

      return changed ? next : prev
    })
  }, [baseItems])

  const filteredItems = useMemo(() => {
    return allItems.filter(w => {
      if (!selectedStatuses.has(w.filterStatus)) return false
      if (!selectedRepos.has(w.repo)) return false
      if (bugFilter && !w.isBug) return false
      return true
    })
  }, [allItems, selectedStatuses, selectedRepos, bugFilter])

  const GROUP_CONFIG = {
    active: { label: 'Active', dotClass: 'bg-status-active', icon: Sparkles },
    review: { label: 'Needs Review', dotClass: 'bg-status-review', icon: AlertCircle },
    rejected: { label: 'Rejected', dotClass: 'bg-status-failed', icon: XCircle },
    completed: { label: 'Completed', dotClass: 'bg-status-complete', icon: CheckCircle2 },
    failed: { label: 'Failed', dotClass: 'bg-status-failed', icon: XCircle },
  }

  const groups = JOB_STATUSES
    .map(status => ({
      ...GROUP_CONFIG[status],
      status,
      items: filteredItems
        .filter(w => w.filterStatus === status)
        .filter(w => status !== 'review' || showReadReview || !w.read)
        .sort((a, b) => {
          const ta = a.created ? new Date(a.created).getTime() : 0
          const tb = b.created ? new Date(b.created).getTime() : 0
          return tb - ta
        }),
    }))

  if (allItems.length === 0) {
    return (
      <div className="py-16 text-center">
        <Bot size={28} className="mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/60">No workers or agents.</p>
        <p className="text-[11px] text-muted-foreground/40 mt-1">Start a worker from the Tasks tab or use Dispatch.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Status</span>
          {JOB_STATUSES.map(st => (
            <FilterChip
              key={st}
              label={STATUS_LABELS[st]}
              active={selectedStatuses.has(st)}
              onClick={() => toggleFilter(selectedStatuses, setSelectedStatuses, st)}
            />
          ))}

          {/* Divider */}
          <div className="h-4 w-px bg-border mx-1" />

          {/* Bug */}
          <FilterChip
            label="🪲 Bug"
            active={bugFilter}
            onClick={() => setBugFilter(p => !p)}
            color={BUG_COLOR}
          />

        </div>

        {/* Repo - separate row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Repo</span>
          {repoNames.map(name => (
            <FilterChip
              key={name}
              label={name}
              active={selectedRepos.has(name)}
              onClick={() => toggleFilter(selectedRepos, setSelectedRepos, name)}
              color={getRepoColor(overview, name)}
            />
          ))}
        </div>
      </div>


      {/* Grouped job cards */}
      <div className="space-y-6">
        {groups.map(group => {
          const GroupIcon = group.icon
          return (
            <div key={group.label}>
              <div className="flex items-center gap-2 mb-3">
                <span className={cn('w-1.5 h-1.5 rounded-full', group.dotClass)} />
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h3>
                <span className="text-[10px] font-mono text-muted-foreground/40" style={{ fontFamily: 'var(--font-mono)' }}>
                  {group.items.length}
                </span>
                {group.status === 'review' && (
                  <button
                    type="button"
                    onClick={() => setShowReadReview(prev => !prev)}
                    className={cn(
                      'ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                      showReadReview
                        ? 'border-status-review-border bg-status-review-bg text-status-review'
                        : 'border-border text-muted-foreground/70 hover:text-foreground'
                    )}
                    title={showReadReview ? 'Hide read jobs' : 'Show read jobs'}
                  >
                    {showReadReview ? <EyeOff size={10} /> : <Eye size={10} />}
                    {showReadReview ? 'Hide read' : 'Show read'}
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {group.items.length === 0 && (
                  <div className="w-full px-3.5 py-2.5 rounded-lg text-center">
                    <span className="text-[13px] text-muted-foreground/40">Empty</span>
                  </div>
                )}
                {group.items.map(worker => {
                  const repoColor = getRepoColor(overview, worker.repo)
                  const normalizedAgent = normalizeAgentId(worker.agent)
                  const agentLabel = getAgentLabel(normalizedAgent)
                  const agentColor = getAgentBrandColor(normalizedAgent)
                  const duration = worker.durationMinutes != null
                    ? timeAgo(null, worker.durationMinutes)
                    : worker.created
                      ? timeAgo(new Date(worker.created).toISOString())
                      : null

                  const planHref = buildPlanHref(worker)
                  const planLabelRaw = worker.planTitle || worker.planSlug || ''
                  const planLabel = truncateWithEllipsis(planLabelRaw, JOB_CARD_PLAN_MAX)

                  return (
                    <div
                      key={worker.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectJob?.(worker.jobId || worker.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectJob?.(worker.jobId || worker.id)
                        }
                      }}
                      className="w-full text-left px-3.5 py-2.5 rounded-lg border bg-card hover:bg-card-hover transition-colors group animate-fade-up cursor-pointer"
                      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(139,171,143,0.35)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 self-center',
                            worker.status === 'in_progress' && 'animate-pulse-soft'
                          )}
                          style={{ color: agentColor, background: `${agentColor}12`, borderColor: `${agentColor}30` }}
                          title={agentLabel}
                        >
                          <AgentIcon agent={normalizedAgent} size={11} title={agentLabel} />
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{worker.label}</p>
                          {(duration || worker.usesWorktree) && (
                            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1 mt-0.5 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                              {duration && (
                                <>
                                  <Clock size={9} />
                                  {duration}
                                </>
                              )}
                              {duration && worker.usesWorktree && (
                                <span className="text-muted-foreground/25">•</span>
                              )}
                              {worker.usesWorktree && (
                                <>
                                  <GitBranch size={9} />
                                  worktree
                                </>
                              )}
                            </span>
                          )}
                          {worker.lastError && (
                            <div
                              className="mt-1 flex items-start gap-1.5 text-[10px] text-status-failed/80 min-w-0"
                              title={worker.lastError}
                            >
                              <AlertTriangle size={10} className="shrink-0 mt-[1px]" />
                              <span className="truncate">
                                {worker.lastErrorSubKind === 'rate_limit' ? 'Rate limit hit' : 'Error'}{worker.errorCount > 1 ? ` (${worker.errorCount})` : ''}
                              </span>
                            </div>
                          )}
                          {worker.planSlug && (
                            <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70 min-w-0">
                              <span className="shrink-0">Plan:</span>
                              {planHref ? (
                                <a
                                  href={planHref}
                                  onClick={e => e.stopPropagation()}
                                  onKeyDown={e => e.stopPropagation()}
                                  className="min-w-0 truncate hover:text-foreground underline underline-offset-2"
                                  title={planLabelRaw}
                                >
                                  {planLabel}
                                </a>
                              ) : (
                                <span className="min-w-0 truncate" title={planLabelRaw}>
                                  {planLabel}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-center">
                          {worker.filterStatus === 'review' && (
                            <button
                              type="button"
                              onClick={(e) => handleToggleRead(e, worker)}
                              className={cn(
                                'p-1 rounded-md border transition-colors',
                                worker.read
                                  ? 'border-status-review-border bg-status-review-bg text-status-review'
                                  : 'border-border text-muted-foreground/70 hover:text-foreground hover:border-status-review/30'
                              )}
                              title={worker.read ? 'Mark as unread' : 'Mark as read'}
                              aria-label={worker.read ? 'Mark as unread' : 'Mark as read'}
                            >
                              {worker.read ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          )}
                          {worker.filterStatus === 'active' && !worker.alive && (() => {
                            const jid = worker.jobId || worker.id
                            const isStopping = stoppingJobs.has(jid)
                            const isConfirming = confirmStopId === jid
                            return (
                              <button
                                onClick={(e) => handleStopOrphan(e, worker)}
                                disabled={isStopping}
                                className={cn(
                                  'px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1',
                                  isConfirming
                                    ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                                    : 'text-status-failed/60 hover:text-status-failed bg-status-failed-bg/40 border border-status-failed-border/20 hover:border-status-failed-border'
                                )}
                                title="Stop orphaned job (no active session)"
                              >
                                {isStopping
                                  ? <Loader size={9} className="animate-spin" />
                                  : <Square size={9} />}
                                {isConfirming ? 'Stop?' : 'Stop'}
                              </button>
                            )
                          })()}
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded-full border font-medium capitalize"
                            style={{ background: `${repoColor}10`, color: repoColor, borderColor: `${repoColor}30` }}
                          >
                            {worker.repo}
                          </span>
                          <span className="text-[11px] text-muted-foreground/40 group-hover:text-primary transition-colors">
                            View
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {filteredItems.length === 0 && (
          <div className="py-12 text-center text-muted-foreground/50 text-sm">
            No jobs match the current filters.
          </div>
        )}
      </div>
    </div>
  )
}
