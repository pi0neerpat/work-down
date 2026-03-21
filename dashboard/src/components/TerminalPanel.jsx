import { useRef, useCallback, useEffect, useState } from 'react'
import {
  TerminalSquare,
  RefreshCw,
  RotateCcw,
  X,
  Loader,
  Workflow,
  Search,
  Send,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useTerminal } from '../lib/useTerminal'

function parseProgressText(entry) {
  if (!entry) return ''
  return entry.replace(/^\[[^\]]+\]\s*/, '').trim()
}


function AgentHeader({ taskInfo }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)

  const jobFileId = taskInfo?.jobFile?.fileName?.replace(/\.md$/, '') || null

  useEffect(() => {
    if (!jobFileId) {
      setDetail(null)
      return
    }

    let cancelled = false
    let firstRun = true

    async function fetchDetail() {
      if (!cancelled && firstRun) setLoading(true)
      try {
        const res = await fetch(`/api/jobs/${jobFileId}`)
        if (!res.ok) throw new Error('failed')
        const data = await res.json()
        if (!cancelled) setDetail(data)
      } catch {
        if (!cancelled) setDetail(null)
      } finally {
        firstRun = false
        if (!cancelled) setLoading(false)
      }
    }

    fetchDetail()
    const id = setInterval(fetchDetail, 6000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [jobFileId])

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


function ChatView({ sessionId, repoName, waitingForSession = false }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  async function ask(messageText) {
    const text = String(messageText || '').trim()
    if (!text || !sessionId || waitingForSession || loading) return

    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          scope: 'session',
          provider: 'auto',
        }),
      })

      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()

      setMessages(prev => [...prev, {
        role: 'assistant',
        text: data.answer || 'Not enough evidence in logs.',
        citations: data.citations || [],
      }])
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Not enough evidence or chat provider unavailable. Try a narrower question.',
        citations: [],
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border bg-background/40 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Session</span>
          <span className="text-[10px] text-muted-foreground/60">{repoName || 'repo'}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
        {waitingForSession ? (
          <div className="text-sm text-muted-foreground/60 py-6 text-center">
            Waiting for PTY session assignment before chat can query logs.
          </div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-muted-foreground/60 py-6 text-center">
            New worker session started. Ask what happened, what is blocked, or what should happen next.
          </div>
        ) : messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}`}
            className={cn(
              'rounded-md border px-3 py-2',
              msg.role === 'user'
                ? 'bg-primary/10 border-primary/30'
                : 'bg-card border-border'
            )}
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{msg.role === 'user' ? 'You' : 'Agent Log Chat'}</p>
            <p className="text-[12px] whitespace-pre-wrap text-foreground/90">{msg.text}</p>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
        className="px-4 py-3 border-t border-border bg-background/40"
      >
        <div className="flex items-center gap-2">
          <Search size={13} className="text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message this worker session..."
            className="flex-1 h-8 bg-card border border-border rounded px-2 text-[12px] focus:outline-none focus:border-primary/40"
          />
            <button
              type="submit"
              disabled={!input.trim() || loading || waitingForSession}
              className="h-8 px-2.5 rounded bg-primary text-primary-foreground text-[12px] disabled:opacity-40"
            >
            {loading ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
            </button>
          </div>
      </form>
    </div>
  )
}

function RawConsoleView({ termRef }) {
  return <div ref={termRef} className="h-full w-full" style={{ padding: '4px', overflow: 'hidden' }} />
}

function TerminalInstance({
  sessionId,
  taskInfo,
  showRaw,
  isActive,
  skipPermissions,
  onKill,
  confirmKill,
  onUpdateSessionId,
  onPromptSent,
  onContextUsage,
  onJobsChanged,
}) {
  const sendCommandRef = useRef(null)
  const sendRawRef = useRef(null)
  const fitRef = useRef(null)
  const promptSentRef = useRef(taskInfo?.promptSent || false)
  const resumeSentRef = useRef(false)

  const onConnected = useCallback(() => {
    if (taskInfo?.resumeCommand && !resumeSentRef.current) {
      resumeSentRef.current = true
      setTimeout(() => {
        fitRef.current?.()
        sendCommandRef.current?.(taskInfo.resumeCommand)
      }, 500)
      return
    }
    if (promptSentRef.current) return
    setTimeout(() => {
      // Re-fit so PTY has correct dimensions before the command renders
      fitRef.current?.()
      let flags = skipPermissions ? ' --dangerously-skip-permissions' : ''
      if (taskInfo?.model) flags += ` --model ${taskInfo.model}`
      if (taskInfo?.maxTurns) flags += ` --max-turns ${taskInfo.maxTurns}`
      sendCommandRef.current?.('claude' + flags)
    }, 500)
  }, [skipPermissions, taskInfo?.model, taskInfo?.maxTurns, taskInfo?.resumeCommand])

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
          if (hoursOnly) resetMinutes = parseInt(hoursOnly[1]) * 60
        }
        onContextUsage?.(sessionId, pct, resetMinutes)
      }
    }

    if (promptSentRef.current || !taskInfo?.taskText) return
    if (data.includes('\u276F') || data.includes('bypass permissions')) {
      promptSentRef.current = true
      onPromptSent?.(sessionId)
      let prompt = taskInfo.taskText
      prompt += '\n\nUse a strictly linear approach. Do not run tasks in parallel and do not delegate to sub-agents.'
      if (taskInfo.jobFile?.relativePath) {
        prompt += `\n\nWrite progress to: ${taskInfo.jobFile.relativePath}`
      }
      setTimeout(() => {
        sendRawRef.current?.(prompt)
        setTimeout(() => sendRawRef.current?.('\r'), 200)
      }, 1000)
    }
  }, [taskInfo, sessionId, onPromptSent, onContextUsage])

  const handleSessionId = useCallback((id) => {
    onUpdateSessionId?.(sessionId, id)
  }, [sessionId, onUpdateSessionId])

  const { termRef, isConnected, isMouseTracking, sendCommand, sendRaw, reconnect, fit } = useTerminal({
    onConnected,
    onIncomingData: onTerminalData,
    onJobsChanged,
    repo: taskInfo?.repoName,
    // Use ptySessionId if already assigned, otherwise seed with client session ID
    // so the server creates the PTY with the same ID stored in the job file's Session: field
    sessionId: taskInfo?.ptySessionId || sessionId,
    onSessionId: handleSessionId,
    jobFilePath: taskInfo?.jobFile?.absolutePath || null,
  })

  useEffect(() => {
    sendCommandRef.current = sendCommand
    sendRawRef.current = sendRaw
    fitRef.current = fit
  }, [sendCommand, sendRaw, fit])

  // Re-fit when this terminal becomes the visible/active one
  useEffect(() => {
    if (isActive) {
      requestAnimationFrame(() => fit())
    }
  }, [isActive, fit])

  const handleRestart = useCallback(() => {
    promptSentRef.current = false
    reconnect()
  }, [reconnect])

  const handleReconnect = useCallback(() => {
    reconnect({ reattach: true })
  }, [reconnect])

  return (
    <div className={cn('h-full flex flex-col', showRaw ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')}>
      {showRaw && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background/60 shrink-0">
          <TerminalSquare size={12} className="text-muted-foreground" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Raw Console</span>
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
              title="Kill this worker"
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
      )}

      <div className="flex-1 min-h-0">
        <RawConsoleView termRef={termRef} />
      </div>
    </div>
  )
}

export default function TerminalPanel({ sessions, activeSessionId, skipPermissions, onKillSession, onUpdateSessionId, onPromptSent, onContextUsage, onJobsChanged }) {
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
      setTimeout(() => setConfirmKill(prev => (prev === id ? null : prev)), 3000)
    }
  }

  return (
    <div className="h-full relative flex flex-col">
      <div className="relative flex-1 min-h-0">
        {[...sessions.entries()].map(([id, info]) => {
          const active = hasTerminal && id === activeSessionId
          return (
            <div key={id} className="absolute inset-0" style={{ display: active ? 'block' : 'none' }}>
              <TerminalInstance
                sessionId={id}
                taskInfo={info}
                showRaw={true}
                isActive={active}
                skipPermissions={skipPermissions}
                onKill={() => handleKill(id)}
                confirmKill={confirmKill === id}
                onUpdateSessionId={onUpdateSessionId}
                onPromptSent={onPromptSent}
                onContextUsage={onContextUsage}
                onJobsChanged={onJobsChanged}
              />
            </div>
          )
        })}
      </div>

      {!hasTerminal && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <TerminalSquare size={24} className="mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground/60">No terminal for this worker.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">Start a worker from Repo Detail or run a task.</p>
          </div>
        </div>
      )}
    </div>
  )
}
