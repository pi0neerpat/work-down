import { useState, useMemo, useEffect } from 'react'
import { Bot, Sparkles, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { cn, timeAgo } from '../lib/utils'
import { repoIdentityColors, normalizeAgentId, getAgentBrandColor } from '../lib/constants'
import { buildWorkerNavItems } from '../lib/workerUtils'
import { FilterChip, toggleFilter, BUG_COLOR, loadFilters, saveFilters } from '../lib/filterUtils.jsx'

const JOB_STATUSES = ['review', 'active', 'completed', 'failed', 'rejected']
const STORAGE_KEY = 'jobsView:filters'

const STATUS_LABELS = {
  active: 'Active',
  review: 'Needs Review',
  rejected: 'Rejected',
  completed: 'Completed',
  failed: 'Failed',
}

const AGENT_ICONS = {
  claude: Bot,
  codex: Sparkles,
}

function classifyItem(worker) {
  if (worker.validation === 'validated' || worker.runState === 'validated') return 'completed'
  if (worker.validation === 'rejected' || worker.runState === 'rejected') return 'rejected'
  if (worker.needsReview || worker.validation === 'needs_validation' || worker.runState === 'awaiting_validation') return 'review'
  if (worker.status === 'in_progress') return 'active'
  if (worker.status === 'completed' && (!worker.validation || worker.validation === 'none')) return 'review'
  if (worker.status === 'completed') return 'completed'
  if (worker.status === 'failed' || worker.status === 'killed') return 'failed'
  return 'active'
}

export default function JobsView({
  swarm,
  jobFileToSession,
  sessionRecords,
  overview,
  onSelectJob,
}) {
  const agents = swarm?.agents || []

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

  const allItems = useMemo(() => {
    const items = buildWorkerNavItems(agents, null, jobFileToSession, sessionRecords)
    return items.map(item => {
      const labelLower = (item.label || '').toLowerCase()
      const isBug = [...bugTaskTexts].some(bt => labelLower.includes(bt) || bt.includes(labelLower.slice(0, 40)))
      return { ...item, filterStatus: classifyItem(item), isBug }
    })
  }, [agents, jobFileToSession, bugTaskTexts, sessionRecords])

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

  // Sync repo filter when repos change (only if empty)
  useMemo(() => {
    if (repoNames.length > 0 && selectedRepos.size === 0) {
      setSelectedRepos(new Set(repoNames))
    }
  }, [repoNames.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveFilters(STORAGE_KEY, { statuses: selectedStatuses, repos: selectedRepos, bugOnly: bugFilter })
  }, [selectedStatuses, selectedRepos, bugFilter])

  const filteredItems = useMemo(() => {
    return allItems.filter(w => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(w.filterStatus)) return false
      if (selectedRepos.size > 0 && !selectedRepos.has(w.repo)) return false
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
        .sort((a, b) => {
          const ta = a.created ? new Date(a.created).getTime() : 0
          const tb = b.created ? new Date(b.created).getTime() : 0
          return tb - ta
        }),
    }))
    .filter(g => g.items.length > 0)

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
              color={repoIdentityColors[name]}
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
              </div>

              <div className="space-y-2">
                {group.items.map(worker => {
                  const repoColor = repoIdentityColors[worker.repo] || 'var(--primary)'
                  const normalizedAgent = normalizeAgentId(worker.agent)
                  const AgentIcon = AGENT_ICONS[normalizedAgent] || Bot
                  const agentColor = getAgentBrandColor(normalizedAgent)
                  const duration = worker.durationMinutes != null
                    ? timeAgo(null, worker.durationMinutes)
                    : worker.created
                      ? timeAgo(new Date(worker.created).toISOString())
                      : null

                  return (
                    <button
                      key={worker.key}
                      onClick={() => onSelectJob?.(worker.jobId || worker.id)}
                      className="w-full text-left px-3.5 py-2.5 rounded-lg border bg-card hover:bg-card-hover transition-colors group animate-fade-up"
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
                          title={normalizedAgent === 'codex' ? 'Codex' : 'Claude'}
                        >
                          <AgentIcon size={11} />
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{worker.label}</p>
                          {duration && (
                            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1 mt-0.5 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                              <Clock size={9} />
                              {duration}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0 self-center">
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
                    </button>
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
