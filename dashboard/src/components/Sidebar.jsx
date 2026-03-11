import { cn } from '../lib/utils'
import { repoIdentityColors } from '../lib/constants'

function getRepoFlags(repoName, swarmAgents, activeWorkers) {
  let hasRunning = false
  let hasReview = false
  let failedCount = 0

  for (const agent of swarmAgents) {
    if (agent.repo !== repoName) continue
    if (agent.validation === 'needs_validation') hasReview = true
    if (agent.status === 'in_progress') hasRunning = true
    if (agent.status === 'failed' || agent.status === 'killed') failedCount += 1
  }

  if (activeWorkers) {
    for (const [, info] of activeWorkers) {
      if (info.repoName === repoName) hasRunning = true
    }
  }

  return { hasRunning, hasReview, failedCount }
}

export default function Sidebar({ overview, swarm, selection, onSelect, activeWorkers }) {
  const repos = overview?.repos || []
  const agents = swarm?.agents || []

  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-background overflow-y-auto">
      <div className="px-3 pt-4 pb-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3 px-1">
          Repos
        </h3>
        <div className="space-y-1.5">
          {repos.map(repo => {
            const color = repoIdentityColors[repo.name] || 'var(--primary)'
            const isSelected = selection?.type === 'repo' && selection.id === repo.name
            const { hasRunning, hasReview, failedCount } = getRepoFlags(repo.name, agents, activeWorkers)

            return (
              <button
                key={repo.name}
                onClick={() => onSelect({ type: 'repo', id: repo.name })}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-all duration-150 border',
                  isSelected
                    ? 'bg-card border-card-border-hover'
                    : 'border-transparent hover:bg-card/50'
                )}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="flex-1 min-w-0 text-[13px] font-medium capitalize text-foreground truncate">
                  {repo.name}
                </span>

                <div className="flex items-center gap-1.5 shrink-0">
                  {hasReview && <span className="w-1.5 h-1.5 rounded-full bg-status-review" title="Needs review" />}
                  {!hasReview && hasRunning && <span className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse-soft" title="Running" />}
                  {failedCount > 0 && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-status-failed-bg text-status-failed"
                      style={{ fontFamily: 'var(--font-mono)' }}
                      title="Failed workers"
                    >
                      !{failedCount}
                    </span>
                  )}
                  <span
                    className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: `${color}12`,
                      color,
                    }}
                  >
                    {repo.tasks.openCount}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
