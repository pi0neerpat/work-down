import { useState, useCallback, useEffect, useRef } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { usePolling } from './lib/usePolling'
import { useSearch } from './lib/useSearch'
import { useAppNavigation } from './lib/useAppNavigation'
import { useSessionStore } from './lib/useSessionStore'
import { useJobMetrics } from './lib/useJobMetrics'
import HeaderBar from './components/HeaderBar'
import ActivityBar from './components/ActivityBar'
import StatusView from './components/StatusView'
import JobsView from './components/JobsView'
import JobDetailView from './components/JobDetailView'
import AllTasksView from './components/AllTasksView'
import DispatchView from './components/DispatchView'
import SchedulesView from './components/SchedulesView'
import CommandPalette from './components/CommandPalette'
import Toast from './components/Toast'

function ScrollableView({ children }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
      <div className="max-w-[50rem] mx-auto w-full">
        {children}
      </div>
    </div>
  )
}

export default function App() {
  const overview = usePolling('/api/overview', 10000)
  const jobs = usePolling('/api/jobs', 5000)
  const {
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
  } = useSessionStore()
  const {
    activeNav,
    setActiveNav,
    drillDownJobId,
    setDrillDownJobId,
    commandPaletteOpen,
    setCommandPaletteOpen,
    handleNavChange,
    openJobDetail,
    openDispatch,
    closeJobDetail,
  } = useAppNavigation()

  const [searchQuery, setSearchQuery] = useState('')
  const [skipPermissions, setSkipPermissions] = useState(true)
  const [contextUsage, setContextUsage] = useState(null)
  const [contextResetInfo, setContextResetInfo] = useState(null)
  const [toast, setToast] = useState(null)
  const [dispatchPreFill, setDispatchPreFill] = useState(null)
  const lastJobsChangedRefreshRef = useRef(0)

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type })
  }, [])

  const handleContextUsage = useCallback((sessionId, pct, resetMinutes) => {
    setContextUsage(pct)
    if (resetMinutes != null) {
      setContextResetInfo({ resetsAt: Date.now() + resetMinutes * 60 * 1000 })
    }
  }, [])

  const handleJobsChanged = useCallback(() => {
    const now = Date.now()
    if (now - lastJobsChangedRefreshRef.current < 400) return
    lastJobsChangedRefreshRef.current = now
    jobs.refresh()
    overview.refresh()
    sessions.refresh()
  }, [jobs.refresh, overview.refresh, sessions.refresh])

  const lastRefresh = overview.lastRefresh || jobs.lastRefresh || sessions.lastRefresh
  const error = overview.error || jobs.error || sessions.error

  const activeTerminalSessionId = drillDownJobId && agentTerminals.has(drillDownJobId)
    ? drillDownJobId
    : drillDownJobId ? (jobFileToSession[drillDownJobId] || null) : null

  useEffect(() => {
    setContextUsage(null)
    setContextResetInfo(null)
  }, [activeTerminalSessionId])

  const handleStartTask = useCallback(async (taskText, repoName, dispatchOpts = {}) => {
    const sessionId = await startTaskSession(taskText, repoName, { ...dispatchOpts, skipPermissions })
    openJobDetail(sessionId)
    return sessionId
  }, [startTaskSession, openJobDetail, skipPermissions])

  const handleStartWorker = useCallback((repoName) => {
    const sessionId = startWorkerSession(repoName)
    openJobDetail(sessionId)
  }, [startWorkerSession, openJobDetail])

  const handleNavigateToDispatch = useCallback((repo, prompt) => {
    setDispatchPreFill({ repo, prompt })
    openDispatch()
  }, [openDispatch])

  const handleDispatchComplete = useCallback(() => {
    // Don't navigate here — handleStartTask already navigates to /jobs/:id.
    // In the old overlay model setActiveNav('tasks') was harmless because
    // drillDownJobId took priority, but with route-based navigation it would
    // race and navigate away from the job detail.
    setDispatchPreFill(null)
    showToast('Worker dispatched', 'success')
  }, [showToast])

  const handleDispatch = useCallback(async ({ repo, taskText, originalTask, baseBranch, model, maxTurns, autoMerge }) => {
    // Start the session but DON'T navigate away from dispatch page
    await startTaskSession(taskText, repo, { originalTask, baseBranch, model, maxTurns, autoMerge, skipPermissions })
  }, [startTaskSession, skipPermissions])

  const handleResumeJob = useCallback(async (jobId) => {
    const sessionId = await resumeJobSession(jobId)
    if (!sessionId) return
    openJobDetail(sessionId)
    showToast('Job resumed', 'success')
  }, [resumeJobSession, openJobDetail, showToast])

  const searchResults = useSearch(searchQuery, overview.data, jobs.data, agentTerminals)

  const handleSearchSelect = useCallback((item) => {
    if (!item) return
    if (item.kind === 'repo' || item.kind === 'task') {
      setActiveNav('tasks')
    } else if (item.kind === 'agent') {
      openJobDetail(item.targetId)
    }
    setSearchQuery('')
    setCommandPaletteOpen(false)
  }, [openJobDetail, setActiveNav, setCommandPaletteOpen])

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

  const { activeJobCount, reviewCount } = useJobMetrics({
    jobAgents: jobs.data?.agents || [],
    jobFileToSession,
    sessionRecordsForNav,
  })

  const jobDetailElement = (
    <div className="absolute inset-0 z-10">
      <JobDetailView
        jobId={drillDownJobId}
        onBack={closeJobDetail}
        agentTerminals={agentTerminals}
        jobFileToSession={jobFileToSession}
        swarm={jobs.data}
        skipPermissions={skipPermissions}
        onKillSession={killSession}
        onUpdateSessionId={updateSessionId}
        onPromptSent={markPromptSent}
        onContextUsage={handleContextUsage}
        onJobsChanged={handleJobsChanged}
        onJobsRefresh={jobs.refresh}
        onOverviewRefresh={overview.refresh}
        onStartTask={handleStartTask}
        onResumeJob={handleResumeJob}
        onRemoveSession={removeSession}
        showToast={showToast}
      />
    </div>
  )

  return (
    <div className="h-screen flex flex-col bg-background">
      <HeaderBar
        overview={overview.data}
        activeJobCount={activeJobCount}
        reviewCount={reviewCount}
        error={error}
        skipPermissions={skipPermissions}
        onToggleSkipPermissions={() => setSkipPermissions(v => !v)}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        onSelectSearchResult={handleSearchSelect}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      <div className="flex-1 min-h-0 flex">
        <ActivityBar
          activeNav={activeNav}
          onNavChange={handleNavChange}
          jobCount={activeJobCount}
          reviewCount={reviewCount}
        />

        <main className="flex-1 min-w-0 min-h-0 flex flex-col relative">
          <Routes>
            <Route path="/jobs/:jobId" element={jobDetailElement} />
            <Route path="/status" element={
              <ScrollableView>
                <StatusView
                  overview={overview.data}
                  swarm={jobs.data}
                  error={error}
                  lastRefresh={lastRefresh}
                />
              </ScrollableView>
            } />
            <Route path="/jobs" element={
              <ScrollableView>
                <JobsView
                  swarm={jobs.data}
                  jobFileToSession={jobFileToSession}
                  sessionRecords={sessionRecordsForNav}
                  overview={overview.data}
                  onSelectJob={openJobDetail}
                />
              </ScrollableView>
            } />
            <Route path="/tasks" element={
              <ScrollableView>
                <AllTasksView
                  overview={overview.data}
                  onOverviewRefresh={overview.refresh}
                  onNavigateToDispatch={handleNavigateToDispatch}
                  onSelectJob={openJobDetail}
                  swarm={jobs.data}
                  agentTerminals={agentTerminals}
                />
              </ScrollableView>
            } />
            <Route path="/dispatch" element={
              <ScrollableView>
                <DispatchView
                  overview={overview.data}
                  onDispatch={handleDispatch}
                  initialRepo={dispatchPreFill?.repo || null}
                  initialPrompt={dispatchPreFill?.prompt || null}
                  onDispatchComplete={handleDispatchComplete}
                />
              </ScrollableView>
            } />
            <Route path="/schedules" element={
              <ScrollableView>
                <SchedulesView
                  overview={overview.data}
                />
              </ScrollableView>
            } />
            <Route path="*" element={<Navigate to="/tasks" replace />} />
          </Routes>
        </main>
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        repos={overview.data?.repos || []}
        activeNav={activeNav}
        searchResults={searchResults}
        onSelectResult={handleSearchSelect}
        activeWorkers={agentTerminals}
        onStartWorker={handleStartWorker}
        onKillSession={killSession}
        onNavChange={handleNavChange}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}
