import { useState } from 'react'
import { GitBranch, FileText, Save, RotateCcw, X, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { repoIdentityColors } from '../lib/constants'

function ProgressRing({ open, done, size = 32 }) {
  const total = open + done
  if (total === 0) return null
  const pct = done / total
  const r = (size - 4) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct)

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(140, 140, 150, 0.05)" strokeWidth="2.5" />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={pct >= 0.5 ? 'var(--status-active)' : 'var(--primary)'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text
        x={size/2} y={size/2}
        textAnchor="middle" dominantBaseline="central"
        fill="var(--foreground-secondary)"
        fontSize="9" fontFamily="var(--font-mono)" fontWeight="500"
        transform={`rotate(90 ${size/2} ${size/2})`}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

function RepoCard({ repo, index, onRefresh }) {
  const isDirty = repo.git.dirtyCount > 0
  const identityColor = repoIdentityColors[repo.name] || 'var(--primary)'
  const open = repo.tasks.openCount
  const done = repo.tasks.doneCount

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

  return (
    <div
      className="animate-fade-up rounded-lg border border-card-border bg-card hover:bg-card-hover transition-all duration-200 group"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="px-3 py-2.5">
        {/* Header: name + ring + inline stats */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: identityColor }} />
          <h3 className="text-[13px] font-medium capitalize text-foreground flex-1">{repo.name}</h3>
          <ProgressRing open={open} done={done} />
        </div>

        {/* Git + task counts inline */}
        <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground/50">
          <GitBranch size={10} />
          <span className="font-mono" style={{ fontFamily: 'var(--font-mono)' }}>{repo.git.branch}</span>
          {isDirty && (
            <span className="text-status-dirty/60 font-medium">{repo.git.dirtyCount}~</span>
          )}
          <span className="ml-auto font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
            <span className="text-foreground/60">{open}</span>
            <span className="opacity-30"> / </span>
            <span className="text-status-complete/50">{done}</span>
          </span>
        </div>

        {/* Checkpoint section */}
        {checkpoint ? (
          <div className="mb-2 rounded-md border border-border bg-background/20 px-2 py-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
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
        ) : (
          <div className="mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handleCreate}
              disabled={cpLoading}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {cpLoading ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              <span>Create Checkpoint</span>
            </button>
          </div>
        )}

        {/* Last activity */}
        {repo.lastActivity?.bullet && (
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground/50 leading-relaxed">
            <FileText size={11} className="mt-0.5 shrink-0 opacity-40" />
            <p className="line-clamp-2">
              <span className="text-foreground-secondary/70 font-medium">{formatDate(repo.lastActivity.date)}</span>
              {' — '}
              {repo.lastActivity.bullet}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`
}

export default function RepoStatus({ overview, onRefresh }) {
  const repos = overview?.repos || []

  if (repos.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-2 mb-4 px-1">
        <h2 className="text-[13px] font-medium text-muted-foreground/60">Repositories</h2>
        <div className="flex-1 h-px bg-border" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {repos.map((repo, i) => (
          <RepoCard key={repo.name} repo={repo} index={i} onRefresh={onRefresh} />
        ))}
      </div>
    </section>
  )
}
