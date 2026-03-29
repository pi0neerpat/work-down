import { useState, useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Loader, Clock, Square, Activity, ListChecks, GitMerge, Scissors, Network, Trash2, Send, RotateCcw, ChevronRight, ChevronDown, GitBranch, Copy, Check, MoreHorizontal } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig, validationConfig } from '../lib/statusConfig'
import { repoIdentityColors, FOLLOWUP_TEMPLATES } from '../lib/constants'
import { useAgentModels } from '../lib/useAgentModels'
import { mdComponents } from './mdComponents'
import DispatchSettingsRow from './DispatchSettingsRow'

function parseFrontMatter(raw) {
  const text = String(raw || '')
  if (!text.startsWith('---\n')) {
    return { frontMatter: null, body: text }
  }

  const lines = text.split('\n')
  let endIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) {
    return { frontMatter: null, body: text }
  }

  const attrs = []
  for (const line of lines.slice(1, endIndex)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf(':')
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    attrs.push({ key, value })
  }

  const body = lines.slice(endIndex + 1).join('\n')
  return { frontMatter: attrs.length > 0 ? attrs : null, body }
}

function parseBracketedTimestamp(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]$/)
  if (!match) return null
  const date = new Date(match[1].replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return null
  return date
}

function formatExactTimestamp(value) {
  const d = parseBracketedTimestamp(value)
  if (!d) return null
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRelativeTimestamp(value) {
  const d = parseBracketedTimestamp(value)
  if (!d) return null
  return timeAgo(d.toISOString())
}

function formatTimestampsInText(text) {
  return String(text || '').replace(
    /\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/g,
    (_match, datePart, timePart) => {
      const d = new Date(`${datePart}T${timePart}Z`)
      if (Number.isNaN(d.getTime())) return _match
      const relative = timeAgo(d.toISOString())
      if (!relative) return _match
      const exact = d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit',
      })
      return `\`ts:${relative}~~${exact}\``
    }
  )
}

function parseInlineKeyValuePairs(text) {
  const pairs = []
  const re = /([A-Za-z][A-Za-z0-9_-]*):\s*([^:]+?)(?=\s+[A-Za-z][A-Za-z0-9_-]*:\s|$)/g
  let match
  while ((match = re.exec(text)) !== null) {
    const key = match[1].trim()
    const value = match[2].trim()
    if (key && value) pairs.push({ key, value })
  }
  return pairs
}

function parseJobHeader(bodyText) {
  const text = String(bodyText || '')
  const lines = text.split('\n')
  if (lines.length === 0) return { title: null, attrs: null, body: text }

  let idx = 0
  let title = null
  const attrs = []
  const firstLine = lines[0].trim()
  const titleMatch = firstLine.match(/^#\s+(?:Swarm|Job)\s+Task:\s*(.+)$/i)
  if (titleMatch) {
    title = titleMatch[1].trim()
    idx = 1
  }

  for (; idx < lines.length; idx++) {
    const line = lines[idx]
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^##\s+/.test(trimmed)) break

    const linePairs = parseInlineKeyValuePairs(trimmed)
    if (linePairs.length > 0) {
      attrs.push(...linePairs)
      continue
    }

    const sep = trimmed.indexOf(':')
    if (sep > 0) {
      const key = trimmed.slice(0, sep).trim()
      const value = trimmed.slice(sep + 1).trim()
      if (key && value) attrs.push({ key, value })
    }
  }

  return {
    title: title || null,
    attrs: attrs.length > 0 ? attrs : null,
    body: lines.slice(idx).join('\n'),
  }
}

/* ── Zone 1 sub-components ─────────────────────────────── */

function ResultsSummary({ text, statusColor }) {
  return (
    <div
      className="rounded-lg border border-card-border bg-card px-5 py-4 text-sm text-foreground leading-loose"
      style={{ borderLeft: `3px solid ${statusColor || 'var(--primary)'}` }}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{formatTimestampsInText(text)}</Markdown>
    </div>
  )
}

function CollapsibleDetails({ branch, worktreePath }) {
  const [open, setOpen] = useState(false)
  if (!branch || branch === '(merged)') return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>Branch &amp; path</span>
      </button>
      {open && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap animate-slide-in">
          <CopyChip icon={<GitBranch size={9} />} text={branch} label="branch name" />
          {worktreePath && worktreePath !== '(merged)' && (
            <CopyChip icon={null} text={worktreePath} label="worktree path" />
          )}
        </div>
      )}
    </div>
  )
}

