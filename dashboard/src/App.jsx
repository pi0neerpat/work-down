import { useState, useCallback, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { usePolling } from './lib/usePolling'
import { POLL_INTERVALS } from './lib/pollingIntervals'
import { useAppNavigation } from './lib/useAppNavigation'
import { useSessionStore } from './lib/useSessionStore'
import { useJobMetrics } from './lib/useJobMetrics'
import { useSettings } from './lib/useSettings'
import ActivityBar from './components/ActivityBar'
import StatusView from './components/StatusView'
import JobsView from './components/JobsView'
import JobDetailView from './components/JobDetailView'
import AllTasksView from './components/AllTasksView'
import DispatchView from './components/DispatchView'
import PlansView from './components/PlansView'
import SchedulesView from './components/SchedulesView'
import LoopsView from './components/LoopsView'
import SettingsView from './components/SettingsView'
import CommandPalette from './components/CommandPalette'
import Toast from './components/Toast'
import LoadingView from './components/LoadingView'

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
  const location = useLocation()
  if (location.pathname === '/loading') return <LoadingView />

  const overview = usePolling('/api/overview', POLL_INTERVALS.overview)
  const jobs = usePolling('/api/jobs', POLL_INTERVALS.jobs)
  const loops = usePolling('/api/loops', POLL_INTERVALS.jobs)
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

  const { settings, updateAgent } = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    loops.refresh()
    overview.refresh()
    sessions.refresh()
  }, [jobs.refresh, loops.refresh, overview.refresh, sessions.refresh])

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
    const agent = dispatchOpts.agent || 'claude'
    const skipPermissions = settings.agents[agent]?.skipPermissions ?? true
    const sessionId = await startTaskSession(taskText, repoName, { ...dispatchOpts, skipPermissions })
    openJobDetail(sessionId)
    return sessionId
  }, [startTaskSession, openJobDetail, settings])

  const handleStartWorker = useCallback((repoName) => {
    const sessionId = startWorkerSession(repoName)
    openJobDetail(sessionId)
  }, [startWorkerSession, openJobDetail])

  const handleNavigateToDispatch = useCallback((repo, prompt, planSlug = null, dispatchOpts = {}) => {
    setDispatchPreFill({
      repo,
      prompt,
      planSlug,
      skills: Array.isArray(dispatchOpts.skills) ? dispatchOpts.skills : [],
    })
    openDispatch()
  }, [openDispatch])

  const handleDispatchComplete = useCallback(() => {
    setDispatchPreFill(null)
    showToast('Worker dispatched', 'success')
  }, [showToast])

  const handleDispatch = useCallback(async ({ repo, taskText, originalTask, baseBranch, model, maxTurns, autoMerge, useWorktree, plainOutput, agent, planSlug, skills }) => {
    const agentId = agent || 'claude'
    const skipPermissions = settings.agents[agentId]?.skipPermissions ?? true
    await startTaskSession(taskText, repo, { originalTask, baseBranch, model, maxTurns, autoMerge, useWorktree, plainOutput, skipPermissions, agent: agentId, planSlug, skills })
  }, [startTaskSession, settings])

  const handleResumeJob = useCallback(async (jobId) => {
    const sessionId = await resumeJobSession(jobId)
    if (!sessionId) return
    openJobDetail(sessionId)
    showToast('Job resumed', 'success')
  }, [resumeJobSession, openJobDetail, showToast])

  const handleSearchSelect = useCallback((item) => {
    if (!item) return
    if (item.kind === 'repo' || item.kind === 'task') {
      setActiveNav('tasks')
    } else if (item.kind === 'agent') {
      openJobDetail(item.targetId)
    }
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

  const loopCount = (loops.data?.jobs || []).filter(j => j.status === 'in_progress').length

  const jobDetailElement = (
    <div className="absolute inset-0 z-10">
      <JobDetailView
        jobId={drillDownJobId}
        onBack={closeJobDetail}
        agentTerminals={agentTerminals}
        jobFileToSession={jobFileToSession}
        swarm={jobs.data}
        skipPermissions={settings.agents.claude?.skipPermissions ?? true}
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
        settings={settings}
      />
    </div>
  )

  return (
    <div className="h-screen flex bg-background">
        <ActivityBar
          activeNav={activeNav}
          onNavChange={handleNavChange}
          jobCount={activeJobCount}
          reviewCount={reviewCount}
          loopCount={loopCount}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen(v => !v)}
        />

        <main className="flex-1 min-w-0 min-h-0 flex flex-col relative">
          {settingsOpen ? (
            <ScrollableView>
              <SettingsView settings={settings} onUpdateAgent={updateAgent} />
            </ScrollableView>
          ) : (
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
              <Route path="/loops" element={
                <ScrollableView>
                  <LoopsView
                    loops={loops.data}
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
              <Route path="/plans" element={
                <ScrollableView>
                  <PlansView
                    overview={overview.data}
                    swarm={jobs.data}
                    onNavigateToDispatch={handleNavigateToDispatch}
                    settings={settings}
                  />
                </ScrollableView>
              } />
              <Route path="/plans/:repoName/:planSlug" element={
                <ScrollableView>
                  <PlansView
                    overview={overview.data}
                    swarm={jobs.data}
                    onNavigateToDispatch={handleNavigateToDispatch}
                    settings={settings}
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
                    initialPlanSlug={dispatchPreFill?.planSlug || null}
                    initialSkills={dispatchPreFill?.skills || []}
                    onDispatchComplete={handleDispatchComplete}
                    settings={settings}
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
          )}
        </main>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        repos={overview.data?.repos || []}
        activeNav={activeNav}
        searchResults={[]}
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
