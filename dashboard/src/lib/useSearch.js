import { useMemo } from 'react'

function safeIncludes(haystack, needle) {
  return (haystack || '').toLowerCase().includes(needle)
}

export function useSearch(query, overview, swarm, activeWorkers) {
  return useMemo(() => {
    const q = (query || '').trim().toLowerCase()
    if (!q) return []

    const results = []
    const repos = overview?.repos || []
    const agents = swarm?.agents || []

    for (const repo of repos) {
      if (safeIncludes(repo.name, q)) {
        results.push({
          key: `repo:${repo.name}`,
          kind: 'repo',
          label: repo.name,
          subtitle: `${repo.tasks.openCount} open tasks`,
          repo: repo.name,
          targetId: repo.name,
        })
      }

      for (const section of repo.tasks.sections || []) {
        for (const task of section.tasks || []) {
          if (task.done) continue
          if (!safeIncludes(task.text, q)) continue
          const title = task.text.split('\n').find(Boolean)?.trim() || task.text
          results.push({
            key: `task:${repo.name}:${title}`,
            kind: 'task',
            label: title,
            subtitle: `Task in ${repo.name}`,
            repo: repo.name,
            taskText: task.text,
            targetId: repo.name,
          })
        }
      }
    }

    for (const agent of agents) {
      const label = agent.taskName || agent.id
      if (!safeIncludes(label, q) && !safeIncludes(agent.id, q) && !safeIncludes(agent.repo, q)) continue
      results.push({
        key: `agent:${agent.id}`,
        kind: 'agent',
        label,
        subtitle: `Worker in ${agent.repo}`,
        repo: agent.repo,
        targetId: agent.id,
      })
    }

    if (activeWorkers) {
      for (const [sessionId, info] of activeWorkers.entries()) {
        const label = info.taskText || 'Manual worker'
        if (!safeIncludes(label, q) && !safeIncludes(info.repoName, q) && !safeIncludes(sessionId, q)) continue
        results.push({
          key: `session:${sessionId}`,
          kind: 'agent',
          label,
          subtitle: `Live terminal in ${info.repoName}`,
          repo: info.repoName,
          targetId: sessionId,
        })
      }
    }

    return results.slice(0, 24)
  }, [query, overview, swarm, activeWorkers])
}
