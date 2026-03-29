/**
 * Shared worker/agent list building utilities.
 * Used by JobsView, TaskBoard/RepoTaskSection, and other components.
 */

export function getRepoFlags(repoName, jobAgents, activeWorkers) {
  let hasRunning = false
  let hasReview = false
  let failedCount = 0

  for (const agent of jobAgents) {
    if (agent.repo !== repoName) continue
    if (agent.validation === 'needs_validation') hasReview = true
    if (agent.status === 'in_progress') hasRunning = true
    if (agent.status === 'failed' || agent.status === 'killed') failedCount += 1
  }

  if (activeWorkers) {
    if (activeWorkers instanceof Map) {
      for (const [, info] of activeWorkers) {
        if (info.repoName === repoName) hasRunning = true
      }
    } else {
      for (const session of activeWorkers) {
        if (session.repo === repoName && session.status === 'in_progress') hasRunning = true
      }
    }
  }

  return { hasRunning, hasReview, failedCount }
}

function buildSessionEntries(activeWorkers, sessionRecords) {
  if (Array.isArray(sessionRecords)) {
    return sessionRecords.map(s => ({
      sessionId: s.id,
      repo: s.repo || '',
      agent: s.agent || 'claude',
      label: s.label || 'Manual worker',
      created: s.created || Date.now(),
      jobId: s.jobId || s.swarmFileName || null,
      initJobId: s.initJobId || null,
      status: s.status || 'in_progress',
      validation: s.validation || 'none',
      alive: s.alive !== false,
      jobIds: Array.isArray(s.jobIds) ? s.jobIds : [],
    }))
  }

  if (activeWorkers instanceof Map) {
    return Array.from(activeWorkers.entries()).map(([sessionId, info]) => ({
      sessionId,
      repo: info.repoName || '',
      agent: info.agent || 'claude',
      label: info.taskText || 'Manual worker',
      created: info.created || Date.now(),
      jobId: info.jobFile?.fileName?.replace(/\.md$/, '') || null,
      initJobId: info.jobFile?.fileName?.replace(/\.md$/, '') || null,
      status: 'in_progress',
      validation: 'none',
      alive: true,
      jobIds: [],
    }))
  }

  return []
}

function buildWorkerItemsCore(jobAgents, activeWorkers, jobFileToSession, sessionRecords) {
  const items = []
  const seen = new Set()
  const sessionEntries = buildSessionEntries(activeWorkers, sessionRecords)
  const liveSessionIds = new Set(sessionEntries.filter(s => s.alive !== false).map(s => s.sessionId))
  const allAgents = jobAgents || []

  // Phase 1: session-owned entries.
  for (const session of sessionEntries) {
    const sessionId = session.sessionId
    seen.add(sessionId)
    if (session.initJobId) seen.add(session.initJobId)
    if (session.jobId) seen.add(session.jobId)
    for (const sid of session.jobIds || []) seen.add(sid)
    for (const agent of allAgents) {
      if (agent.session === sessionId) seen.add(agent.id)
    }

    items.push({
      key: `session:${sessionId}`,
      id: sessionId,
      isSession: true,
      repo: session.repo,
      agent: session.agent || 'claude',
      label: session.label,
      needsReview: session.validation === 'needs_validation',
      status: session.status,
      validation: session.validation,
      created: session.created,
      jobId: session.jobId || session.initJobId || null,
      alive: session.alive !== false,
    })
  }

  // Phase 2: orphaned swarm agents.
  for (const agent of allAgents) {
    if (seen.has(agent.id)) continue

    const isActive = agent.status === 'in_progress' || agent.validation === 'needs_validation'
    const sessionId = jobFileToSession?.[agent.id]
    const isLive = Boolean(sessionId && liveSessionIds.has(sessionId))

    items.push({
      key: `agent:${agent.id}`,
      id: sessionId || agent.id,
      isSession: !!sessionId,
      repo: agent.repo,
      agent: agent.agent || 'claude',
      label: agent.taskName || agent.id,
      needsReview: agent.validation === 'needs_validation',
      status: agent.status,
      validation: agent.validation,
      created: agent.started,
      durationMinutes: agent.durationMinutes,
      jobId: agent.id,
      alive: isLive,
      isActive,
    })
  }

  return { items, seen }
}

export function buildWorkerNavItems(jobAgents, activeWorkers, jobFileToSession, sessionRecords) {
  return buildWorkerItemsCore(jobAgents, activeWorkers, jobFileToSession, sessionRecords).items
}

/**
 * Extract active workers for a specific repo — used by RepoTaskSection.
 */
export function extractActiveWorkers(repoName, activeWorkers, jobAgents, jobFileToSession, sessionRecords) {
  const items = buildWorkerItemsCore(jobAgents, activeWorkers, jobFileToSession, sessionRecords).items
  return items
    .filter(w => w.repo === repoName)
    .filter(w => w.status === 'in_progress' || w.validation === 'needs_validation')
    .map(w => ({
      id: w.id,
      label: w.label,
      status: w.validation === 'needs_validation' ? 'needs_validation' : w.status,
      isSession: w.isSession,
      jobId: w.jobId,
    }))
}
