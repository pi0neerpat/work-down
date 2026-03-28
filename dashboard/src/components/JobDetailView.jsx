import { useState, useMemo, useEffect } from 'react'
import { ArrowLeft, TerminalSquare, ClipboardCheck } from 'lucide-react'
import { cn } from '../lib/utils'
import { repoIdentityColors } from '../lib/constants'
import TerminalPanel from './TerminalPanel'
import ResultsPanel from './ResultsPanel'

export default function JobDetailView({
  jobId,
  onBack,
  agentTerminals,
  jobFileToSession,
  swarm,
  skipPermissions,
  onKillSession,
  onUpdateSessionId,
  onPromptSent,
  onContextUsage,
  onJobsChanged,
  onJobsRefresh,
  onOverviewRefresh,
  onStartTask,
  onResumeJob,
  onRemoveSession,
  showToast,
}) {
  const [view, setView] = useState('review')

  const hasTerminal = agentTerminals.has(jobId)
  const taskInfo = hasTerminal ? agentTerminals.get(jobId) : null
  const activePlainOutput = taskInfo?.plainOutput ?? false

  // Auto-select the appropriate tab when the job changes or when a terminal
  // first becomes available (handles page-refresh reconstruction delay)
  useEffect(() => {
    if (!jobId) return
    if (taskInfo && taskInfo.ptySessionId) {
      setView(activePlainOutput ? 'review' : 'terminal')
    } else if (!hasTerminal) {
      setView('review')
    }
  }, [jobId, hasTerminal, activePlainOutput]) // eslint-disable-line react-hooks/exhaustive-deps
  const repoName = taskInfo?.repoName || ''
  const repoColor = repoIdentityColors[repoName] || 'var(--primary)'

  const swarmFileId = taskInfo?.jobFile?.fileName?.replace(/\.md$/, '') || null
  const reviewAgentId = swarmFileId || (hasTerminal ? null : jobId)

  const jobLabel = taskInfo?.taskText || 'Worker session'

  const activeTerminalSessionId = hasTerminal ? jobId : (jobFileToSession?.[jobId] || null)
  const activeTerminalInfo = activeTerminalSessionId ? agentTerminals.get(activeTerminalSessionId) : null
  const hasLiveTerminal = Boolean(activeTerminalInfo && activeTerminalInfo.alive !== false)

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="px-6 py-2.5 border-b border-border bg-background/60 shrink-0 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="h-4 w-px bg-border" />

        <div className="flex-1 min-w-0 flex items-center gap-2">
          <p className="text-[13px] font-medium text-foreground truncate">{jobLabel}</p>
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded capitalize shrink-0"
            style={{ background: `${repoColor}15`, color: repoColor, border: `1px solid ${repoColor}30` }}
          >
            {repoName}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setView('terminal')}
            style={view === 'terminal' ? { color: '#8bab8f' } : undefined}
            className={cn(
              'text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5',
              view === 'terminal'
                ? 'bg-primary/[0.14] border-primary/20'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <TerminalSquare size={12} strokeWidth={view === 'terminal' ? 2.2 : 1.8} /> Terminal
          </button>
          <button
            onClick={() => setView('review')}
            style={view === 'review' ? { color: '#8bab8f' } : undefined}
            className={cn(
              'text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5',
              view === 'review'
                ? 'bg-primary/[0.14] border-primary/20'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <ClipboardCheck size={12} strokeWidth={view === 'review' ? 2.2 : 1.8} /> Review
          </button>
        </div>
      </div>

      {/* Content area — terminal always mounted (hidden/shown), review conditionally rendered */}
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0" style={{ display: view === 'terminal' ? 'block' : 'none' }}>
          <TerminalPanel
            sessions={agentTerminals}
            activeSessionId={activeTerminalSessionId}
            isVisible={view === 'terminal'}
            skipPermissions={skipPermissions}
            onKillSession={onKillSession}
            onUpdateSessionId={onUpdateSessionId}
            onPromptSent={onPromptSent}
            onContextUsage={onContextUsage}
            onJobsChanged={onJobsChanged}
          />
        </div>

        <div className="absolute inset-0 overflow-y-auto px-6 py-5" style={{ display: view === 'review' ? 'block' : 'none' }}>
          <div className="max-w-[50rem] mx-auto w-full">
            <ResultsPanel
              agentId={reviewAgentId}
              hasLiveTerminal={hasLiveTerminal}
              onJobsRefresh={onJobsRefresh}
              onOverviewRefresh={onOverviewRefresh}
              onStartTask={onStartTask}
              onResumeJob={onResumeJob}
              onBack={onBack}
              onRemoveSession={() => onRemoveSession?.(jobId)}
              showToast={showToast}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
