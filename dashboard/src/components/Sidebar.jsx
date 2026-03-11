import { useState } from 'react'
import { GitBranch, Loader, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { cn } from '../lib/utils'
import { statusConfig } from '../lib/statusConfig'
import { repoIdentityColors } from '../lib/constants'

const groupOrder = [
  { key: 'needs_validation', label: 'REVIEW', colorVar: '--status-review' },
  { key: 'in_progress', label: 'RUNNING', colorVar: '--status-active' },
  { key: 'completed', label: 'DONE', colorVar: '--status-complete' },
  { key: 'failed', label: 'FAILED', colorVar: '--status-failed' },
]

/**
 * Groups agents by repo, then by status within each repo.
 * Returns: { repoName: { statusKey: agent[] } }
 */
function groupAgentsByRepo(agents, activeWorkers) {
  const byRepo = {}

  // Helper to ensure repo + status bucket exists
  function ensureBucket(repoName, statusKey) {
    if (!byRepo[repoName]) {
      byRepo[repoName] = {}
      for (const g of groupOrder) byRepo[repoName][g.key] = []
    }
    if (!byRepo[repoName][statusKey]) byRepo[repoName][statusKey] = []
  }

  for (const agent of agents) {
    const repo = agent.repo || 'unknown'
    let statusKey
    if (agent.validation === 'needs_validation') {
      statusKey = 'needs_validation'
    } else if (agent.status === 'completed' && (!agent.validation || agent.validation === 'none')) {
      // Completed but not yet validated — keep visible in REVIEW, not hidden in DONE
      statusKey = 'needs_validation'
    } else if (agent.status === 'killed') {
      statusKey = 'failed'
    } else if (groupOrder.some(g => g.key === agent.status)) {
      statusKey = agent.status
    } else {
      statusKey = 'failed'
    }
    ensureBucket(repo, statusKey)
    byRepo[repo][statusKey].push(agent)
  }

  // Merge active workers not already in agents list
  if (activeWorkers) {
    const existingIds = new Set(agents.map(a => a.id))
    for (const [sessionId, info] of activeWorkers) {
      const swarmId = info.swarmFile?.fileName?.replace(/\.md$/, '')
      if (swarmId && existingIds.has(swarmId)) continue
      const repo = info.repoName || 'unknown'
      ensureBucket(repo, 'in_progress')
      byRepo[repo]['in_progress'].push({
        id: sessionId,
        taskName: info.taskText,
        repo: info.repoName,
        status: 'in_progress',
        _isActiveWorker: true,
        started: new Date(info.created).toISOString(),
      })
    }
  }

  // Sort agents within each status bucket by started date (newest first)
  for (const repo of Object.keys(byRepo)) {
    for (const key of Object.keys(byRepo[repo])) {
      byRepo[repo][key].sort((a, b) => {
        if (!a.started && !b.started) return 0
        if (!a.started) return 1
        if (!b.started) return -1
        return b.started.localeCompare(a.started)
      })
    }
  }

  return byRepo
}

export default function Sidebar({ overview, swarm, selection, onSelect, onOverviewRefresh, onSwarmRefresh, activeWorkers, swarmFileToSession, onStartWorker }) {
  const repos = overview?.repos || []
  const agents = swarm?.agents || []
  const [doneCollapsed, setDoneCollapsed] = useState({})

  const byRepo = groupAgentsByRepo(agents, activeWorkers)

  // Toggle DONE collapsed state per repo
  function toggleDoneCollapsed(repoName) {
    setDoneCollapsed(prev => ({ ...prev, [repoName]: !prev[repoName] }))
  }

  // Check if a repo has DONE collapsed (default: true = collapsed)
  function isDoneCollapsed(repoName) {
    return doneCollapsed[repoName] !== false
  }

  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-background overflow-y-auto">
      {/* Repos section */}
      <div className="px-3 pt-4 pb-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3 px-1">
          Repos
        </h3>
        <div className="space-y-2">
          {repos.map(repo => {
            const color = repoIdentityColors[repo.name] || 'var(--primary)'
            const isSelected = selection?.type === 'repo' && selection.id === repo.name
            const isDirty = repo.git.dirtyCount > 0

            // Get this repo's workers
            const repoWorkers = byRepo[repo.name] || {}
            const totalWorkers = Object.values(repoWorkers).reduce((s, arr) => s + arr.length, 0)
            const hasRunning = (repoWorkers['in_progress']?.length || 0) > 0
            const hasReview = (repoWorkers['needs_validation']?.length || 0) > 0

            return (
              <div key={repo.name}>
                {/* Repo button row */}
                <button
                  onClick={() => onSelect({ type: 'repo', id: repo.name })}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-all duration-150 group',
                    isSelected
                      ? 'bg-card'
                      : 'hover:bg-card/50'
                  )}
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium capitalize text-foreground">{repo.name}</span>
                      {/* Active worker indicator */}
                      {(hasRunning || hasReview) && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full" style={{ background: hasReview ? 'var(--status-review)' : 'var(--status-active)' }} />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: hasReview ? 'var(--status-review)' : 'var(--status-active)' }} />
                        </span>
                      )}
                    </div>
                    {/* Branch info -- visible on hover or when selected */}
                    <div className={cn(
                      'flex items-center gap-1.5 mt-0.5 transition-all',
                      isSelected ? 'opacity-70' : 'opacity-0 group-hover:opacity-50'
                    )}>
                      <GitBranch size={9} className="text-muted-foreground" />
                      <span className="text-[10px] font-mono text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                        {repo.git.branch}
                      </span>
                      {isDirty && (
                        <span className="text-[10px] font-medium text-status-dirty">
                          {repo.git.dirtyCount}~
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: `${color}12`,
                      color: color,
                    }}
                  >
                    {repo.tasks.openCount}
                  </span>
                </button>

                {/* Start worker button */}
                <button
                  onClick={() => onStartWorker?.(repo.name)}
                  className="ml-4 mt-1 mb-1 flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-muted-foreground/40 hover:text-status-active hover:bg-status-active-bg transition-all"
                >
                  <Plus size={10} />
                  <span>Start worker</span>
                </button>

                {/* Nested worker bees for this repo */}
                {totalWorkers > 0 && (
                  <div className="ml-4 mt-0.5 mb-1 space-y-1.5">
                    {groupOrder.map(group => {
                      const items = repoWorkers[group.key]
                      if (!items || items.length === 0) return null

                      const isDoneGroup = group.key === 'completed'
                      const isCollapsed = isDoneGroup && isDoneCollapsed(repo.name)

                      return (
                        <div key={group.key}>
                          {/* Status group header */}
                          <button
                            className={cn(
                              'flex items-center gap-1.5 mb-1 px-1 w-full text-left',
                              isDoneGroup && 'cursor-pointer hover:opacity-80'
                            )}
                            onClick={isDoneGroup ? () => toggleDoneCollapsed(repo.name) : undefined}
                          >
                            <div
                              className="w-1 h-1 rounded-full shrink-0"
                              style={{ background: `var(${group.colorVar})` }}
                            />
                            <span
                              className="text-[8px] font-semibold uppercase tracking-wider"
                              style={{ color: `var(${group.colorVar})` }}
                            >
                              {group.label}
                            </span>
                            <span
                              className="text-[8px] font-mono px-1 rounded"
                              style={{
                                fontFamily: 'var(--font-mono)',
                                color: `var(${group.colorVar})`,
                                background: `var(${group.colorVar})10`,
                              }}
                            >
                              {items.length}
                            </span>
                            {isDoneGroup && (
                              <span className="ml-auto text-muted-foreground/40">
                                {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                              </span>
                            )}
                          </button>

                          {/* Agent rows */}
                          {!isCollapsed && (
                            <div className="space-y-0.5">
                              {items.map(agent => {
                                const isActiveWorker = agent._isActiveWorker
                                const needsReview = agent.status === 'completed' && (!agent.validation || agent.validation === 'none')
                                const agentSt = isActiveWorker
                                  ? { icon: Loader, color: 'text-status-active' }
                                  : needsReview
                                    ? (statusConfig.needs_validation || statusConfig.unknown)
                                    : (statusConfig[agent.status] || statusConfig.unknown)
                                const AgentIcon = agentSt.icon
                                // Match selection by agent ID or by resolved session ID (selection may be session-* or swarm-file-slug)
                                const isSelected = selection?.type === 'swarm' && (
                                  selection.id === agent.id ||
                                  swarmFileToSession?.[agent.id] === selection.id
                                )

                                return (
                                  <button
                                    key={agent.id}
                                    onClick={() => onSelect({ type: 'swarm', id: agent.id })}
                                    className={cn(
                                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all duration-150',
                                      isSelected
                                        ? 'bg-card'
                                        : 'hover:bg-card/50'
                                    )}
                                  >
                                    <AgentIcon
                                      size={11}
                                      className={cn(
                                        agentSt.color,
                                        (agent.status === 'in_progress' || isActiveWorker) && 'animate-spin-slow',
                                        'shrink-0'
                                      )}
                                    />
                                    <span className="flex-1 min-w-0 text-[11px] text-foreground/70 truncate">
                                      {agent.taskName || agent.id}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
