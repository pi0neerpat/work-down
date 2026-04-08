import { useState, useMemo, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { Play, Check, Plus, ChevronDown, ExternalLink } from 'lucide-react'
import { cn } from '../lib/utils'
import { getRepoColor } from '../lib/constants'
import { FilterChip, toggleFilter, BUG_COLOR, loadFilters, saveFilters } from '../lib/filterUtils.jsx'

const TIMEFRAMES = ['past', 'present', 'future']
const STATUSES = ['open', 'in_progress', 'review', 'done']
const STORAGE_KEY = 'allTasksView:filters'
const ADD_TASK_STORAGE_KEY = 'allTasksView:addTask'

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
}

const STATUS_COLORS = {
  open: { bg: 'bg-card', border: 'border-border', text: 'text-muted-foreground' },
  in_progress: { bg: 'bg-status-active-bg', border: 'border-status-active-border', text: 'text-status-active' },
  review: { bg: 'bg-status-review-bg', border: 'border-status-review-border', text: 'text-status-review' },
  done: { bg: 'bg-status-complete-bg', border: 'border-status-complete-border', text: 'text-status-complete' },
}

function deriveStatus(task, repoName, agentTerminals, jobAgents) {
  if (task.done) return { status: 'done', jobId: null }

  // Prefer canonical job status from the server over local session heuristics.
  if (jobAgents) {
    for (const agent of jobAgents) {
      if (agent.repo === repoName && (agent.validation === 'needs_validation' || agent.status === 'stopped')) {
        const match = agent.taskName?.toLowerCase().includes(task.text.toLowerCase().slice(0, 30)) ||
          task.text.toLowerCase().includes(agent.taskName?.toLowerCase()?.slice(0, 30) || '')
        if (match) return { status: 'review', jobId: agent.id }
      }
    }
    for (const agent of jobAgents) {
      if (agent.repo === repoName && agent.status === 'in_progress') {
        const match = agent.taskName?.toLowerCase().includes(task.text.toLowerCase().slice(0, 30)) ||
          task.text.toLowerCase().includes(agent.taskName?.toLowerCase()?.slice(0, 30) || '')
        if (match) return { status: 'in_progress', jobId: agent.id }
      }
    }
  }

  // Fallback for brand-new local sessions before the server has indexed the job.
  if (agentTerminals) {
    for (const [sessionId, info] of agentTerminals) {
      if (!info?.jobFile && info.repoName === repoName && info.taskText && task.text.toLowerCase().includes(info.taskText.toLowerCase().slice(0, 30))) {
        return { status: 'in_progress', jobId: sessionId }
      }
    }
  }

  return { status: 'open', jobId: null }
}

function AutoGrowTextarea({ value, onChange, onKeyDown, onBlur, autoFocus, className, placeholder, ...rest }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = ref.current.scrollHeight + 'px'
    }
  }, [value])
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus({ preventScroll: true })
      ref.current.selectionStart = ref.current.value.length
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={1}
      className={className}
      {...rest}
    />
  )
}

