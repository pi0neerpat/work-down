import { useState, useEffect, useRef, useCallback } from 'react'
import { Circle, CheckCircle2, ListTodo, Plus, Loader, ArrowRightLeft, Save, RotateCcw, X, AlertTriangle, Loader2, Play, ChevronDown, ChevronRight, Pencil, Check, Eye } from 'lucide-react'
import { cn } from '../lib/utils'

const repoIdentityColors = {
  marketing: '#e0b44a',
  website: '#818cf8',
  electron: '#34d399',
  hub: '#7dd3fc',
}

function ProgressBar({ open, done }) {
  const total = open + done
  if (total === 0) return null
  const pct = (done / total) * 100

  return (
    <div className="h-1 rounded-full bg-border overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${pct}%`,
          background: pct >= 50 ? 'var(--status-active)' : 'var(--primary)',
        }}
      />
    </div>
  )
}

function CheckpointControls({ repo, onRefresh }) {
  const [cpLoading, setCpLoading] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)

  const checkpoint = (repo.checkpoints && repo.checkpoints.length > 0) ? repo.checkpoints[0] : null
  const cpTimestamp = checkpoint ? checkpoint.id.replace('checkpoint/', '') : null

  async function handleCreate() {
    setCpLoading(true)
    try {
      await fetch(`/api/repos/${repo.name}/checkpoint`, { method: 'POST' })
      onRefresh?.()
    } catch { /* ignore */ }
    setCpLoading(false)
  }

  async function handleRevert() {
    setCpLoading(true)
    try {
      await fetch(`/api/repos/${repo.name}/checkpoint/${cpTimestamp}/revert`, { method: 'POST' })
      onRefresh?.()
    } catch { /* ignore */ }
    setCpLoading(false)
    setConfirmRevert(false)
  }

  async function handleDismiss() {
    setCpLoading(true)
    try {
      await fetch(`/api/repos/${repo.name}/checkpoint/${cpTimestamp}`, { method: 'DELETE' })
      onRefresh?.()
    } catch { /* ignore */ }
    setCpLoading(false)
  }

  if (checkpoint) {
    return (
      <div className="mx-4 mt-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Save size={11} className="shrink-0" />
            <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>{cpTimestamp}</span>
            <span className="opacity-40">({checkpoint.filesStashed} files)</span>
          </div>
          <button
            onClick={handleDismiss}
            disabled={cpLoading}
            className="p-0.5 rounded hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
            title="Dismiss checkpoint"
          >
            {cpLoading ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          </button>
        </div>
        {confirmRevert ? (
          <div className="mt-2 flex items-start gap-1.5 text-[11px]">
            <AlertTriangle size={12} className="shrink-0 mt-0.5 text-status-dirty" />
            <div>
              <p className="text-status-dirty font-medium">Discard current changes and revert?</p>
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={handleRevert}
                  disabled={cpLoading}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
                >
                  {cpLoading ? 'Reverting...' : 'Confirm Revert'}
                </button>
                <button
                  onClick={() => setConfirmRevert(false)}
                  className="px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmRevert(true)}
            disabled={cpLoading}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw size={10} />
            <span>Revert</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-4 mt-3">
      <button
        onClick={handleCreate}
        disabled={cpLoading}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {cpLoading ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
        <span>Create Checkpoint</span>
      </button>
    </div>
  )
}

function AutoSizeTextarea({ value, onChange, onKeyDown, autoFocus, disabled, className, placeholder }) {
  const ref = useRef(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus()
      // Place cursor at end
      const len = ref.current.value.length
      ref.current.setSelectionRange(len, len)
    }
  }, [autoFocus])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => { onChange(e); resize() }}
      onKeyDown={onKeyDown}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      rows={1}
      style={{ resize: 'none', overflow: 'hidden' }}
    />
  )
}

