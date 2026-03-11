import { useState, useEffect } from 'react'
import { Activity, AlertCircle, ShieldOff, Shield } from 'lucide-react'
import { cn } from '../lib/utils'

function ConnectionDot({ connected, lastRefresh }) {
  const [ago, setAgo] = useState('...')

  useEffect(() => {
    if (!lastRefresh) return
    const tick = () => setAgo(`${Math.round((Date.now() - lastRefresh.getTime()) / 1000)}s`)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastRefresh])

  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        {connected && (
          <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full"
            style={{ background: connected ? 'var(--status-active)' : 'var(--status-failed)' }}
          />
        )}
        <span className="relative inline-flex rounded-full h-1.5 w-1.5"
          style={{ background: connected ? 'var(--status-active)' : 'var(--status-failed)' }}
        />
      </span>
      <span className="text-[10px] text-muted-foreground/70 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
        {connected ? ago : 'offline'}
      </span>
    </div>
  )
}

function ResetCountdown({ resetsAt }) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (!resetsAt) return
    const tick = () => {
      const remaining = Math.max(0, resetsAt - Date.now())
      if (remaining <= 0) {
        setText('resetting...')
        return
      }
      const totalMin = Math.ceil(remaining / 60000)
      const hrs = Math.floor(totalMin / 60)
      const mins = totalMin % 60
      if (hrs > 0) {
        setText(`${hrs}h ${mins}m`)
      } else {
        setText(`${mins}m`)
      }
    }
    tick()
    const id = setInterval(tick, 30000) // update every 30s (minutes-level precision)
    return () => clearInterval(id)
  }, [resetsAt])

  if (!text) return null

  return (
    <span className="text-[10px] text-muted-foreground/40" style={{ fontFamily: 'var(--font-mono)' }}>
      resets {text}
    </span>
  )
}

export default function HeaderBar({ overview, swarm, lastRefresh, error, skipPermissions, onToggleSkipPermissions, contextUsage, contextResetInfo }) {
  const activeAgents = swarm?.summary?.active || 0
  const needsReview = swarm?.summary?.needsValidation || 0

  const title = overview?.hubRoot
    ?.replace(/\/hub\/?$/, '')
    .split('/')
    .pop()
    ?.toUpperCase() || 'HUB'

  return (
    <header className="sticky top-0 z-50 bg-background border-b border-border">
      <div className="px-4 py-2 flex items-center justify-between">
        {/* Left: brand */}
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-medium text-foreground leading-none" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </h1>
        </div>

        {/* Right: badges + connection */}
        <div className="flex items-center gap-2.5">
          {activeAgents > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded bg-status-active-bg text-status-active">
              <Activity size={10} strokeWidth={2.5} />
              <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>{activeAgents}</span>
              <span className="opacity-60 hidden sm:inline">active</span>
            </span>
          )}
          {needsReview > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded bg-status-review-bg text-status-review">
              <AlertCircle size={10} strokeWidth={2.5} />
              <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>{needsReview}</span>
              <span className="opacity-60 hidden sm:inline">review</span>
            </span>
          )}
          <button
            onClick={onToggleSkipPermissions}
            className={cn(
              'flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded transition-all',
              skipPermissions
                ? 'bg-status-review-bg text-status-review/70'
                : 'bg-status-active-bg text-status-active/70'
            )}
            title={skipPermissions
              ? 'Permissions are skipped (--dangerously-skip-permissions). Click to require permissions.'
              : 'Permissions required. Click to skip permissions.'
            }
          >
            {skipPermissions
              ? <><ShieldOff size={10} strokeWidth={2.5} /><span className="hidden sm:inline">YOLO</span></>
              : <><Shield size={10} strokeWidth={2.5} /><span className="hidden sm:inline">Safe</span></>
            }
          </button>
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md"
            style={{ background: contextUsage != null ? 'rgba(140, 140, 150, 0.04)' : 'transparent' }}
            title={contextUsage != null ? `${contextUsage}% session context used` : 'Session usage — waiting for data'}
          >
            <span className="text-[10px] text-muted-foreground/40">Session</span>
            <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(140, 140, 150, 0.08)' }}>
              {contextUsage != null && (
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${contextUsage}%`,
                    background: contextUsage > 80 ? 'var(--status-failed)' : contextUsage > 50 ? 'var(--status-review)' : 'var(--status-active)',
                  }}
                />
              )}
            </div>
            <span className="text-[10px] font-mono text-muted-foreground/50" style={{ fontFamily: 'var(--font-mono)', minWidth: '2.5em' }}>
              {contextUsage != null ? `${contextUsage}%` : '--'}
            </span>
            {contextResetInfo?.resetsAt && <ResetCountdown resetsAt={contextResetInfo.resetsAt} />}
          </div>
          <ConnectionDot connected={!error} lastRefresh={lastRefresh} />
        </div>
      </div>
    </header>
  )
}
