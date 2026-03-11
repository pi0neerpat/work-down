import { useState, useEffect } from 'react'
import { Clock, Cpu, Loader, PanelRightClose, PanelRightOpen } from 'lucide-react'
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
  // [2026-03-11T14:30:15] or [2026-03-11 14:30:15]
  const isoMatch = entry.match(/^\[(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?Z?)\]\s*(.*)/)
  if (isoMatch) {
    const d = new Date(isoMatch[1].replace(' ', 'T'))
    if (!isNaN(d.getTime())) return { time: formatEntryTime(d), text: isoMatch[2] || entry }
  }
  // [14:30] or [14:30:15]
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
        <p className="text-[11px] text-muted-foreground/50">No progress yet</p>
      </div>
    )
  }

  const st = statusConfig[detail.status] || statusConfig.unknown

  return (
    <div>
      {/* Started indicator */}
      {detail.started && (
        <div className="text-[9px] text-muted-foreground/30 mb-2 px-1" style={{ fontFamily: 'var(--font-mono)' }}>
          started {timeAgo(detail.started, detail.durationMinutes)}
        </div>
      )}

      <div className="relative">
        {/* Vertical line — centered at left 7.5px */}
        <div
          className="absolute left-[7px] top-1 bottom-1 w-px"
          style={{ background: 'rgba(140, 140, 150, 0.05)' }}
        />
        {detail.progressEntries.map((entry, i) => {
          const isLast = i === detail.progressEntries.length - 1
          const { time, text } = parseProgressEntry(entry)
          return (
            <div
              key={i}
              className="relative flex items-start min-h-[28px] pb-1.5 pl-[22px] group"
            >
              {/* Dot — centered at left 7.5px (4px + half of 7px) */}
              <div
                className="absolute left-[4px] top-[3px] w-[7px] h-[7px] rounded-full border-[1.5px] shrink-0 z-10"
                style={{
                  background: isLast ? st.dotColor : 'var(--background)',
                  borderColor: isLast ? st.dotColor : 'rgba(140, 140, 150, 0.12)',
                }}
              />
              <span className="flex-1 min-w-0 text-[11px] text-foreground/60 truncate leading-tight">
                {text}
              </span>
              {time && (
                <span className="shrink-0 text-[9px] text-muted-foreground/30 ml-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
                  {time}
                </span>
              )}
              {/* Hover tooltip for full text */}
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

function ActivityFeed({ overview }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchActivity() {
      try {
        const res = await fetch('/api/activity?limit=8')
        if (!res.ok) throw new Error(`${res.status}`)
        const data = await res.json()
        if (!cancelled) setEntries(data.entries || [])
      } catch {}
      if (!cancelled) setLoading(false)
    }

    fetchActivity()
    return () => { cancelled = true }
  }, [])

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
        <p className="text-[11px] text-muted-foreground/50">No activity</p>
      </div>
    )
  }

  const grouped = []
  for (const entry of entries) {
    const last = grouped[grouped.length - 1]
    if (last && last.date === entry.date) {
      last.items.push(entry)
    } else {
      grouped.push({ date: entry.date, items: [entry] })
    }
  }

  return (
    <div className="relative pl-4">
      <div
        className="absolute left-[5px] top-1 bottom-1 w-px"
        style={{ background: 'rgba(140, 140, 150, 0.05)' }}
      />
      {grouped.map((group, gi) => (
        <div key={group.date}>
          <div className="relative flex items-center gap-1.5 mb-1 -ml-4">
            <div
              className="w-[6px] h-[6px] rounded-full border-[1.5px] shrink-0 z-10"
              style={{
                background: gi === 0 ? 'var(--primary)' : 'var(--background)',
                borderColor: gi === 0 ? 'var(--primary)' : 'rgba(140, 140, 150, 0.15)',
              }}
            />
            <span
              className={cn(
                'text-[9px] font-medium tracking-wide',
                gi === 0 ? 'text-foreground-secondary/70' : 'text-muted-foreground/35'
              )}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {formatRelativeDate(group.date)}
            </span>
          </div>
          <div className={cn('space-y-0', gi < grouped.length - 1 ? 'mb-2' : 'mb-0')}>
            {group.items.map((item, ii) => {
              const dotColor = repoIdentityColors[item.repo] || 'var(--muted-foreground)'
              return (
                <div key={`${item.repo}-${ii}`} className="relative flex items-start gap-1.5 py-px">
                  <div
                    className="absolute -left-4 top-[4px] w-[3px] h-[3px] rounded-full z-10"
                    style={{ background: dotColor, opacity: 0.4 }}
                  />
                  <span
                    className="shrink-0 text-[8px] font-medium px-1 rounded capitalize"
                    style={{
                      color: dotColor,
                      opacity: 0.5,
                    }}
                  >
                    {item.repo}
                  </span>
                  <span className="text-[10px] text-foreground/40 leading-snug line-clamp-1">
                    {item.bullet}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function RightPanel({ selection, overview, swarm, collapsed, onToggleCollapse, swarmFileId }) {
  const isSwarmSelected = selection?.type === 'swarm'
  const selectedAgent = isSwarmSelected
    ? swarm?.agents?.find(a => a.id === (swarmFileId || selection.id))
    : null

  // Collapsed state — thin strip with icon
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
    <aside className="w-[260px] shrink-0 border-l border-border bg-background overflow-y-auto">
      {/* Collapse toggle */}
      <div className="px-4 pt-2 flex justify-end">
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-lg text-muted-foreground/30 hover:text-muted-foreground hover:bg-card transition-colors"
          title="Collapse panel"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Skills section — above progress for swarm agents */}
      {selectedAgent?.skills?.length > 0 && (
        <div className="px-4 pt-1 pb-3">
          <div className="flex items-center gap-2 mb-2 px-1">
            <Cpu size={11} className="text-muted-foreground/40" />
            <h3 className="text-[11px] font-medium text-muted-foreground/50">
              Skills
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5 px-1">
            {selectedAgent.skills.map(skill => (
              <span
                key={skill}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-primary/15 bg-primary/5 text-primary/60"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Divider between skills and progress/activity */}
      {selectedAgent?.skills?.length > 0 && isSwarmSelected && (
        <div className="mx-4 h-px bg-border" />
      )}

      {/* Progress Timeline / Activity section */}
      <div className="px-4 pb-3 pt-2">
        <div className="flex items-center gap-2 mb-2 px-1">
          <Clock size={10} className="text-muted-foreground/30" />
          <h3 className="text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">
            {isSwarmSelected ? 'Progress' : 'Activity'}
          </h3>
        </div>

        <div className="px-1">
          {isSwarmSelected ? (
            <ProgressTimeline agentId={swarmFileId || selection.id} />
          ) : (
            <ActivityFeed overview={overview} />
          )}
        </div>
      </div>
    </aside>
  )
}