/* ── Zone 2 sub-components ─────────────────────────────── */

function ProgressTimeline({ entries }) {
  const [expanded, setExpanded] = useState(false)
  const rows = (entries || []).map((entry) => {
    const text = String(entry || '')
    const m = text.match(/^\[([^\]]+)\]\s*(.*)$/)
    if (!m) return { relative: null, exact: null, text }
    const timestampToken = m[0].match(/^\[[^\]]+\]/)?.[0] || null
    return {
      relative: formatRelativeTimestamp(timestampToken),
      exact: formatExactTimestamp(timestampToken),
      text: (m[2] || '').trim(),
    }
  })

  if (rows.length === 0) return null

  const collapsible = rows.length > 5
  const visibleRows = collapsible && !expanded
    ? [rows[0], ...rows.slice(-2)]
    : rows
  const hiddenCount = rows.length - 3

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 hover:text-foreground/70 transition-colors"
      >
        <ChevronRight size={12} className={cn('transition-transform duration-200', expanded && 'rotate-90')} />
        Progress ({rows.length} steps)
      </button>
      {(expanded || !collapsible) && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3 animate-fade-up">
          <div className="relative pl-4">
            {/* Vertical timeline line */}
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />
            <ul className="space-y-2.5">
              {(collapsible ? rows : visibleRows).map((row, i) => {
                const isLast = i === (collapsible ? rows : visibleRows).length - 1
                return (
                  <li key={`progress-${i}`} className="relative text-xs leading-relaxed">
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        'absolute -left-4 top-[5px] w-[7px] h-[7px] rounded-full border',
                        isLast
                          ? 'bg-primary border-primary/50'
                          : 'bg-card border-muted-foreground/30'
                      )}
                    />
                    <span className={cn(isLast ? 'text-foreground font-medium' : 'text-foreground/70')}>
                      {row.relative ? (
                        <span
                          className="inline-flex items-center rounded-sm border border-border bg-background/40 px-1.5 py-0.5 mr-2 text-[10px] text-muted-foreground"
                          title={row.exact || undefined}
                        >
                          {row.relative}
                        </span>
                      ) : null}
                      <span>{row.text || String(entries[i] || '')}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
      {collapsible && !expanded && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-3 animate-fade-up">
          <div className="relative pl-4">
            <div className="absolute left-[5px] top-1 bottom-1 w-px bg-border" />
            <ul className="space-y-2.5">
              {visibleRows.map((row, i) => {
                const isLast = i === visibleRows.length - 1
                const isCollapsedGap = i === 0
                return (
                  <li key={`progress-${i}`} className="relative text-xs leading-relaxed">
                    <div
                      className={cn(
                        'absolute -left-4 top-[5px] w-[7px] h-[7px] rounded-full border',
                        isLast
                          ? 'bg-primary border-primary/50'
                          : 'bg-card border-muted-foreground/30'
                      )}
                    />
                    <span className={cn(isLast ? 'text-foreground font-medium' : 'text-foreground/70')}>
                      {row.relative ? (
                        <span
                          className="inline-flex items-center rounded-sm border border-border bg-background/40 px-1.5 py-0.5 mr-2 text-[10px] text-muted-foreground"
                          title={row.exact || undefined}
                        >
                          {row.relative}
                        </span>
                      ) : null}
                      <span>{row.text || ''}</span>
                    </span>
                    {isCollapsedGap && hiddenCount > 0 && (
                      <button
                        onClick={() => setExpanded(true)}
                        className="block mt-2 ml-0 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        ··· show {hiddenCount} more steps
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function FullJobOutput({ rawContent }) {
  const { frontMatter, body } = parseFrontMatter(rawContent)
  const { title, attrs, body: markdownBody } = parseJobHeader(body)

  return (
    <div className="rounded-lg border border-card-border bg-card px-5 py-4 text-sm text-foreground/90 leading-loose space-y-3">
      {title && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Job Task</p>
          <p className="text-foreground/95 leading-relaxed">{title}</p>
        </div>
      )}
      {attrs && (
        <div className="rounded-md border border-border bg-background/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Metadata</p>
          <div className="space-y-1">
            {attrs.map((item, i) => (
              <div key={`${item.key}-${i}`} className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                <span className="text-muted-foreground">{item.key}:</span>
                {formatRelativeTimestamp(item.value) ? (
                  <span className="text-foreground/90 break-words" title={formatExactTimestamp(item.value) || undefined}>
                    {formatRelativeTimestamp(item.value)}
                  </span>
                ) : (
                  <span className="text-foreground/90 break-words">{item.value || '""'}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {frontMatter && (
        <div className="rounded-md border border-border bg-background/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Front Matter</p>
          <div className="space-y-1">
            {frontMatter.map((item) => (
              <div key={item.key} className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                <span className="text-muted-foreground">{item.key}:</span>
                {formatRelativeTimestamp(item.value) ? (
                  <span className="text-foreground/90 break-words" title={formatExactTimestamp(item.value) || undefined}>
                    {formatRelativeTimestamp(item.value)}
                  </span>
                ) : (
                  <span className="text-foreground/90 break-words">{item.value || '""'}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {markdownBody.trim() && (
        <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{formatTimestampsInText(markdownBody)}</Markdown>
      )}
    </div>
  )
}

const DIFF_STATUS_COLOR = { M: '#f59e0b', A: '#22c55e', D: '#ef4444', R: '#3b82f6', C: '#a855f7' }

function CopyChip({ icon, text, label }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title={`Copy ${label}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-background/30 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors max-w-xs"
    >
      {icon}
      <span className="truncate">{text}</span>
      {copied ? <Check size={9} className="shrink-0 text-status-active" /> : <Copy size={9} className="shrink-0 opacity-50" />}
    </button>
  )
}

function DiffSummary({ diffData, diffLoading }) {
  const [expanded, setExpanded] = useState(false)

  if (diffLoading) return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Changes</p>
      <div className="rounded-lg border border-card-border bg-card px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader size={11} className="animate-spin" /> Loading diff…
      </div>
    </div>
  )

  if (!diffData) return null

  if (diffData.merged) return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Changes</p>
      <div className="rounded-lg border border-status-active-border bg-status-active-bg px-4 py-3 flex items-center gap-2 text-xs text-status-active">
        <GitMerge size={12} /> Branch merged
      </div>
    </div>
  )

  const files = diffData.files || []
  if (!files.length && !diffData.insertions && !diffData.deletions) return null

  const shown = expanded ? files : files.slice(0, 5)
  const hiddenCount = files.length - 5

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Changes</p>
      <div className="rounded-lg border border-card-border bg-card px-4 py-3 space-y-1.5">
        <div className="pb-1.5 border-b border-border text-[10px] text-muted-foreground font-mono flex items-center gap-2">
          <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
          {diffData.insertions > 0 && <span className="text-green-500">+{diffData.insertions}</span>}
          {diffData.deletions > 0 && <span className="text-red-400">−{diffData.deletions}</span>}
          {diffData.commits > 0 && <span className="text-muted-foreground/60">{diffData.commits} commit{diffData.commits !== 1 ? 's' : ''}</span>}
        </div>
        {shown.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="w-3 text-center font-bold shrink-0 text-[10px]" style={{ color: DIFF_STATUS_COLOR[f.status] || '#6b7280' }}>
              {f.status}
            </span>
            <span className="text-foreground/80 truncate">{f.path}</span>
          </div>
        ))}
        {!expanded && hiddenCount > 0 && (
          <button onClick={() => setExpanded(true)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors pl-5">
            + {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Zone 3 sub-components ─────────────────────────────── */

function AgentActions({ detail, agentId, diffData, onJobsRefresh, onOverviewRefresh, onStartTask, onBack, onRemoveSession, showToast, showFeedbackMsg, settings }) {
  const [merging, setMerging] = useState(false)
  const [mergedBranch, setMergedBranch] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSplitInput, setShowSplitInput] = useState(false)
  const [showSubtaskInput, setShowSubtaskInput] = useState(false)
  const [splitText, setSplitText] = useState('')
  const [subtaskText, setSubtaskText] = useState('')
  const [dispatching, setDispatching] = useState(false)
  const [showFollowUp, setShowFollowUp] = useState(false)

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
      setMergedBranch({ branch: data.merged, into: data.into })
      showToast?.(`Branch merged into ${data.into}`, 'success')
      onJobsRefresh?.()
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

  async function handleFollowUpDispatch(prompt, dispatchOpts = {}) {
    if (!detail?.repo) return
    setDispatching(true)
    try {
      const sessionId = await onStartTask?.(prompt, detail.repo, {
        ...dispatchOpts,
        originalTask: dispatchOpts.originalTask || prompt,
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

  const hasBranch = detail.branch && detail.branch !== '(merged)'
  const canMerge = hasBranch && detail.validation === 'validated'
  const diffStat = diffData && !diffData.merged && (diffData.files?.length || diffData.insertions)
    ? [
        `${diffData.files?.length ?? 0} file${(diffData.files?.length ?? 0) !== 1 ? 's' : ''}`,
        diffData.insertions > 0 ? `+${diffData.insertions}` : null,
        diffData.deletions > 0 ? `−${diffData.deletions}` : null,
      ].filter(Boolean).join(', ')
    : null
  const showFollowUpSection = detail.validation === 'needs_validation' || detail.status === 'completed' || detail.status === 'killed'

  return (
    <div className="space-y-5">
      {/* Merge CTA */}
      {canMerge && !mergedBranch && (
        <div>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-[12px] font-medium border border-status-active-border bg-status-active-bg text-status-active hover:brightness-110 disabled:opacity-50 transition-colors"
          >
            {merging ? <Loader size={12} className="animate-spin" /> : <GitMerge size={13} />}
            Merge Branch
            {diffStat && !merging && (
              <span className="text-[10px] opacity-70 font-mono">· {diffStat}</span>
            )}
          </button>
        </div>
      )}
      {mergedBranch && (
        <div className="rounded-lg border border-status-active-border bg-status-active-bg px-4 py-3 text-xs text-status-active flex items-center gap-2">
          <GitMerge size={13} />
          Merged <code className="font-mono text-[10px] mx-1 opacity-90">{mergedBranch.branch}</code> into <code className="font-mono text-[10px] ml-1 opacity-90">{mergedBranch.into}</code>
        </div>
      )}

      {/* Split & Subtask */}
      <div className="flex items-center gap-2 flex-wrap">
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
      </div>

      {/* Split input */}
      {showSplitInput && (
        <div className="space-y-2 animate-slide-in">
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

      {/* Subtask input */}
      {showSubtaskInput && (
        <div className="flex items-center gap-2 animate-slide-in">
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

      {/* Follow-up dispatch — collapsed by default */}
      {showFollowUpSection && (
        <div>
          <button
            onClick={() => setShowFollowUp(v => !v)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight size={12} className={cn('transition-transform duration-200', showFollowUp && 'rotate-90')} />
            <Send size={11} />
            Continue as New Job
          </button>
          {showFollowUp && (
            <div className="mt-3 animate-slide-in">
              <FollowUpChat
                repoName={detail.repo}
                detail={detail}
                onDispatch={handleFollowUpDispatch}
                dispatching={dispatching}
                settings={settings}
              />
            </div>
          )}
        </div>
      )}

      {/* Danger zone — Delete isolated at bottom */}
      <div className="pt-4 border-t border-border/50">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors',
            confirmDelete
              ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
              : 'border border-transparent text-muted-foreground/40 hover:text-status-failed/70 hover:border-status-failed-border/30 hover:bg-status-failed-bg/50'
          )}
        >
          {deleting ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
          {confirmDelete ? 'Confirm Delete?' : 'Delete Job'}
        </button>
      </div>
    </div>
  )
}

function readDispatchSaved() {
  try { return JSON.parse(localStorage.getItem('dispatch-settings')) || {} } catch { return {} }
}
function writeDispatchSaved(patch) {
  try {
    const prev = readDispatchSaved()
    localStorage.setItem('dispatch-settings', JSON.stringify({ ...prev, ...patch }))
  } catch {}
}

function FollowUpChat({ repoName, detail, onDispatch, dispatching, settings: appSettings }) {
  const saved = useRef(null)
  if (!saved.current) { saved.current = readDispatchSaved() }
  const s = saved.current
  const agentSettings = appSettings?.agents || {}

  const [agent, setAgentRaw] = useState(s.agent || 'claude')
  const [model, setModelRaw] = useState(s.model || agentSettings[s.agent || 'claude']?.defaultModel || '')
  const [maxTurns, setMaxTurnsRaw] = useState(() => {
    const cfg = agentSettings[s.agent || 'claude'] || {}
    return 'defaultMaxTurns' in cfg ? cfg.defaultMaxTurns : 10
  })
  const [useWorktree, setUseWorktreeRaw] = useState(s.useWorktree ?? false)
  const [autoMerge, setAutoMergeRaw] = useState(s.autoMerge ?? false)
  const [plainOutput, setPlainOutputRaw] = useState(s.plainOutput ?? !(agentSettings[s.agent || 'claude']?.tuiMode ?? true))
  const models = useAgentModels(agent)

  const [chatPrompt, setChatPrompt] = useState('')
  const [activeTemplate, setActiveTemplate] = useState(null)

  const setModel = v => { setModelRaw(v); writeDispatchSaved({ model: v }) }
  const setMaxTurns = v => { setMaxTurnsRaw(v) }
  const setUseWorktree = v => { setUseWorktreeRaw(v); writeDispatchSaved({ useWorktree: v }) }
  const setAutoMerge = v => { setAutoMergeRaw(v); writeDispatchSaved({ autoMerge: v }) }
  const setPlainOutput = v => { setPlainOutputRaw(v); writeDispatchSaved({ plainOutput: v }) }

  function switchAgent(newAgent) {
    const defaults = agentSettings[newAgent] || {}
    const newModel = defaults.defaultModel || ''
    const newTurns = 'defaultMaxTurns' in defaults ? defaults.defaultMaxTurns : (newAgent === 'claude' ? 10 : null)
    const newPlainOutput = !(defaults.tuiMode ?? true)
    setAgentRaw(newAgent); setModelRaw(newModel); setMaxTurnsRaw(newTurns); setPlainOutputRaw(newPlainOutput)
    writeDispatchSaved({ agent: newAgent, model: newModel, plainOutput: newPlainOutput })
  }

  useEffect(() => {
    if (models.length > 0 && !models.find(m => m.value === model)) {
      const newModel = agentSettings[agent]?.defaultModel || models[0].value
      setModel(newModel)
    }
  }, [models])

  const isCodex = agent === 'codex'

  async function handleDispatch() {
    if (!chatPrompt.trim()) return
    const basePrompt = chatPrompt.trim()
    const contextLine = detail?.id ? `Previous job context: notes/jobs/${detail.id}.md` : ''
    const hasContext = contextLine && basePrompt.includes(contextLine)
    const promptWithContext = contextLine && !hasContext
      ? `${basePrompt}\n\n---\n${contextLine}`
      : basePrompt
    await onDispatch?.(promptWithContext, {
      agent,
      model,
      maxTurns: isCodex ? null : maxTurns,
      autoMerge,
      useWorktree,
      plainOutput,
      originalTask: basePrompt,
    })
    setChatPrompt('')
    setActiveTemplate(null)
  }

  return (
    <div className="space-y-3">
      {/* Dispatch settings */}
      <div className="flex items-start gap-3 flex-wrap">
        <DispatchSettingsRow
          agent={agent} onSwitchAgent={switchAgent}
          model={model} setModel={setModel} models={models}
          maxTurns={maxTurns} setMaxTurns={setMaxTurns}
          useWorktree={useWorktree} setUseWorktree={setUseWorktree}
          autoMerge={autoMerge} setAutoMerge={setAutoMerge}
          plainOutput={plainOutput} setPlainOutput={setPlainOutput}
        />
      </div>

      {/* Template buttons */}
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

      {/* Prompt + Dispatch button */}
      <div className="flex items-start gap-2">
        <textarea
          value={chatPrompt}
          onChange={(e) => {
            setChatPrompt(e.target.value)
            setActiveTemplate(null)
          }}
          placeholder="Send follow-up instructions to a new worker..."
          rows={3}
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
  )
}

/* ── State-specific hero styling ───────────────────────── */

function getHeroStyle(status, validation) {
  if (status === 'in_progress') return 'animate-glow-pulse'
  if (status === 'failed' || status === 'killed') return 'ring-1 ring-status-failed/10'
  if (validation === 'needs_validation') return 'ring-1 ring-status-review/10'
  if (validation === 'validated') return 'opacity-90'
  return ''
}

function getHeroBg(status, validation) {
  if (status === 'in_progress') return 'bg-status-active-bg/30'
  if (status === 'failed' || status === 'killed') return 'bg-status-failed-bg/30'
  if (validation === 'needs_validation') return 'bg-status-review-bg/30'
  if (validation === 'validated') return 'bg-status-active-bg/20'
  return 'bg-card/30'
}

/* ── Main component ────────────────────────────────────── */

export default function ResultsPanel({ agentId, hasLiveTerminal = false, onJobsRefresh, onOverviewRefresh, onStartTask, onResumeJob, onBack, onRemoveSession, showToast, settings }) {
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
  const [showFullOutput, setShowFullOutput] = useState(false)
  const [diffData, setDiffData] = useState(null)
  const [diffLoading, setDiffLoading] = useState(false)

  useEffect(() => {
    if (!agentId) { setDiffData(null); return }
    let cancelled = false
    setDiffLoading(true)
    fetch(`/api/jobs/${agentId}/diff`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setDiffData(data) })
      .catch(() => { if (!cancelled) setDiffData(null) })
      .finally(() => { if (!cancelled) setDiffLoading(false) })
    return () => { cancelled = true }
  }, [agentId])

  useEffect(() => {
    if (!agentId) { setDetail(null); return }
    let cancelled = false
    let intervalId = null
    setLoading(true)
    setError(null)
    setDetail(null)
    setShowRejectInput(false)
    setRejectNotes('')
    setFeedback(null)
    setConfirmKill(false)
    setTaskMarked(false)
    setMarkingDone(false)
    setShowFullOutput(false)

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
    intervalId = setInterval(fetchDetail, 3000)
    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
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
      showFeedbackMsg('Approved')
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
      showFeedbackMsg('Changes requested')
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
  const statusColor = st.borderColor || 'var(--primary)'

  const canAct = (detail.validation === 'needs_validation' || detail.validation === 'none') &&
    !(detail.validation === 'validated' || detail.validation === 'rejected')


  return (
    <div className="animate-fade-up space-y-6">
      {/* ━━━ ZONE 1: VERDICT ━━━ */}
      <div className={cn('rounded-xl p-5', getHeroBg(detail.status, detail.validation), getHeroStyle(detail.status, detail.validation))}>
        {/* Compact hero header */}
        <div className="flex items-start gap-3">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', st.bg)}>
            <StatusIcon size={18} className={cn(st.color, detail.status === 'in_progress' && 'animate-spin-slow')} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-foreground leading-tight">{detail.taskName || detail.id}</h2>
            <div className="flex items-center gap-2.5 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
                style={{ background: `${repoColor}15`, color: repoColor, border: `1px solid ${repoColor}30` }}
              >
                {detail.repo}
              </span>
              <span className={cn('font-medium', st.color)}>{st.label}</span>
              {relativeTime && (
                <span
                  className="flex items-center gap-1 font-mono"
                  style={{ fontFamily: 'var(--font-mono)' }}
                  title={detail.started || undefined}
                >
                  <Clock size={10} />
                  {relativeTime}
                </span>
              )}
              {val && (
                <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', val.bg, val.color, val.border)}>
                  {val.label}
                </span>
              )}
            </div>

            {/* Collapsible branch/worktree details */}
            <CollapsibleDetails branch={detail.branch} worktreePath={detail.worktreePath} />
          </div>

          {/* Top-right controls: Resume / Stop */}
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

        {/* Results summary — visually dominant with accent bar */}
        {detail.results && (
          <div className="mt-4">
            <ResultsSummary text={detail.results} statusColor={statusColor} />
          </div>
        )}

        {/* Action bar — Approve / Request Changes / Mark Done — right here in Zone 1 */}
        {(canAct || (!taskMarked && detail.status === 'completed')) && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              {canAct && (
                <>
                  <button
                    onClick={handleValidate}
                    disabled={actionLoading}
                    className={cn(
                      'flex items-center gap-1.5 px-5 py-2.5 rounded-md text-[13px] font-semibold transition-all shadow-sm',
                      'bg-status-active text-background',
                      'hover:brightness-110 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {actionLoading ? <Loader size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                    Approve Changes
                  </button>
                  <button
                    onClick={() => {
                      setShowRejectInput(!showRejectInput)
                      setRejectNotes('')
                    }}
                    disabled={actionLoading}
                    className={cn(
                      'flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors',
                      'border border-border text-muted-foreground',
                      'hover:text-status-failed hover:border-status-failed-border hover:bg-status-failed-bg/50',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    <XCircle size={13} />
                    Request Changes
                  </button>
                </>
              )}

              {!taskMarked && detail.status === 'completed' && (
                <button
                  onClick={handleMarkDone}
                  disabled={markingDone}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    canAct ? 'ml-auto' : '',
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
                  placeholder="What needs to change?"
                  className="flex-1 h-8 rounded-md border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-status-review/40"
                  onKeyDown={(e) => { if (e.key === 'Enter' && rejectNotes.trim()) handleReject() }}
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

        {/* Feedback message */}
        {feedback && (
          <div className={cn('mt-3 rounded-md px-3 py-2 text-xs font-medium animate-fade-up', feedback.isError
            ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
            : 'bg-status-active-bg text-status-active border border-status-active-border')}>
            {feedback.msg}
          </div>
        )}

      </div>

      {/* ━━━ ZONE 2: EVIDENCE ━━━ */}
      <div className="space-y-5">
        <DiffSummary diffData={diffData} diffLoading={diffLoading} />

        <ProgressTimeline entries={detail.progressEntries} />

        {detail.rawContent && (
          <div>
            <button
              type="button"
              onClick={() => setShowFullOutput(v => !v)}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 hover:text-foreground/70 transition-colors"
            >
              <ChevronRight size={12} className={cn('transition-transform duration-200', showFullOutput && 'rotate-90')} />
              Full Job Output
            </button>
            {showFullOutput && <FullJobOutput rawContent={detail.rawContent} />}
          </div>
        )}

        {detail.validationNotes && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Validation Notes</p>
            <div className="rounded-lg border border-status-review-border bg-status-review-bg px-4 py-3 text-xs text-foreground/80 leading-relaxed">
              <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{formatTimestampsInText(detail.validationNotes)}</Markdown>
            </div>
          </div>
        )}
      </div>

      {/* ━━━ ZONE 3: NEXT STEPS ━━━ */}
      <div className="pt-5 border-t border-border">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-4">Next Steps</p>
        <AgentActions
          detail={detail}
          agentId={agentId}
          diffData={diffData}
          onJobsRefresh={onJobsRefresh}
          onOverviewRefresh={onOverviewRefresh}
          onStartTask={onStartTask}
          onBack={onBack}
          onRemoveSession={onRemoveSession}
          showToast={showToast}
          showFeedbackMsg={showFeedbackMsg}
          settings={settings}
        />
      </div>
    </div>
  )
}
