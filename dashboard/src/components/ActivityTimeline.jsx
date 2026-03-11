import { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '../lib/utils'
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

export default function ActivityTimeline() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchActivity() {
      try {
        const res = await fetch('/api/activity?limit=15')
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const data = await res.json()
        if (!cancelled) {
          setEntries(data.entries || [])
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchActivity()
    return () => { cancelled = true }
  }, [])

  // Group entries by date
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
    <section className="animate-fade-up" style={{ animationDelay: '360ms' }}>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-muted-foreground" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>
        </div>
        <div className="flex-1 h-px bg-border" />
        {entries.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
            {entries.length} entries
          </span>
        )}
      </div>

      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        {loading ? (
          <div className="py-10 text-center">
            <Clock size={24} className="mx-auto mb-2 text-muted-foreground/30 animate-pulse-soft" />
            <p className="text-sm text-muted-foreground/60">Loading activity...</p>
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <Clock size={24} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/60">Failed to load activity</p>
            <p className="text-xs text-muted-foreground/40 mt-1">{error}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-10 text-center">
            <Clock size={24} className="mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/60 mb-1">No activity recorded</p>
            <p className="text-xs text-muted-foreground/40 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
              Activity appears in activity-log.md
            </p>
          </div>
        ) : (
          <div className="p-4">
            <div className="relative pl-5">
              {/* Vertical timeline line */}
              <div
                className="absolute left-[5px] top-1 bottom-1 w-px"
                style={{ background: 'var(--border)' }}
              />

              {grouped.map((group, gi) => (
                <div key={group.date} className="animate-fade-up" style={{ animationDelay: `${gi * 60}ms` }}>
                  {/* Date header */}
                  <div className="relative flex items-center gap-2 mb-2 -ml-5">
                    <div
                      className="w-[11px] h-[11px] rounded-full border-2 shrink-0 z-10"
                      style={{
                        background: gi === 0 ? 'var(--primary)' : 'var(--background)',
                        borderColor: gi === 0 ? 'var(--primary)' : 'var(--muted-foreground)',
                      }}
                    />
                    <span
                      className={cn(
                        'text-[11px] font-semibold tracking-wide uppercase',
                        gi === 0 ? 'text-foreground-secondary' : 'text-muted-foreground'
                      )}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {formatRelativeDate(group.date)}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  {/* Entries under this date */}
                  <div className={cn('space-y-1', gi < grouped.length - 1 ? 'mb-4' : 'mb-0')}>
                    {group.items.map((item, ii) => {
                      const dotColor = repoIdentityColors[item.repo] || 'var(--muted-foreground)'
                      return (
                        <div
                          key={`${item.repo}-${ii}`}
                          className="relative flex items-start gap-2.5 py-1 animate-slide-in group"
                          style={{ animationDelay: `${(gi * 3 + ii) * 40}ms` }}
                        >
                          {/* Small dot on the timeline */}
                          <div
                            className="absolute -left-5 top-[7px] w-[7px] h-[7px] rounded-full shrink-0 z-10"
                            style={{ background: dotColor, opacity: 0.7 }}
                          />

                          {/* Repo badge */}
                          <span
                            className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded capitalize"
                            style={{
                              background: `${dotColor}12`,
                              color: dotColor,
                              border: `1px solid ${dotColor}30`,
                            }}
                          >
                            {item.repo}
                          </span>

                          {/* Activity text */}
                          <span className="text-xs text-foreground/80 leading-relaxed line-clamp-2">
                            {item.bullet}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
