import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ListTodo, TerminalSquare, ClipboardCheck } from 'lucide-react'
import { usePolling } from './lib/usePolling'
import { useSearch } from './lib/useSearch'
import HeaderBar from './components/HeaderBar'
import Sidebar from './components/Sidebar'
import CenterTabs from './components/CenterTabs'
import TerminalPanel from './components/TerminalPanel'
import ResultsPanel from './components/ResultsPanel'
import TaskBoard from './components/TaskBoard'
import RightPanel from './components/RightPanel'
import CommandPalette from './components/CommandPalette'

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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [agentTerminals, setAgentTerminals] = useState(() => {
    try {
      const saved = localStorage.getItem('hub:agentTerminals')
      if (saved) {
        const entries = JSON.parse(saved)
        return new Map(entries)
      }
    } catch {}
    return new Map()
  })

  useEffect(() => {
    try {
      localStorage.setItem('hub:agentTerminals', JSON.stringify([...agentTerminals.entries()]))
    } catch {}
  }, [agentTerminals])

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

  const handleUpdateSessionId = useCallback((clientSessionId, ptySessionId) => {
    setAgentTerminals(prev => {
      const info = prev.get(clientSessionId)
      if (!info || info.ptySessionId === ptySessionId) return prev
      const next = new Map(prev)
      next.set(clientSessionId, { ...info, ptySessionId })
      return next
    })
  }, [])

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

  const handleContextUsage = useCallback((sessionId, pct, resetMinutes) => {
    setContextUsage(pct)
    if (resetMinutes != null) {
      setContextResetInfo({ resetsAt: Date.now() + resetMinutes * 60 * 1000 })
    }
  }, [])

  useEffect(() => {
    setContextUsage(null)
    setContextResetInfo(null)
  }, [selection?.id])

  const prevSelectionType = useRef(null)
  const selectionType = selection?.type || null
  const tabs = selectionType === 'swarm' ? SWARM_TABS : REPO_TABS

  useEffect(() => {
    if (prevSelectionType.current !== selectionType) {
      prevSelectionType.current = selectionType
      setActiveTab(tabs[0].id)
    }
  }, [selectionType, tabs])

  useEffect(() => {
    if (!selection && overview.data?.repos?.length > 0) {
      setSelection({ type: 'repo', id: overview.data.repos[0].name })
    }
  }, [overview.data, selection])

  const lastRefresh = overview.lastRefresh || swarm.lastRefresh
  const error = overview.error || swarm.error

  const swarmFileToSession = useMemo(() => {
    const map = {}
    for (const [sessionId, info] of agentTerminals) {
      const slug = info.swarmFile?.fileName?.replace(/\.md$/, '')
      if (slug) map[slug] = sessionId
    }
    return map
  }, [agentTerminals])

  const handleSelect = useCallback((sel) => {
    setSelection(sel)
    if (sel?.type === 'swarm') {
      const agent = swarm.data?.agents?.find(a => a.id === sel.id)
      if (agent?.validation === 'needs_validation') {
        setActiveTab('review')
      }
    }
  }, [swarm.data])

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

  const handleKillSession = useCallback((id) => {
    const info = agentTerminals.get(id)
    if (info?.ptySessionId) {
      fetch(`/api/sessions/${encodeURIComponent(info.ptySessionId)}`, { method: 'DELETE' }).catch(() => {})
    }
    setAgentTerminals(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })

    if (selection?.type === 'swarm' && selection.id === id) {
      const fallbackRepo = info?.repoName || overview.data?.repos?.[0]?.name
      if (fallbackRepo) setSelection({ type: 'repo', id: fallbackRepo })
    }
  }, [agentTerminals, selection, overview.data])

  const activeTerminalSessionId = selection?.type === 'swarm'
    ? (agentTerminals.has(selection.id) ? selection.id : swarmFileToSession[selection.id] || null)
    : null

  const swarmFileId = activeTerminalSessionId
    ? agentTerminals.get(activeTerminalSessionId)?.swarmFile?.fileName?.replace(/\.md$/, '') || null
    : null

  const reviewAgentId = swarmFileId || (selection?.type === 'swarm' ? selection.id : null)

  const searchResults = useSearch(searchQuery, overview.data, swarm.data, agentTerminals)

  const handleSearchSelect = useCallback((item) => {
    if (!item) return
    if (item.kind === 'repo' || item.kind === 'task') {
      setSelection({ type: 'repo', id: item.targetId || item.repo })
      setActiveTab('tasks')
    } else if (item.kind === 'agent') {
      setSelection({ type: 'swarm', id: item.targetId })
      setActiveTab('terminal')
    }
    setSearchQuery('')
    setCommandPaletteOpen(false)
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(prev => !prev)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const contentMap = useMemo(() => {
    if (selectionType === 'swarm') {
      return {
        terminal: (
          <TerminalPanel
            sessions={agentTerminals}
            activeSessionId={activeTerminalSessionId}
            skipPermissions={skipPermissions}
            onKillSession={handleKillSession}
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

    return {
      tasks: (
        <TaskBoard
          overview={overview.data}
          onOverviewRefresh={overview.refresh}
          selectedRepo={selection?.type === 'repo' ? selection.id : null}
          onStartTask={handleStartTask}
          onStartWorker={handleStartWorker}
          activeWorkers={agentTerminals}
          swarmAgents={swarm.data?.agents || []}
          swarmFileToSession={swarmFileToSession}
          onSelectWorker={(id) => {
            setSelection({ type: 'swarm', id })
            setActiveTab('terminal')
          }}
        />
      ),
    }
  }, [selectionType, selection?.id, activeTerminalSessionId, agentTerminals, reviewAgentId, swarm.refresh, swarm.data, overview.refresh, overview.data, skipPermissions, handleUpdateSessionId, handlePromptSent, handleContextUsage, handleKillSession, swarmFileToSession])

  return (
    <div className="h-screen flex flex-col bg-background">
      <HeaderBar
        overview={overview.data}
        swarm={swarm.data}
        lastRefresh={lastRefresh}
        error={error}
        skipPermissions={skipPermissions}
        onToggleSkipPermissions={() => setSkipPermissions(v => !v)}
        contextUsage={contextUsage}
        contextResetInfo={contextResetInfo}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={handleSearchSelect}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      <div className="flex-1 min-h-0 flex">
        <Sidebar
          overview={overview.data}
          swarm={swarm.data}
          selection={selection}
          onSelect={handleSelect}
          activeWorkers={agentTerminals}
        />

        <CenterTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          contentMap={contentMap}
        />

        <RightPanel
          selection={selection}
          swarm={swarm.data}
          collapsed={rightPanelCollapsed}
          onToggleCollapse={() => setRightPanelCollapsed(v => !v)}
          swarmFileId={swarmFileId}
        />
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        repos={overview.data?.repos || []}
        selectedRepo={selection?.type === 'repo' ? selection.id : null}
        searchResults={searchResults}
        onSelectResult={handleSearchSelect}
        activeWorkers={agentTerminals}
        onStartWorker={handleStartWorker}
        onKillSession={handleKillSession}
      />
    </div>
  )
}
