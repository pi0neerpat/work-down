import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ListTodo, TerminalSquare, ClipboardCheck } from 'lucide-react'
import { usePolling } from './lib/usePolling'
import HeaderBar from './components/HeaderBar'
import Sidebar from './components/Sidebar'
import CenterTabs from './components/CenterTabs'
import TerminalPanel from './components/TerminalPanel'
import ResultsPanel from './components/ResultsPanel'
import TaskBoard from './components/TaskBoard'
import RightPanel from './components/RightPanel'

const REPO_TABS = [{ id: 'tasks', label: 'Tasks', icon: ListTodo }]
const SWARM_TABS = [
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
]

export default function App() {
  const overview = usePolling('/api/overview', 10000)
  const swarm = usePolling('/api/swarm', 5000)
  const [selection, setSelection] = useState(null)
  const [activeTab, setActiveTab] = useState('tasks')
  const [agentTerminals, setAgentTerminals] = useState(() => {
    // Restore sessions from localStorage
    try {
      const saved = localStorage.getItem('hub:agentTerminals')
      if (saved) {
        const entries = JSON.parse(saved)
        return new Map(entries)
      }
    } catch {}
    return new Map()
  })
  // Persist sessions to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('hub:agentTerminals', JSON.stringify([...agentTerminals.entries()]))
    } catch {}
  }, [agentTerminals])

  // On mount, verify saved sessions still have live PTYs on the server
  useEffect(() => {
    if (agentTerminals.size === 0) return
    fetch('/api/sessions')
      .then(r => r.json())
      .then(({ sessions }) => {
        const liveIds = new Set(sessions.map(s => s.id))
        setAgentTerminals(prev => {
          let changed = false
          const next = new Map(prev)
          for (const [id, info] of next) {
            if (info.ptySessionId && !liveIds.has(info.ptySessionId)) {
              next.delete(id)
              changed = true
            }
          }
          return changed ? next : prev
        })
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Callback for when the server assigns a PTY session ID
  const handleUpdateSessionId = useCallback((clientSessionId, ptySessionId) => {
    setAgentTerminals(prev => {
      const info = prev.get(clientSessionId)
      if (!info || info.ptySessionId === ptySessionId) return prev
      const next = new Map(prev)
      next.set(clientSessionId, { ...info, ptySessionId })
      return next
    })
  }, [])

  // Callback for when the /swarm prompt has been sent — persist to prevent re-entry
  const handlePromptSent = useCallback((clientSessionId) => {
    setAgentTerminals(prev => {
      const info = prev.get(clientSessionId)
      if (!info || info.promptSent) return prev
      const next = new Map(prev)
      next.set(clientSessionId, { ...info, promptSent: true })
      return next
    })
  }, [])

  const [skipPermissions, setSkipPermissions] = useState(true)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [contextUsage, setContextUsage] = useState(null)
  const [contextResetInfo, setContextResetInfo] = useState(null)

  // Context usage tracking for active Claude Code session
  const handleContextUsage = useCallback((sessionId, pct, resetMinutes) => {
    setContextUsage(pct)
    if (resetMinutes != null) {
      // Store the absolute time when the session resets, so countdown is accurate
      setContextResetInfo({ resetsAt: Date.now() + resetMinutes * 60 * 1000 })
    }
  }, [])

  // Reset context usage when switching sessions
  useEffect(() => {
    setContextUsage(null)
    setContextResetInfo(null)
  }, [selection?.id])

  // Track previous selection type to reset tab when it changes
  const prevSelectionType = useRef(null)

  const selectionType = selection?.type || null

  // Compute tabs based on selection type
  const tabs = selectionType === 'swarm' ? SWARM_TABS : REPO_TABS

  // Reset activeTab when selection type changes
  useEffect(() => {
    if (prevSelectionType.current !== selectionType) {
      prevSelectionType.current = selectionType
      setActiveTab(tabs[0].id)
    }
  }, [selectionType, tabs])

  // Auto-select first repo when data loads and nothing is selected
  useEffect(() => {
    if (!selection && overview.data?.repos?.length > 0) {
      setSelection({ type: 'repo', id: overview.data.repos[0].name })
    }
  }, [overview.data, selection])

  const lastRefresh = overview.lastRefresh || swarm.lastRefresh
  const error = overview.error || swarm.error

  // Reverse lookup: swarm file slug → session ID (for resolving sidebar clicks)
  const swarmFileToSession = useMemo(() => {
    const map = {}
    for (const [sessionId, info] of agentTerminals) {
      const slug = info.swarmFile?.fileName?.replace(/\.md$/, '')
      if (slug) map[slug] = sessionId
    }
    return map
  }, [agentTerminals])

  // Selection handler — auto-switch to review tab for needs_validation agents
  const handleSelect = useCallback((sel) => {
    setSelection(sel)
    if (sel?.type === 'swarm') {
      const agent = swarm.data?.agents?.find(a => a.id === sel.id)
      if (agent?.validation === 'needs_validation') {
        setActiveTab('review')
      }
    }
  }, [swarm.data])

  // Start task handler — init swarm file, create terminal session, switch to it
  async function handleStartTask(taskText, repoName) {
    const sessionId = 'session-' + Date.now()
    let swarmFile = null

    try {
      const res = await fetch('/api/swarm/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoName, taskText, sessionId }),
      })
      if (res.ok) {
        swarmFile = await res.json()
      }
    } catch { /* proceed without swarm file */ }

    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.set(sessionId, { taskText, repoName, swarmFile, created: Date.now() })
      return next
    })
    setSelection({ type: 'swarm', id: sessionId })
    setActiveTab('terminal')
  }

  // Start a blank worker in a repo — launches Claude Code and lets user type
  function handleStartWorker(repoName) {
    const sessionId = 'session-' + Date.now()
    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.set(sessionId, { taskText: '', repoName, swarmFile: null, created: Date.now() })
      return next
    })
    setSelection({ type: 'swarm', id: sessionId })
    setActiveTab('terminal')
  }

  // Resolve terminal session ID: selection.id may be a session key or a swarm file slug
  const activeTerminalSessionId = selection?.type === 'swarm'
    ? (agentTerminals.has(selection.id) ? selection.id : swarmFileToSession[selection.id] || null)
    : null

  // Derive swarm file ID from agentTerminals for the selected session
  // e.g. "2026-03-11-some-task" from swarmFile.fileName "2026-03-11-some-task.md"
  const swarmFileId = activeTerminalSessionId
    ? agentTerminals.get(activeTerminalSessionId)?.swarmFile?.fileName?.replace(/\.md$/, '') || null
    : null

  // Use swarmFileId for API calls (progress, review), fall back to selection.id for sidebar agents
  const reviewAgentId = swarmFileId || (selection?.type === 'swarm' ? selection.id : null)

  // Build contentMap based on selection type
  const contentMap = useMemo(() => {
    if (selectionType === 'swarm') {
      return {
        terminal: (
          <TerminalPanel
            sessions={agentTerminals}
            activeSessionId={activeTerminalSessionId}
            skipPermissions={skipPermissions}
            onKillSession={(id) => {
              const info = agentTerminals.get(id)
              if (info?.ptySessionId) {
                fetch(`/api/sessions/${encodeURIComponent(info.ptySessionId)}`, { method: 'DELETE' }).catch(() => {})
              }
              setAgentTerminals(prev => {
                const next = new Map(prev)
                next.delete(id)
                return next
              })
            }}
            onUpdateSessionId={handleUpdateSessionId}
            onPromptSent={handlePromptSent}
            onContextUsage={handleContextUsage}
          />
        ),
        review: (
          <ResultsPanel
            agentId={reviewAgentId}
            onSwarmRefresh={swarm.refresh}
            onOverviewRefresh={overview.refresh}
          />
        ),
      }
    }
    // repo or null → tasks
    return {
      tasks: (
        <TaskBoard
          overview={overview.data}
          onOverviewRefresh={overview.refresh}
          selectedRepo={selection?.type === 'repo' ? selection.id : null}
          onStartTask={handleStartTask}
          activeWorkers={agentTerminals}
          onOpenBee={(sessionId) => {
            setSelection({ type: 'swarm', id: sessionId })
            setActiveTab('terminal')
          }}
        />
      ),
    }
  }, [selectionType, selection?.id, activeTerminalSessionId, agentTerminals, reviewAgentId, swarm.refresh, overview.refresh, overview.data, skipPermissions, handleUpdateSessionId, handlePromptSent, handleContextUsage])

  return (
    <div className="h-screen flex flex-col bg-background">
      <HeaderBar
        overview={overview.data}
        swarm={swarm.data}
        lastRefresh={lastRefresh}
        error={error}
        skipPermissions={skipPermissions}
        onToggleSkipPermissions={() => setSkipPermissions(p => !p)}
        contextUsage={contextUsage}
        contextResetInfo={contextResetInfo}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          overview={overview.data}
          swarm={swarm.data}
          selection={selection}
          onSelect={handleSelect}
          onOverviewRefresh={overview.refresh}
          onSwarmRefresh={swarm.refresh}
          activeWorkers={agentTerminals}
          swarmFileToSession={swarmFileToSession}
          onStartWorker={handleStartWorker}
        />

        {/* Center panel with tabs */}
        <CenterTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          contentMap={contentMap}
        />

        <RightPanel
          selection={selection}
          overview={overview.data}
          swarm={swarm.data}
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => setRightPanelCollapsed(p => !p)}
          swarmFileId={swarmFileId}
        />
      </div>

      {/* Initial loading overlay */}
      {overview.loading && !overview.data && (
        <div className="fixed inset-0 flex items-center justify-center bg-background/80 z-50">
          <div className="inline-flex items-center gap-3 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm">Connecting to hub...</span>
          </div>
        </div>
      )}
    </div>
  )
}
