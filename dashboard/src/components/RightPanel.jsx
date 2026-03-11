import { useState, useEffect, useMemo } from 'react'
import { Clock, Cpu, Loader, PanelRightClose, PanelRightOpen, CheckCircle2, PlayCircle, XCircle, ListChecks } from 'lucide-react'
import { cn, timeAgo } from '../lib/utils'
import { statusConfig } from '../lib/statusConfig'
import { repoIdentityColors } from '../lib/constants'

function formatRelativeDate(dateStr) {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((today - date) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[month - 1]} ${day}`
}

function formatEntryTime(date) {
  const now = new Date()
  const diffMin = Math.round((now - date) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseProgressEntry(entry) {
  const isoMatch = entry.match(/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?Z?)\]\s*(.*)/)
  if (isoMatch) {
    const d = new Date(isoMatch[1].replace(' ', 'T'))
    if (!isNaN(d.getTime())) return { time: formatEntryTime(d), text: isoMatch[2] || entry }
  }
  const timeMatch = entry.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/)
  if (timeMatch) {
    return { time: timeMatch[1], text: timeMatch[2] || entry }
  }
  return { time: null, text: entry }
}

function ProgressTimeline({ agentId }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agentId) { setDetail(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)

    async function fetchDetail() {
      try {
        const res = await fetch(`/api/swarm/${agentId}`)
        if (!res.ok) throw new Error(`${res.status}`)
        const data = await res.json()
        if (!cancelled) setDetail(data)
      } catch {}
      if (!cancelled) setLoading(false)
    }

    fetchDetail()
    const id = setInterval(fetchDetail, 8000)
    return () => { cancelled = true; clearInterval(id) }
  }, [agentId])

  if (loading && !detail) {
    return (
      <div className="py-6 text-center">
        <Loader size={16} className="mx-auto text-muted-foreground/20 animate-spin" />
      </div>
    )
  }

  if (!detail || !detail.progressEntries?.length) {
    return (
      <div className="py-6 text-center">
        <Clock size={16} className="mx-auto mb-1 text-muted-foreground/40" />
        <p className="text-[11px] text-muted-foreground/60">No progress yet.</p>
      </div>
    )
  }

  const st = statusConfig[detail.status] || statusConfig.unknown

  return (
    <div>
      {detail.started && (
        <div className="text-[9px] text-muted-foreground/30 mb-2 px-1" style={{ fontFamily: 'var(--font-mono)' }}>
          started {timeAgo(detail.started, detail.durationMinutes)}
        </div>
      )}

      <div className="relative">
        <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ background: 'rgba(140, 140, 150, 0.05)' }} />
        {detail.progressEntries.map((entry, i) => {
          const isLast = i === detail.progressEntries.length - 1
          const { time, text } = parseProgressEntry(entry)
          return (
            <div key={i} className="relative flex items-start min-h-[28px] pb-1.5 pl-[22px] group">
              <div
                className="absolute left-[4px] top-[3px] w-[7px] h-[7px] rounded-full border-[1.5px] shrink-0 z-10"
                style={{
                  background: isLast ? st.dotColor : 'var(--background)',
                  borderColor: isLast ? st.dotColor : 'rgba(140, 140, 150, 0.12)',
                }}
              />
              <span className="flex-1 min-w-0 text-[11px] text-foreground/60 truncate leading-tight">{text}</span>
              {time && (
                <span className="shrink-0 text-[9px] text-muted-foreground/30 ml-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
                  {time}
                </span>
              )}
              <div
                className="hidden group-hover:block absolute left-4 bottom-full mb-1 z-20 max-w-[280px] px-2 py-1.5 rounded-lg border border-card-border-hover shadow-xl text-[11px] text-foreground whitespace-normal pointer-events-none"
                style={{ background: 'var(--background-raised)', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
              >
                {entry}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function inferActivityType(text) {
  const t = (text || '').toLowerCase()
  if (t.includes('failed') || t.includes('error') || t.includes('killed')) return 'failed'
  if (t.includes('started') || t.includes('running') || t.includes('in progress')) return 'started'
  if (t.includes('completed') || t.includes('done') || t.includes('validated')) return 'completed'
  return 'updated'
}

function typeMeta(type) {
  if (type === 'completed') return { icon: CheckCircle2, label: 'Task Completed', className: 'text-status-complete' }
  if (type === 'started') return { icon: PlayCircle, label: 'Worker Started', className: 'text-status-active' }
  if (type === 'failed') return { icon: XCircle, label: 'Worker Failed', className: 'text-status-failed' }
  return { icon: ListChecks, label: 'Updates', className: 'text-muted-foreground' }
}

function ActivityFeed() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchActivity() {
      try {
        const res = await fetch('/api/activity?limit=20')
        if (!res.ok) throw new Error(`${res.status}`)
        const data = await res.json()
        if (!cancelled) setEntries(data.entries || [])
      } catch {}
      if (!cancelled) setLoading(false)
    }

    fetchActivity()
    return () => { cancelled = true }
  }, [])

  const grouped = useMemo(() => {
    const byDate = new Map()
    for (const entry of entries) {
      const dateGroup = byDate.get(entry.date) || {}
      const type = inferActivityType(entry.bullet)
      dateGroup[type] = dateGroup[type] || []
      dateGroup[type].push(entry)
      byDate.set(entry.date, dateGroup)
    }

    return [...byDate.entries()].map(([date, byType]) => ({ date, byType }))
  }, [entries])

  if (loading) {
    return (
      <div className="py-6 text-center">
        <Loader size={16} className="mx-auto text-muted-foreground/20 animate-spin" />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="py-6 text-center">
        <Clock size={16} className="mx-auto mb-1 text-muted-foreground/40" />
        <p className="text-[11px] text-muted-foreground/60">No activity yet. Complete a task to see it here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {grouped.map((group, gi) => (
        <div key={group.date} className="animate-slide-in" style={{ animationDelay: `${gi * 30}ms` }}>
          <p className="text-[9px] font-mono text-muted-foreground/40 mb-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatRelativeDate(group.date)}
          </p>

          <div className="space-y-2">
            {Object.entries(group.byType).map(([type, items]) => {
              const meta = typeMeta(type)
              const TypeIcon = meta.icon

              return (
                <div key={`${group.date}-${type}`} className="rounded-md border border-border/70 bg-card/50 px-2.5 py-2">
                  <div className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold mb-1.5', meta.className)}>
                    <TypeIcon size={11} />
                    {meta.label}
                  </div>

                  <div className="space-y-1">
                    {items.map((item, ii) => {
                      const dotColor = repoIdentityColors[item.repo] || 'var(--muted-foreground)'
                      return (
                        <div key={`${item.repo}-${ii}`} className="flex items-start gap-1.5 text-[11px] leading-snug">
                          <span className="mt-1 w-1 h-1 rounded-full shrink-0" style={{ background: dotColor }} />
                          <span className="font-medium capitalize" style={{ color: dotColor }}>{item.repo}</span>
                          <span className="text-foreground/55 line-clamp-2">{item.bullet}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RightPanel({ selection, swarm, collapsed, onToggleCollapse, swarmFileId }) {
  const isSwarmSelected = selection?.type === 'swarm'
  const selectedAgent = isSwarmSelected
    ? swarm?.agents?.find(a => a.id === (swarmFileId || selection.id))
    : null

  if (collapsed) {
    return (
      <aside className="w-[40px] shrink-0 border-l border-border bg-background flex flex-col items-center pt-3">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-card transition-colors"
          title="Expand panel"
        >
          <PanelRightOpen size={14} />
        </button>
        <div className="mt-3">
          <Clock size={12} className="text-muted-foreground/20" />
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-[280px] shrink-0 border-l border-border bg-background overflow-y-auto">
      <div className="px-4 pt-2 flex justify-end">
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-lg text-muted-foreground/30 hover:text-muted-foreground hover:bg-card transition-colors"
          title="Collapse panel"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {selectedAgent?.skills?.length > 0 && (
        <div className="px-4 pt-1 pb-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Cpu size={11} className="text-muted-foreground/40" />
            <h3 className="text-[11px] font-medium text-muted-foreground/50">Skills</h3>
          </div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {selectedAgent.skills.map(skill => (
              <span key={skill} className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-primary/15 bg-primary/5 text-primary/60">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {selectedAgent?.skills?.length > 0 && isSwarmSelected && <div className="mx-4 h-px bg-border" />}

      <div className="px-4 pb-3 pt-2">
        <div className="flex items-center gap-2 mb-2 px-1">
          <Clock size={10} className="text-muted-foreground/30" />
          <h3 className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
            {isSwarmSelected ? 'Progress' : 'Activity'}
          </h3>
        </div>

        <div className="px-1">
          {isSwarmSelected ? <ProgressTimeline agentId={swarmFileId || selection.id} /> : <ActivityFeed />}
        </div>
      </div>
    </aside>
  )
}
