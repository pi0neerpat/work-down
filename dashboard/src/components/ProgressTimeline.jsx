import { useState, useEffect } from 'react'
import { Clock, Loader } from 'lucide-react'
import { timeAgo } from '../lib/utils'
import { statusConfig } from '../lib/statusConfig'

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
    const raw = isoMatch[1].replace(' ', 'T')
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return { time: formatEntryTime(d), text: isoMatch[2] || entry }
  }
  const timeMatch = entry.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)/)
  if (timeMatch) {
    return { time: timeMatch[1], text: timeMatch[2] || entry }
  }
  return { time: null, text: entry }
}

export default function ProgressTimeline({ agentId }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agentId) { setDetail(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)

    async function fetchDetail() {
      try {
        const res = await fetch(`/api/jobs/${agentId}`)
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
        <Loader size={16} className="mx-auto text-muted-foreground/20 animate-spin-slow" />
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
                style={{ background: 'var(--background-raised)', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
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