export default function TaskBoard({ overview, onOverviewRefresh, selectedRepo, onStartTask, activeWorkers, onOpenBee }) {
  const repos = overview?.repos || []
  const activeTab = selectedRepo || (repos.length > 0 ? repos[0].name : '')
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [movingTask, setMovingTask] = useState(null)
  const [collapsedDoneSections, setCollapsedDoneSections] = useState(new Set())
  const [completingTask, setCompletingTask] = useState(null)
  const [editingTask, setEditingTask] = useState(null) // taskNum being edited
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    setMovingTask(null)
    setEditingTask(null)
  }, [activeTab])

  if (repos.length === 0) return null

  const activeRepo = repos.find(r => r.name === activeTab) || repos[0]
  const identityColor = repoIdentityColors[activeRepo.name] || 'var(--primary)'

  async function handleAddTask(e) {
    e.preventDefault()
    const text = newTaskText.trim()
    if (!text || addingTask) return

    setAddingTask(true)

    try {
      const res = await fetch('/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: activeTab, text }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Failed to add task:', err.error || res.statusText)
        return
      }

      setNewTaskText('')
      if (onOverviewRefresh) {
        await onOverviewRefresh()
      }
    } catch (err) {
      console.error('Failed to add task:', err)
    } finally {
      setAddingTask(false)
    }
  }

  async function handleMoveTask(taskNum, toRepo) {
    setMovingTask(null)

    try {
      const res = await fetch('/api/tasks/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromRepo: activeTab, taskNum, toRepo }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Failed to move task:', err.error || res.statusText)
        return
      }

      if (onOverviewRefresh) {
        await onOverviewRefresh()
      }
    } catch (err) {
      console.error('Failed to move task:', err)
    }
  }

  async function handleCompleteTask(taskNum) {
    setCompletingTask(taskNum)
    try {
      const res = await fetch('/api/tasks/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: activeTab, taskNum }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Failed to complete task:', err.error || res.statusText)
        return
      }
      if (onOverviewRefresh) {
        await onOverviewRefresh()
      }
    } catch (err) {
      console.error('Failed to complete task:', err)
    } finally {
      setCompletingTask(null)
    }
  }

  async function handleSaveEdit(taskNum) {
    const text = editText.trim()
    if (!text || savingEdit) return

    setSavingEdit(true)
    try {
      const res = await fetch('/api/tasks/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: activeTab, taskNum, newText: text }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Failed to edit task:', err.error || res.statusText)
        return
      }
      setEditingTask(null)
      setEditText('')
      if (onOverviewRefresh) await onOverviewRefresh()
    } catch (err) {
      console.error('Failed to edit task:', err)
    } finally {
      setSavingEdit(false)
    }
  }

  function toggleDoneSection(sectionIndex) {
    setCollapsedDoneSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionIndex)) {
        next.delete(sectionIndex)
      } else {
        next.add(sectionIndex)
      }
      return next
    })
  }

  // Find active worker session for a given task text + repo
  function findActiveWorker(taskText, repoName) {
    if (!activeWorkers || activeWorkers.size === 0) return null
    for (const [sessionId, info] of activeWorkers) {
      if (info.taskText === taskText && info.repoName === repoName) {
        return sessionId
      }
    }
    return null
  }

  let globalTaskNum = 0

  return (
    <div className="animate-fade-up">
      {/* Repo header */}
      <div className="flex items-center gap-2.5 mb-4 px-1">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: identityColor }} />
        <h2 className="text-[15px] font-medium capitalize text-foreground">{activeRepo.name}</h2>
        <span className="text-[10px] font-mono text-muted-foreground/40" style={{ fontFamily: 'var(--font-mono)' }}>
          {activeRepo?.tasks?.openCount || 0} open / {activeRepo?.tasks?.doneCount || 0} done
        </span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        {/* Checkpoint controls */}
        {activeRepo && (
          <CheckpointControls repo={activeRepo} onRefresh={onOverviewRefresh} />
        )}

        {/* Progress bar */}
        <div className="px-4 pt-3">
          <ProgressBar open={activeRepo?.tasks?.openCount || 0} done={activeRepo?.tasks?.doneCount || 0} />
        </div>

        {/* Task list */}
        <div className="p-4 max-h-[calc(100vh-320px)] overflow-y-auto">
          {activeRepo?.tasks?.sections?.length > 0 ? (
            <div className="space-y-5">
              {activeRepo.tasks.sections.map((section, i) => {
                const openTasks = section.tasks.filter(t => !t.done)
                const doneTasks = section.tasks.filter(t => t.done)
                const isDoneCollapsed = !collapsedDoneSections.has(i)

                return (
                  <div key={i} className="animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
                    {section.name && (
                      <div className="flex items-center gap-2 mb-2.5">
                        <p className="text-[12px] text-muted-foreground/70 font-medium">
                          {section.name}
                        </p>
                        <span className="text-[10px] font-mono text-muted-foreground/30" style={{ fontFamily: 'var(--font-mono)' }}>
                          {openTasks.length}
                        </span>
                      </div>
                    )}
                    <ul className="space-y-2">
                      {openTasks.map((task, j) => {
                        globalTaskNum++
                        const taskNum = globalTaskNum
                        const workerSessionId = findActiveWorker(task.text, activeRepo.name)
                        const isBeingWorked = !!workerSessionId

                        return (
                          <li
                            key={`open-${j}`}
                            className={cn(
                              "flex items-start gap-2 px-3 py-2.5 rounded-lg text-[14px] leading-relaxed transition-colors",
                              "border border-border/50 bg-background/30",
                              isBeingWorked
                                ? "text-foreground/85 bg-status-active-bg/30 border-status-active/20"
                                : "text-foreground/85 hover:bg-card-hover/40 hover:border-border/70 group"
                            )}
                          >
                            {isBeingWorked ? (
                              <span className="mt-0.5 shrink-0 text-status-active">
                                <Loader size={14} className="animate-spin" />
                              </span>
                            ) : (
                              <button
                                onClick={() => handleCompleteTask(taskNum)}
                                disabled={completingTask === taskNum}
                                className="mt-0.5 shrink-0 text-muted-foreground/25 hover:text-status-active transition-colors"
                                title="Mark as done"
                              >
                                {completingTask === taskNum
                                  ? <Loader size={14} className="animate-spin text-muted-foreground/40" />
                                  : <Circle size={14} />
                                }
                              </button>
                            )}
                            {isBeingWorked ? (
                              <span className="flex-1 whitespace-pre-wrap">
                                {task.text}
                              </span>
                            ) : editingTask === taskNum ? (
                              <div className="flex-1 flex flex-col gap-1.5">
                                <AutoSizeTextarea
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') { setEditingTask(null); setEditText('') }
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                      e.preventDefault()
                                      handleSaveEdit(taskNum)
                                    }
                                  }}
                                  autoFocus
                                  disabled={savingEdit}
                                  className="w-full bg-background/60 border border-primary/30 rounded-md px-2.5 py-1.5 text-[13px] text-foreground leading-relaxed focus:outline-none focus:border-primary/50 transition-colors"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(taskNum)}
                                    disabled={savingEdit || !editText.trim()}
                                    className="p-0.5 rounded text-status-active hover:bg-status-active-bg transition-colors disabled:opacity-30"
                                    title="Save (Cmd+Enter)"
                                  >
                                    {savingEdit ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setEditingTask(null); setEditText('') }}
                                    className="p-0.5 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
                                    title="Cancel (Escape)"
                                  >
                                    <X size={12} />
                                  </button>
                                  <span className="text-[10px] text-muted-foreground/30 ml-1">Cmd+Enter to save</span>
                                </div>
                              </div>
                            ) : (
                              <span
                                className="flex-1 cursor-text whitespace-pre-wrap"
                                onDoubleClick={() => { setEditingTask(taskNum); setEditText(task.text) }}
                              >
                                {task.text}
                              </span>
                            )}
                            {isBeingWorked ? (
                              <button
                                onClick={() => onOpenBee?.(workerSessionId)}
                                className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-status-active bg-status-active-bg hover:brightness-110 transition-all"
                                title="Open bee terminal"
                              >
                                <Eye size={10} />
                                <span>View</span>
                              </button>
                            ) : (
                              <>
                                {editingTask !== taskNum && (
                                  <button
                                    onClick={() => onStartTask?.(task.text, activeTab)}
                                    className="shrink-0 opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/40 hover:text-status-active hover:bg-status-active-bg transition-all"
                                    title="Start task in terminal"
                                  >
                                    <Play size={9} />
                                    <span>Start</span>
                                  </button>
                                )}
                                {editingTask !== taskNum && (
                                <div className="relative shrink-0 flex items-center gap-0.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setMovingTask(movingTask === taskNum ? null : taskNum)
                                    }}
                                    className={cn(
                                      'p-0.5 rounded transition-all',
                                      movingTask === taskNum
                                        ? 'opacity-100 text-primary'
                                        : 'opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-primary/70'
                                    )}
                                    title="Move to another repo"
                                  >
                                    <ArrowRightLeft size={12} />
                                  </button>
                                  {movingTask === taskNum && (
                                    <div className="absolute right-0 top-full mt-1 z-10 flex gap-1 bg-card border border-card-border rounded-lg p-1.5 shadow-lg">
                                      {repos
                                        .filter(r => r.name !== activeTab)
                                        .map(r => (
                                          <button
                                            key={r.name}
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleMoveTask(taskNum, r.name)
                                            }}
                                            className="px-2 py-0.5 text-[10px] font-medium rounded-full border transition-colors hover:brightness-110 capitalize whitespace-nowrap"
                                            style={{
                                              color: repoIdentityColors[r.name] || 'var(--primary)',
                                              borderColor: `${repoIdentityColors[r.name] || 'var(--primary)'}30`,
                                              backgroundColor: `${repoIdentityColors[r.name] || 'var(--primary)'}10`,
                                            }}
                                          >
                                            {r.name}
                                          </button>
                                        ))
                                      }
                                    </div>
                                  )}
                                </div>
                                )}
                              </>
                            )}
                          </li>
                        )
                      })}
                    </ul>

                    {/* Collapsible done tasks */}
                    {doneTasks.length > 0 && (
                      <div className="mt-2">
                        <button
                          onClick={() => toggleDoneSection(i)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                        >
                          {isDoneCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          <span>{doneTasks.length} completed</span>
                        </button>
                        {!isDoneCollapsed && (
                          <ul className="space-y-0.5 mt-0.5">
                            {doneTasks.map((task, j) => (
                              <li
                                key={`done-${j}`}
                                className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-[13px] leading-relaxed text-muted-foreground/35"
                              >
                                <CheckCircle2 size={14} className="text-status-complete/30 mt-0.5 shrink-0" />
                                <span className="flex-1 line-through whitespace-pre-wrap">{task.text}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-8 text-center">
              <ListTodo size={24} className="mx-auto mb-2 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground/40">No open tasks</p>
            </div>
          )}
        </div>

        {/* Footer with add task input */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-muted-foreground/50" style={{ fontFamily: 'var(--font-mono)' }}>
              {activeRepo?.tasks?.openCount || 0} open
            </span>
            <span className="text-[10px] font-mono text-status-complete/40" style={{ fontFamily: 'var(--font-mono)' }}>
              {activeRepo?.tasks?.doneCount || 0} done
            </span>
          </div>
          <div className="flex items-start gap-2">
            <AutoSizeTextarea
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleAddTask(e)
                }
              }}
              placeholder="Add a task... (Cmd+Enter to submit)"
              disabled={addingTask}
              className={cn(
                'flex-1 bg-background/40 border border-border rounded-lg px-3 py-2',
                'text-[13px] font-mono text-foreground placeholder:text-muted-foreground/30',
                'focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/10',
                'transition-colors disabled:opacity-50'
              )}
            />
            <button
              type="button"
              onClick={handleAddTask}
              disabled={!newTaskText.trim() || addingTask}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg mt-0.5',
                'text-primary/60 hover:text-primary hover:bg-primary/10',
                'disabled:opacity-20 disabled:cursor-not-allowed',
                'transition-colors'
              )}
            >
              {addingTask ? (
                <Loader size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
