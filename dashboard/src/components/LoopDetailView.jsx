import { useMemo } from 'react'
import { ArrowLeft, Clock, Code2, ScanSearch, GitFork, RefreshCcw } from 'lucide-react'
import { cn, timeAgo } from '../lib/utils'
import { repoIdentityColors, normalizeAgentId, getAgentBrandColor } from '../lib/constants'
import AgentIcon, { getAgentLabel } from './AgentIcon'
import TerminalPanel from './TerminalPanel'

const LOOP_TYPE_META = {
  'linear-implementation': { label: 'Linear Implementation', icon: Code2 },
  'linear-review':         { label: 'Linear Review',         icon: ScanSearch },
  'parallel-review':       { label: 'Parallel Review',       icon: GitFork },
}

const STATUS_COLORS = {
  in_progress: '#4ade80',
  completed:   '#8bab8f',
  failed:      '#f87171',
  unknown:     '#888',
}

export default function LoopDetailView({
  loopId,
  loops,
  onBack,
  agentTerminals,
  onKillSession,
  onUpdateSessionId,
  onPromptSent,
  onContextUsage,
  onJobsChanged,
}) {
  const loop = useMemo(() => {
    const all = loops?.jobs || []
    return all.find(j => j.id === loopId) || null
  }, [loops, loopId])

  if (!loop) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
          <button onClick={onBack} className="p-1.5 rounded-md hover:bg-card-hover transition-colors text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <span className="text-[13px] text-muted-foreground">Loop not found</span>
        </div>
      </div>
    )
  }

  const meta = LOOP_TYPE_META[loop.loopType] || { label: loop.loopType, icon: RefreshCcw }
  const TypeIcon = meta.icon
  const repoColor = repoIdentityColors[loop.repo] || 'var(--primary)'
  const statusColor = STATUS_COLORS[loop.status] || STATUS_COLORS.unknown
  const duration = loop.durationMinutes != null ? timeAgo(null, loop.durationMinutes) : null
  const agentId = normalizeAgentId((loop.agent || 'claude').split(':')[0])
  const agentLabel = getAgentLabel(agentId)
  const agentColor = getAgentBrandColor(agentId)
  const hasTerminal = loop.session && agentTerminals.has(loop.session)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-md hover:bg-card-hover transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
        </button>

        <span
          className="w-6 h-6 rounded-md border flex items-center justify-center shrink-0"
          style={{ color: statusColor, background: `${statusColor}12`, borderColor: `${statusColor}30` }}
        >
          <TypeIcon size={13} />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground truncate">{meta.label}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full border font-medium capitalize"
              style={{ background: `${repoColor}10`, color: repoColor, borderColor: `${repoColor}30` }}
            >
              {loop.repo}
            </span>
            <span className="flex items-center gap-1 text-[10px]" style={{ color: agentColor }}>
              <AgentIcon agent={agentId} size={10} />
              {loop.agent || agentLabel}
            </span>
            {duration && (
              <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1 font-mono">
                <Clock size={9} />{duration}
              </span>
            )}
          </div>
        </div>

        <span
          className="text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize"
          style={{ color: statusColor, borderColor: `${statusColor}40`, background: `${statusColor}10` }}
        >
          {loop.status === 'in_progress' ? 'running' : loop.status}
        </span>
      </div>

      {/* Loop state info bar */}
      <div className="flex items-center gap-4 px-5 py-2 border-b border-border bg-card/50 text-[11px] text-muted-foreground shrink-0">
        {loop.loopState?.iteration > 0 && (
          <span>Iteration <strong className="text-foreground">{loop.loopState.iteration}</strong></span>
        )}
        {loop.loopState?.lastVerdict && (
          <span>Last verdict: <strong className="text-foreground">{loop.loopState.lastVerdict}</strong></span>
        )}
        {loop.started && (
          <span>Started: <strong className="text-foreground">{loop.started}</strong></span>
        )}
        {loop.loopState?.loopStatus && (
          <span>Exit: <strong className="text-foreground">{loop.loopState.loopStatus}</strong></span>
        )}
      </div>

      {/* Terminal or empty state */}
      <div className="flex-1 min-h-0">
        {hasTerminal ? (
          <TerminalPanel
            sessions={agentTerminals}
            activeSessionId={loop.session}
            isVisible={true}
            skipPermissions={true}
            onKillSession={onKillSession}
            onUpdateSessionId={onUpdateSessionId}
            onPromptSent={onPromptSent}
            onContextUsage={onContextUsage}
            onJobsChanged={onJobsChanged}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <TypeIcon size={28} className="mx-auto text-muted-foreground/20" />
              <p className="text-[12px] text-muted-foreground/50">
                {loop.status === 'in_progress'
                  ? 'Terminal session not found — it may still be initializing.'
                  : 'This loop has ended. No live terminal available.'}
              </p>
              {loop.loopState?.complete && (
                <p className="text-[11px] text-muted-foreground/40">
                  Final status: {loop.loopState.lastVerdict || loop.loopState.loopStatus || 'completed'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
