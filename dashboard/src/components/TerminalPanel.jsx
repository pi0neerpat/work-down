import { useRef, useCallback, useEffect, useState } from 'react'
import { TerminalSquare, RefreshCw, RotateCcw, X, Loader, Workflow } from 'lucide-react'
import { cn } from '../lib/utils'
import { useTerminal } from '../lib/useTerminal'

function parseProgressText(entry) {
  if (!entry) return ''
  return entry.replace(/^\[[^\]]+\]\s*/, '').trim()
}

function AgentHeader({ taskInfo }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  const swarmFileId = taskInfo?.swarmFile?.fileName?.replace(/\.md$/, '') || null

  useEffect(() => {
    if (!swarmFileId) {
      setDetail(null)
      return
    }

    let cancelled = false

    async function fetchDetail() {
      if (!cancelled && !detail) setLoading(true)
      try {
        const res = await fetch(`/api/swarm/${swarmFileId}`)
        if (!res.ok) throw new Error('failed')
        const data = await res.json()
        if (!cancelled) setDetail(data)
      } catch {
        if (!cancelled) setDetail(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDetail()
    const id = setInterval(fetchDetail, 6000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [swarmFileId]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = detail?.status || (taskInfo?.promptSent ? 'in_progress' : 'starting')
  const currentStep = detail?.progressEntries?.length
    ? parseProgressText(detail.progressEntries[detail.progressEntries.length - 1])
    : taskInfo?.promptSent
      ? 'Worker started'
      : 'Waiting for prompt'

  const statusLabel = status === 'in_progress'
    ? 'Running'
    : status === 'completed'
      ? 'Completed'
      : status === 'failed' || status === 'killed'
        ? 'Failed'
        : 'Starting'

  const statusClass = status === 'in_progress'
    ? 'text-status-active bg-status-active-bg border-status-active-border'
    : status === 'completed'
      ? 'text-status-complete bg-status-complete-bg border-status-complete-border'
      : status === 'failed' || status === 'killed'
        ? 'text-status-failed bg-status-failed-bg border-status-failed-border'
        : 'text-muted-foreground bg-card border-border'

  return (
    <div className="px-3 py-2.5 border-b border-border bg-card/60">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px]">
        <div className="min-w-0">
          <span className="text-muted-foreground/70">Worker:</span>{' '}
          <span className="text-foreground font-medium">{taskInfo?.repoName || 'Unknown repo'} Agent</span>
        </div>
        <div className="min-w-0 md:text-right">
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', statusClass)}>
            <Workflow size={11} />
            {statusLabel}
          </span>
        </div>
        <div className="col-span-1 md:col-span-2 min-w-0">
          <span className="text-muted-foreground/70">Task:</span>{' '}
          <span className="text-foreground/95">{taskInfo?.taskText || 'Manual worker session'}</span>
        </div>
        <div className="col-span-1 md:col-span-2 min-w-0">
          <span className="text-muted-foreground/70">Step:</span>{' '}
          <span className="text-foreground/80 truncate">{loading && !detail ? 'Loading progress...' : currentStep}</span>
        </div>
      </div>
    </div>
  )
}

function TerminalInstance({ sessionId, taskInfo, visible, skipPermissions, onKill, confirmKill, onUpdateSessionId, onPromptSent, onContextUsage }) {
  const sendCommandRef = useRef(null)
  const sendRawRef = useRef(null)
  const promptSentRef = useRef(taskInfo?.promptSent || false)

  const onConnected = useCallback(() => {
    if (promptSentRef.current) return
    setTimeout(() => {
      const flags = skipPermissions ? ' --dangerously-skip-permissions' : ''
      sendCommandRef.current?.('claude' + flags)
    }, 500)
  }, [skipPermissions])

  const onTerminalData = useCallback((data) => {
    const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
    const ctxMatch = stripped.match(/\$[\d.]+[^%]{0,20}(\d{1,3})%/)
    if (ctxMatch) {
      const pct = parseInt(ctxMatch[1])
      if (pct > 0 && pct <= 100) {
        let resetMinutes = null
        const resetMatch = stripped.match(/[Rr]esets?\s+in\s+(?:(\d+)\s*h(?:r|rs|ours?)?\s*)?(\d+)?\s*m(?:in|ins|inutes?)?/i)
        if (resetMatch) {
          const hours = parseInt(resetMatch[1]) || 0
          const mins = parseInt(resetMatch[2]) || 0
          resetMinutes = hours * 60 + mins
        } else {
          const hoursOnly = stripped.match(/[Rr]esets?\s+in\s+(\d+)\s*h(?:r|rs|ours?)?/i)
          if (hoursOnly) {
            resetMinutes = parseInt(hoursOnly[1]) * 60
          }
        }
        onContextUsage?.(sessionId, pct, resetMinutes)
      }
    }

    if (promptSentRef.current || !taskInfo?.taskText) return
    if (data.includes('\u276F') || data.includes('bypass permissions')) {
      promptSentRef.current = true
      onPromptSent?.(sessionId)
      let prompt = '/swarm ' + taskInfo.taskText
      if (taskInfo.swarmFile?.relativePath) {
        prompt += `\n\nWrite progress to: ${taskInfo.swarmFile.relativePath}`
      }
      setTimeout(() => {
        sendRawRef.current?.(prompt)
        setTimeout(() => {
          sendRawRef.current?.('\r')
        }, 200)
      }, 1000)
    }
  }, [taskInfo, sessionId, onPromptSent, onContextUsage])

  const handleSessionId = useCallback((id) => {
    onUpdateSessionId?.(sessionId, id)
  }, [sessionId, onUpdateSessionId])

  const { termRef, isConnected, isMouseTracking, sendCommand, sendRaw, reconnect } = useTerminal({
    onConnected,
    onIncomingData: onTerminalData,
    repo: taskInfo?.repoName,
    sessionId: taskInfo?.ptySessionId || null,
    onSessionId: handleSessionId,
    swarmFilePath: taskInfo?.swarmFile?.absolutePath || null,
  })

  useEffect(() => {
    sendCommandRef.current = sendCommand
    sendRawRef.current = sendRaw
  }, [sendCommand, sendRaw])

  const handleRestart = useCallback(() => {
    promptSentRef.current = false
    reconnect()
  }, [reconnect])

  const handleReconnect = useCallback(() => {
    reconnect({ reattach: true })
  }, [reconnect])

  return (
    <div className="flex flex-col h-full" style={{ display: visible ? 'flex' : 'none' }}>
      <AgentHeader taskInfo={taskInfo} />

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background/60 shrink-0">
        <TerminalSquare size={12} className="text-muted-foreground" />
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Terminal</span>
        <div className="flex-1" />
        <button
          onClick={handleRestart}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-muted-foreground/40 hover:text-primary hover:bg-primary-glow border border-transparent hover:border-primary/10 transition-all"
          title="Restart session"
        >
          <RotateCcw size={10} />
          Restart
        </button>
        {onKill && (
          <button
            onClick={onKill}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              confirmKill
                ? 'bg-status-failed-bg text-status-failed border border-status-failed-border'
                : 'text-muted-foreground/40 hover:text-status-failed hover:bg-status-failed-bg border border-transparent hover:border-status-failed-border'
            )}
            title="Kill this worker bee"
          >
            <X size={10} />
            {confirmKill ? 'Confirm?' : 'Kill'}
          </button>
        )}
        {isMouseTracking && (
          <span className="text-[10px] text-muted-foreground/40 italic">Shift+Scroll to browse buffer</span>
        )}
        <div className="flex items-center gap-1.5">
          <span className={cn('w-1.5 h-1.5 rounded-full', isConnected ? 'bg-status-active' : 'bg-status-failed')} />
          <span className="text-[10px] text-muted-foreground">{isConnected ? 'connected' : 'disconnected'}</span>
        </div>
        {!isConnected && (
          <button onClick={handleReconnect} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors">
            <RefreshCw size={10} />
            reconnect
          </button>
        )}
      </div>

      <div ref={termRef} className="flex-1 min-h-0" style={{ padding: '4px', overflow: 'hidden' }} />
    </div>
  )
}

export default function TerminalPanel({ sessions, activeSessionId, skipPermissions, onKillSession, onUpdateSessionId, onPromptSent, onContextUsage }) {
  const hasTerminal = activeSessionId && sessions.has(activeSessionId)
  const [confirmKill, setConfirmKill] = useState(null)

  useEffect(() => {
    setConfirmKill(null)
  }, [activeSessionId])

  function handleKill(id) {
    if (confirmKill === id) {
      onKillSession?.(id)
      setConfirmKill(null)
    } else {
      setConfirmKill(id)
      setTimeout(() => setConfirmKill(prev => prev === id ? null : prev), 3000)
    }
  }

  return (
    <div className="h-full relative">
      {[...sessions.entries()].map(([id, info]) => (
        <div key={id} className="absolute inset-0" style={{ display: hasTerminal && id === activeSessionId ? 'block' : 'none' }}>
          <TerminalInstance
            sessionId={id}
            taskInfo={info}
            visible={hasTerminal && id === activeSessionId}
            skipPermissions={skipPermissions}
            onKill={() => handleKill(id)}
            confirmKill={confirmKill === id}
            onUpdateSessionId={onUpdateSessionId}
            onPromptSent={onPromptSent}
            onContextUsage={onContextUsage}
          />
        </div>
      ))}

      {!hasTerminal && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <TerminalSquare size={24} className="mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground/60">No terminal for this worker.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">Start a worker from Repo Detail or run a task.</p>
          </div>
        </div>
      )}
      {hasTerminal && !activeSessionId && (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground/60 text-sm">
          <Loader size={16} className="animate-spin" />
        </div>
      )}
    </div>
  )
}
