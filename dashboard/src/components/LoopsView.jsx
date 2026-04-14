import { useState, useMemo, useEffect } from 'react'
import { RefreshCcw, Clock, Code2, ScanSearch, GitFork, Sparkles, CheckCircle2, XCircle } from 'lucide-react'
import { cn, timeAgo } from '../lib/utils'
import { getRepoColor } from '../lib/constants'
import { FilterChip, toggleFilter, loadFilters, saveFilters } from '../lib/filterUtils.jsx'
import { LOOP_TYPES } from './AgentModelPicker'

const STORAGE_KEY = 'loopsView:filters'

const LOOP_STATUSES = ['active', 'completed', 'failed']

const STATUS_LABELS = {
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
}

const STATUS_COLORS = {
  active: '#4ade80',
  completed: '#8bab8f',
  failed: '#f87171',
}

const GROUP_CONFIG = {
  active: { label: 'Active', dotClass: 'bg-status-active', icon: Sparkles },
  completed: { label: 'Completed', dotClass: 'bg-status-complete', icon: CheckCircle2 },
  failed: { label: 'Failed', dotClass: 'bg-status-failed', icon: XCircle },
}

function classifyLoop(job) {
  if (job.status === 'completed' || job.loopState?.complete) return 'completed'
  if (job.status === 'failed') return 'failed'
  return 'active'
}

function getLoopTypeIcon(loopTypeId) {
  return LOOP_TYPES.find(lt => lt.id === loopTypeId)?.icon || RefreshCcw
}

export default function LoopsView({ loops, overview, onSelectLoop }) {
  const jobs = loops?.jobs || []
  const repos = useMemo(() => (overview?.repos || []).map(r => r.name), [overview])

  const allItems = useMemo(() => {
    return jobs.map(job => ({ ...job, filterStatus: classifyLoop(job) }))
  }, [jobs])

  const [savedFilters] = useState(() => loadFilters(STORAGE_KEY))
  const [selectedStatuses, setSelectedStatuses] = useState(() => savedFilters?.statuses ?? new Set(LOOP_STATUSES))
  const [selectedRepos, setSelectedRepos] = useState(() => savedFilters?.repos ?? new Set(repos))
  const [selectedTypes, setSelectedTypes] = useState(() => savedFilters?.types ?? new Set(LOOP_TYPES.map(lt => lt.id)))

  // Sync repo filter when repos change — add any newly discovered repos (first visit only)
  useEffect(() => {
    if (repos.length > 0 && savedFilters === null) {
      const newRepos = repos.filter(r => !selectedRepos.has(r))
      if (newRepos.length > 0) {
        setSelectedRepos(new Set([...selectedRepos, ...newRepos]))
      }
    }
  }, [repos]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveFilters(STORAGE_KEY, { statuses: selectedStatuses, repos: selectedRepos, types: selectedTypes })
  }, [selectedStatuses, selectedRepos, selectedTypes])

  const filteredItems = useMemo(() => {
    return allItems.filter(w => {
      if (!selectedStatuses.has(w.filterStatus)) return false
      if (!selectedRepos.has(w.repo)) return false
      if (!selectedTypes.has(w.loopType)) return false
      return true
    })
  }, [allItems, selectedStatuses, selectedRepos, selectedTypes])

  const groups = LOOP_STATUSES
    .map(status => ({
      ...GROUP_CONFIG[status],
      status,
      items: filteredItems
        .filter(w => w.filterStatus === status)
        .sort((a, b) => {
          const aTs = a.started ? Date.parse(a.started) : 0
          const bTs = b.started ? Date.parse(b.started) : 0
          return bTs - aTs
        }),
    }))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[13px] font-semibold text-foreground mb-1">Loops</h2>
        <p className="text-[11px] text-muted-foreground">Multi-agent implementation and review loops.</p>
      </div>

      {/* Filter chips */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Status</span>
          {LOOP_STATUSES.map(st => (
            <FilterChip
              key={st}
              label={STATUS_LABELS[st]}
              active={selectedStatuses.has(st)}
              onClick={() => toggleFilter(selectedStatuses, setSelectedStatuses, st)}
            />
          ))}

          <div className="h-4 w-px bg-border mx-1" />

          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Type</span>
          {LOOP_TYPES.map(lt => (
            <FilterChip
              key={lt.id}
              label={lt.label}
              active={selectedTypes.has(lt.id)}
              onClick={() => toggleFilter(selectedTypes, setSelectedTypes, lt.id)}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Repo</span>
          {repos.map(name => (
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

      {/* Grouped loop cards */}
      {jobs.length === 0 ? (
        <div className="py-16 text-center">
          <RefreshCcw size={28} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60">No loop jobs yet.</p>
          <p className="text-[11px] text-muted-foreground/40 mt-1">Launch one from the Dispatch page.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.status}>
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
                {group.items.length === 0 && (
                  <div className="w-full px-3.5 py-2.5 rounded-lg text-center">
                    <span className="text-[13px] text-muted-foreground/40">Empty</span>
                  </div>
                )}
                {group.items.map(job => {
                  const repoColor = getRepoColor(overview, job.repo)
                  const statusColor = STATUS_COLORS[job.filterStatus] || STATUS_COLORS.active
                  const duration = job.durationMinutes != null ? timeAgo(null, job.durationMinutes) : null
                  const TypeIcon = getLoopTypeIcon(job.loopType)
                  return (
                    <div
                      key={job.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectLoop?.(job.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectLoop?.(job.id) } }}
                      className="w-full text-left px-3.5 py-2.5 rounded-lg border bg-card hover:bg-card-hover transition-colors group cursor-pointer"
                      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,171,143,0.35)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)' }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0"
                          style={{ color: statusColor, background: `${statusColor}12`, borderColor: `${statusColor}30` }}
                        >
                          <TypeIcon size={11} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{job.taskName || job.loopType || job.id}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {duration && (
                              <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1 font-mono">
                                <Clock size={9} />{duration}
                              </span>
                            )}
                            {job.loopState?.iteration > 0 && (
                              <span className="text-[10px] text-muted-foreground/60">
                                Iter {job.loopState.iteration}
                                {job.loopState.lastVerdict && ` · ${job.loopState.lastVerdict}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded-full border font-medium capitalize"
                            style={{ background: `${repoColor}10`, color: repoColor, borderColor: `${repoColor}30` }}
                          >
                            {job.repo}
                          </span>
                          <span className="text-[11px] text-muted-foreground/40 transition-colors group-hover:text-primary">
                            View
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
