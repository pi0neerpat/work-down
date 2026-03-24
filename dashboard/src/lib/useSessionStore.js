import { useState, useCallback, useEffect, useMemo } from 'react'
import { usePolling } from './usePolling'

function shallowStableEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function makeSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session-${crypto.randomUUID()}`
  }
  return `session-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function makeLaunchToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export function useSessionStore() {
  const sessions = usePolling('/api/sessions', 5000)
  const [agentTerminals, setAgentTerminals] = useState(new Map())

  useEffect(() => {
    if (!sessions.data) return
    const serverSessions = sessions.data.sessions || []

    setAgentTerminals(prev => {
      let changed = false
      const next = new Map(prev)
      const live = new Set()

      for (const s of serverSessions) {
        live.add(s.id)
        const existing = next.get(s.id) || {}
        const fileName = s.jobId
          ? `${s.jobId}.md`
          : (s.jobFileName
            ? `${s.jobFileName}.md`
            : (s.swarmFileName ? `${s.swarmFileName}.md` : null))
        const nextInfo = {
          ...existing,
          taskText: s.label || existing.taskText || '',
          repoName: s.repo || existing.repoName || '',
          jobFile: fileName ? { ...(existing.jobFile || {}), fileName } : (existing.jobFile || null),
          created: s.created || existing.created || Date.now(),
          ptySessionId: s.id,
          alive: s.alive !== false,
          serverStarted: s.serverStarted === true,
          launchToken: existing.launchToken || null,
          promptSent: existing.promptSent ?? true,
        }
        if (!shallowStableEqual(existing, nextInfo)) {
          changed = true
          next.set(s.id, nextInfo)
        }
      }

      for (const [id, info] of next) {
        if (!info?.ptySessionId) continue
        if (live.has(info.ptySessionId)) continue
        changed = true
        next.set(id, { ...info, ptySessionId: null })
      }

      return changed ? next : prev
    })
  }, [sessions.data])

  const updateSessionId = useCallback((clientSessionId, ptySessionId) => {
    setAgentTerminals(prev => {
      const info = prev.get(clientSessionId)
      if (!info || info.ptySessionId === ptySessionId) return prev
      const next = new Map(prev)
      next.set(clientSessionId, { ...info, ptySessionId })
      return next
    })
  }, [])

  const markPromptSent = useCallback((clientSessionId) => {
    setAgentTerminals(prev => {
      const info = prev.get(clientSessionId)
      if (!info || info.promptSent) return prev
      const next = new Map(prev)
      next.set(clientSessionId, { ...info, promptSent: true })
      return next
    })
  }, [])

  const startTaskSession = useCallback(async (taskText, repoName, dispatchOpts = {}) => {
    const optimisticSessionId = makeSessionId()
    const launchToken = makeLaunchToken()
    let jobFile = null

    const res = await fetch('/api/jobs/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: repoName,
        taskText,
        originalTask: dispatchOpts.originalTask || undefined,
        sessionId: optimisticSessionId,
        model: dispatchOpts.model || undefined,
        maxTurns: dispatchOpts.maxTurns || undefined,
        autoMerge: dispatchOpts.autoMerge || undefined,
        baseBranch: dispatchOpts.baseBranch || undefined,
        skipPermissions: dispatchOpts.skipPermissions === true,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Dispatch init failed: ${res.status}`)
    }
    jobFile = await res.json()
    const sessionId = jobFile.sessionId || optimisticSessionId

    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.set(sessionId, {
        taskText,
        repoName,
        jobFile,
        created: Date.now(),
        ptySessionId: sessionId,
        alive: true,
        promptSent: jobFile.serverStarted === true,
        serverStarted: jobFile.serverStarted === true,
        launchToken,
        model: dispatchOpts.model || null,
        maxTurns: dispatchOpts.maxTurns || null,
      })
      return next
    })

    return sessionId
  }, [])

  const startWorkerSession = useCallback((repoName) => {
    const sessionId = makeSessionId()
    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.set(sessionId, { taskText: '', repoName, jobFile: null, created: Date.now(), alive: true, promptSent: false, launchToken: makeLaunchToken() })
      return next
    })
    return sessionId
  }, [])

  const resumeJobSession = useCallback(async (jobId) => {
    if (!jobId) return null
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Resume failed: ${res.status}`)
    }
    const data = await res.json()
    const sessionId = data.sessionId || makeSessionId()
    const launchToken = makeLaunchToken()

    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.set(sessionId, {
        taskText: data.taskText || '',
        repoName: data.repo || '',
        jobFile: data.jobFile || null,
        created: Date.now(),
        ptySessionId: sessionId,
        alive: true,
        promptSent: data.serverStarted === true ? true : true,
        serverStarted: data.serverStarted === true,
        launchToken,
        skipPermissions: data.skipPermissions === true,
        resumeCommand: data.resumeCommand || null,
        resumeId: data.resumeId || null,
      })
      return next
    })

    return sessionId
  }, [])

  const removeSession = useCallback((id) => {
    const info = agentTerminals.get(id)
    if (info?.ptySessionId) {
      fetch(`/api/sessions/${encodeURIComponent(info.ptySessionId)}/purge`, { method: 'DELETE' }).catch(() => {})
    }
    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [agentTerminals])

  const killSession = useCallback((id) => {
    const info = agentTerminals.get(id)
    if (info?.ptySessionId) {
      fetch(`/api/sessions/${encodeURIComponent(info.ptySessionId)}`, { method: 'DELETE' }).catch(() => {})
    }
    setAgentTerminals(prev => {
      const entry = prev.get(id)
      if (!entry) return prev
      const next = new Map(prev)
      next.set(id, { ...entry, ptySessionId: null })
      return next
    })
  }, [agentTerminals])

  const jobFileToSession = useMemo(() => {
    return sessions.data?.jobFileToSession || sessions.data?.swarmFileToSession || {}
  }, [sessions.data])

  const sessionRecordsForNav = useMemo(() => {
    const canonical = sessions.data?.sessions || []
    const known = new Set(canonical.map(s => s.id))
    const pendingLocal = []
    for (const [id, info] of agentTerminals) {
      if (known.has(id)) continue
      pendingLocal.push({
        id,
        repo: info.repoName || '',
        label: info.taskText || 'Manual worker',
        created: info.created || Date.now(),
        jobId: info.jobFile?.fileName?.replace(/\.md$/, '') || null,
        initJobId: null,
        jobIds: [],
        status: 'in_progress',
        validation: 'none',
      })
    }
    return [...canonical, ...pendingLocal]
  }, [sessions.data?.sessions, agentTerminals])

  return {
    sessions,
    agentTerminals,
    jobFileToSession,
    sessionRecordsForNav,
    updateSessionId,
    markPromptSent,
    startTaskSession,
    startWorkerSession,
    resumeJobSession,
    removeSession,
    killSession,
  }
}