export default function AllTasksView({
  overview,
  onOverviewRefresh,
  onNavigateToDispatch,
  onSelectJob,
  swarm,
  agentTerminals,
}) {
  const repos = overview?.repos || []
  const repoNames = repos.map(r => r.name)

  const [savedFilters] = useState(() => loadFilters(STORAGE_KEY))
  const [selectedTimeframes, setSelectedTimeframes] = useState(() => savedFilters?.timeframes ?? new Set(['present']))
  const [selectedStatuses, setSelectedStatuses] = useState(() => savedFilters?.statuses ?? new Set(['open', 'in_progress']))
  const [selectedRepos, setSelectedRepos] = useState(() => savedFilters?.repos ?? new Set(repoNames))
  const [bugFilter, setBugFilter] = useState(() => savedFilters?.bugOnly ?? false)

  // Sync repo filter when repos load (only if no saved filter)
  useMemo(() => {
    if (repoNames.length > 0 && selectedRepos.size === 0) {
      setSelectedRepos(new Set(repoNames))
    }
  }, [repoNames.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist filters to localStorage on change
  useEffect(() => {
    saveFilters(STORAGE_KEY, { timeframes: selectedTimeframes, statuses: selectedStatuses, repos: selectedRepos, bugOnly: bugFilter })
  }, [selectedTimeframes, selectedStatuses, selectedRepos, bugFilter])

  const jobAgents = swarm?.agents || []

  // Build flat task list from all repos
  const allTasks = useMemo(() => {
    const tasks = []
    for (const repo of repos) {
      const repoTasks = repo.tasks?.allTasks || []
      for (const task of repoTasks) {
        const { status, jobId } = deriveStatus(task, repo.name, agentTerminals, jobAgents)
        tasks.push({ ...task, repoName: repo.name, status, jobId, isBug: false })
      }
      const repoBugs = repo.bugs?.allTasks || []
      for (const task of repoBugs) {
        const { status, jobId } = deriveStatus(task, repo.name, agentTerminals, jobAgents)
        tasks.push({ ...task, repoName: repo.name, status, jobId, isBug: true })
      }
    }
    // Sort: open/in_progress first, then review, then done
    const order = { in_progress: 0, open: 1, review: 2, done: 3 }
    tasks.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
    return tasks
  }, [repos, agentTerminals, jobAgents])

  // Apply filters
  const filteredTasks = useMemo(() => {
    return allTasks.filter(t => {
      if (selectedTimeframes.size > 0 && !selectedTimeframes.has(t.timeframe)) return false
      if (selectedStatuses.size > 0 && !selectedStatuses.has(t.status)) return false
      if (selectedRepos.size > 0 && !selectedRepos.has(t.repoName)) return false
      if (bugFilter && !t.isBug) return false
      return true
    })
  }, [allTasks, selectedTimeframes, selectedStatuses, selectedRepos, bugFilter])

  async function handleToggleDone(task) {
    try {
      const url = task.done
        ? (task.isBug ? '/api/bugs/reopen-by-text' : '/api/tasks/reopen-by-text')
        : (task.isBug ? '/api/bugs/done-by-text' : '/api/tasks/done-by-text')
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: task.repoName, text: task.text }),
      })
      onOverviewRefresh?.()
    } catch { /* ignore */ }
  }

  // Inline editing state
  const [editingTaskKey, setEditingTaskKey] = useState(null)
  const [editText, setEditText] = useState('')

  function startEditing(task, key) {
    if (task.done || !task.openTaskNum) return
    setEditingTaskKey(key)
    setEditText(task.text)
  }

  async function handleEditSave(task) {
    const trimmed = editText.trim()
    if (!trimmed || trimmed === task.text) {
      setEditingTaskKey(null)
      return
    }
    try {
      await fetch(task.isBug ? '/api/bugs/edit' : '/api/tasks/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: task.repoName, taskNum: task.openTaskNum, newText: trimmed }),
      })
      onOverviewRefresh?.()
    } catch { /* ignore */ }
    setEditingTaskKey(null)
  }

  function handleEditKeyDown(e, task) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setEditingTaskKey(null)
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleEditSave(task)
    }
  }

  // New task form state (repo persisted across refresh/navigation)
  const [newTaskText, setNewTaskText] = useState('')
  const [newTaskRepo, setNewTaskRepo] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ADD_TASK_STORAGE_KEY))
      if (saved?.repo) return saved.repo
    } catch {}
    return repoNames[0] || ''
  })
  const [newTaskIsBug, setNewTaskIsBug] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ADD_TASK_STORAGE_KEY))
      return saved?.isBug ?? false
    } catch {}
    return false
  })
  const [isAdding, setIsAdding] = useState(false)
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const inputRef = useRef(null)
  const repoDropdownRef = useRef(null)

  // Sync newTaskRepo when repos load (restore saved or default to first)
  useEffect(() => {
    if (repoNames.length > 0 && !repoNames.includes(newTaskRepo)) {
      try {
        const saved = JSON.parse(localStorage.getItem(ADD_TASK_STORAGE_KEY))
        if (saved?.repo && repoNames.includes(saved.repo)) { setNewTaskRepo(saved.repo); return }
      } catch {}
      setNewTaskRepo(repoNames[0])
    }
  }, [repoNames.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist add-task settings on change (skip when repos haven't loaded yet to avoid clobbering saved data)
  useEffect(() => {
    if (!newTaskRepo) return
    try {
      localStorage.setItem(ADD_TASK_STORAGE_KEY, JSON.stringify({ repo: newTaskRepo, isBug: newTaskIsBug }))
    } catch {}
  }, [newTaskRepo, newTaskIsBug])

  // Close repo dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target)) {
        setRepoDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleAddTask(e) {
    e.preventDefault()
    if (!newTaskText.trim() || !newTaskRepo) return
    setIsAdding(true)
    try {
      await fetch(newTaskIsBug ? '/api/bugs/add' : '/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: newTaskRepo,
          text: newTaskText.trim(),
          section: newTaskIsBug ? 'Bug' : null,
        }),
      })
      setNewTaskText('')
      setNewTaskIsBug(false)
      onOverviewRefresh?.()
    } catch { /* ignore */ }
    setIsAdding(false)
  }

  if (repos.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground/60 text-sm">
        No repos configured.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* New task input */}
      <div className="rounded-xl bg-card" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        <form onSubmit={handleAddTask} className="flex items-stretch">
          {/* Repo picker — left section */}
          <div className="relative shrink-0 flex items-center border-r rounded-l-xl hover:bg-card-hover transition-colors" style={{ borderColor: 'rgba(255,255,255,0.06)' }} ref={repoDropdownRef}>
            <button
              type="button"
              onClick={() => setRepoDropdownOpen(p => !p)}
              className="flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium capitalize"
              style={newTaskRepo
                ? { color: getRepoColor(overview, newTaskRepo, 'var(--muted-foreground)') }
                : { color: 'var(--muted-foreground)' }}
            >
              {newTaskRepo || 'Repo'}
              <ChevronDown size={11} className="opacity-50" />
            </button>
            {repoDropdownOpen && (
              <div className="absolute z-20 top-full mt-1 left-0 min-w-[120px] rounded-lg border shadow-lg py-1" style={{ background: '#242329', borderColor: 'rgba(255,255,255,0.06)' }}>
                {repoNames.map(name => {
                  const color = getRepoColor(overview, name)
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => { setNewTaskRepo(name); setRepoDropdownOpen(false) }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-[12px] font-medium capitalize transition-colors',
                        newTaskRepo === name ? 'opacity-100' : 'opacity-70 hover:opacity-100'
                      )}
                      style={{ color }}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Textarea — middle */}
          <AutoGrowTextarea
            value={newTaskText}
            onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleAddTask(e)
              }
            }}
            placeholder="Add a new task..."
            className="flex-1 min-w-0 px-3 py-2.5 bg-transparent border-0 outline-none text-[13px] text-foreground placeholder:text-muted-foreground/35 resize-none [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none' }}
            autoFocus={false}
          />

          {/* Right section — Bug + Add */}
          <div className="shrink-0 flex items-center gap-2 px-3 border-l rounded-r-xl" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={() => setNewTaskIsBug(p => !p)}
              className={cn(
                'text-[13px] px-2 self-stretch flex items-center rounded-md transition-all',
                newTaskIsBug ? 'opacity-100' : 'opacity-30 hover:opacity-60'
              )}
              style={newTaskIsBug ? { background: 'rgba(139,171,143,0.15)' } : undefined}
            >
              🪲
            </button>
            <button
              type="submit"
              disabled={!newTaskText.trim() || !newTaskRepo || isAdding}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all',
                newTaskText.trim() && newTaskRepo && !isAdding
                  ? 'bg-primary/12 text-primary hover:bg-primary/20'
                  : 'text-muted-foreground/25 cursor-not-allowed'
              )}
            >
              <Plus size={13} />
              Add
            </button>
          </div>
        </form>
      </div>

      {/* Filter chips */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Timeframe */}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Time</span>
          {TIMEFRAMES.map(tf => (
            <FilterChip
              key={tf}
              label={tf}
              active={selectedTimeframes.has(tf)}
              onClick={() => toggleFilter(selectedTimeframes, setSelectedTimeframes, tf)}
            />
          ))}

          {/* Divider */}
          <div className="h-4 w-px bg-border mx-1" />

          {/* Status */}
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mr-1 shrink-0">Status</span>
          {STATUSES.map(st => (
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

      {/* Task cards */}
      <div className="space-y-1.5">
        {(() => {
          const inProgressTasks = filteredTasks.filter(t => t.status === 'in_progress' || t.status === 'review')
          const openTasks = filteredTasks.filter(t => t.status === 'open')
          const doneTasks = filteredTasks.filter(t => t.status === 'done')

          const renderTask = (task, i) => {
            const repoColor = getRepoColor(overview, task.repoName)
            const isClickable = (task.status === 'in_progress' || task.status === 'review') && task.jobId
            const taskKey = `${task.repoName}-${task.section}-${task.status}-${i}`
            const isEditing = editingTaskKey === taskKey
            const isEditable = !task.done && task.openTaskNum
            return (
              <div
                key={taskKey}
                onClick={isClickable && !isEditing ? () => onSelectJob?.(task.jobId) : undefined}
                className={cn(
                  'flex items-start gap-3 px-3.5 py-2.5 rounded-lg border bg-card hover:bg-card-hover transition-colors group',
                  isClickable && !isEditing && 'cursor-pointer',
                  isEditing && 'ring-1 ring-primary/30 border-primary/40'
                )}
                style={!isEditing ? { borderColor: 'rgba(255,255,255,0.05)' } : undefined}
                onMouseEnter={!isEditing ? e => e.currentTarget.style.borderColor = 'rgba(139,171,143,0.35)' : undefined}
                onMouseLeave={!isEditing ? e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)' : undefined}
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleToggleDone(task) }}
                  style={!task.done ? { borderColor: '#b4d9b8' } : undefined}
                  className={cn(
                    'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors self-center',
                    task.done
                      ? 'bg-status-complete/20 border-status-complete/40 text-status-complete'
                      : ''
                  )}
                >
                  {task.done && <Check size={10} />}
                </button>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <AutoGrowTextarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => handleEditKeyDown(e, task)}
                      onBlur={() => handleEditSave(task)}
                      autoFocus
                      className="w-full text-[13px] leading-snug text-foreground bg-transparent border border-border rounded px-2 py-1 focus:outline-none focus:border-primary/40 resize-none"
                    />
                  ) : (
                    <p
                      onClick={isEditable ? (e) => { e.stopPropagation(); startEditing(task, taskKey) } : undefined}
                      className={cn(
                        'text-[13px] leading-snug whitespace-pre-wrap',
                        task.done ? 'text-muted-foreground/50 line-through' : 'text-foreground',
                        isEditable && 'cursor-text hover:bg-muted/30 rounded px-1 -mx-1 transition-colors'
                      )}
                    >
                      {task.text}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {task.isBug ? (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full border font-medium"
                        style={{ borderColor: `${BUG_COLOR}50`, backgroundColor: `${BUG_COLOR}12`, color: BUG_COLOR }}
                      >
                        🪲 Bug
                      </span>
                    ) : task.section ? (
                      <span className="text-[11px] truncate" style={{ color: 'var(--foreground-secondary)' }}>
                        {task.section}
                      </span>
                    ) : null}
                    {isEditing && (
                      <span className="text-[10px] text-muted-foreground/40 ml-auto">
                        Esc to cancel · Ctrl+Enter to save
                      </span>
                    )}
                  </div>
                </div>

                {/* Chips */}
                <div className="flex items-center gap-1.5 shrink-0 self-center">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-border bg-card text-muted-foreground/60 capitalize">
                    {task.timeframe}
                  </span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full border capitalize"
                    style={{ background: `${repoColor}10`, color: repoColor, borderColor: `${repoColor}30` }}
                  >
                    {task.repoName}
                  </span>
                </div>

                {/* Start button for open tasks */}
                {task.status === 'open' && !isEditing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onNavigateToDispatch?.(task.repoName, task.text) }}
                    style={{ color: '#b4d9b8', borderColor: '#b4d9b8' }}
                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-[10px] font-medium hover:bg-primary/10 border self-center transition-all shrink-0"
                  >
                    <Play size={10} />
                    Start
                  </button>
                )}

                {/* View button for in_progress/review tasks */}
                {isClickable && !isEditing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelectJob?.(task.jobId) }}
                    className={cn(
                      'opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-transparent transition-all shrink-0',
                      task.status === 'in_progress'
                        ? 'text-status-active hover:bg-status-active/10 hover:border-status-active/20'
                        : 'text-status-review hover:bg-status-review/10 hover:border-status-review/20'
                    )}
                  >
                    <ExternalLink size={10} />
                    View
                  </button>
                )}
              </div>
            )
          }

          const CountBadge = ({ n }) => (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-[9px] font-medium text-muted-foreground/70">{n}</span>
          )

          return (
            <>
              {inProgressTasks.length > 0 && (
                <>
                  <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-status-active font-semibold pt-1 pb-0.5">In Progress <CountBadge n={inProgressTasks.length} /></h3>
                  {inProgressTasks.map(renderTask)}
                </>
              )}
              {openTasks.length > 0 && (
                <>
                  <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground/60 font-semibold pt-3 pb-0.5">Open <CountBadge n={openTasks.length} /></h3>
                  {openTasks.map(renderTask)}
                </>
              )}
              {doneTasks.length > 0 && (
                <>
                  <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-status-complete/60 font-semibold pt-3 pb-0.5">Done <CountBadge n={doneTasks.length} /></h3>
                  {doneTasks.map(renderTask)}
                </>
              )}
            </>
          )
        })()}

        {filteredTasks.length === 0 && (
          <div className="py-12 text-center text-muted-foreground/50 text-sm">
            No tasks match the current filters.
          </div>
        )}
      </div>
    </div>
  )
}
