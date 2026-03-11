import { useRef, useCallback, useEffect, useMemo, useState } from 'react'
import {
  TerminalSquare,
  RefreshCw,
  RotateCcw,
  X,
  Loader,
  Workflow,
  MessageSquare,
  ListTree,
  AlertCircle,
  TriangleAlert,
  Wrench,
  FileCode2,
  Brain,
  Cog,
  Search,
  Send,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useTerminal } from '../lib/useTerminal'

function parseProgressText(entry) {
  if (!entry) return ''
  return entry.replace(/^\[[^\]]+\]\s*/, '').trim()
}

function kindMeta(kind, level) {
  if (kind === 'error' || level === 'error') return { icon: AlertCircle, cls: 'text-status-failed', label: 'Error' }
  if (kind === 'warning' || level === 'warn') return { icon: TriangleAlert, cls: 'text-status-review', label: 'Warning' }
  if (kind === 'tool') return { icon: Wrench, cls: 'text-status-active', label: 'Tool' }
  if (kind === 'file') return { icon: FileCode2, cls: 'text-primary', label: 'File' }
  if (kind === 'thought') return { icon: Brain, cls: 'text-foreground-secondary', label: 'Thought' }
  if (kind === 'progress') return { icon: Workflow, cls: 'text-status-active', label: 'Progress' }
  return { icon: Cog, cls: 'text-muted-foreground', label: 'System' }
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
    let firstRun = true

    async function fetchDetail() {
      if (!cancelled && firstRun) setLoading(true)
      try {
        const res = await fetch(`/api/swarm/${swarmFileId}`)
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
  }, [swarmFileId])

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

function TimelineView({ sessionId, repoName, jumpToRaw, focusedEventId, onFocusEvent }) {
  const [events, setEvents] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedKinds, setSelectedKinds] = useState(new Set())

  const kinds = ['progress', 'action', 'thought', 'tool', 'file', 'warning', 'error', 'system']

  useEffect(() => {
    if (!sessionId) {
      setEvents([])
      setSummary(null)
      return
    }

    let cancelled = false

    async function refresh() {
      if (!cancelled && events.length === 0) setLoading(true)
      try {
        const [evRes, sumRes] = await Promise.all([
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/events?limit=300`),
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/summary`),
        ])

        if (evRes.ok) {
          const ev = await evRes.json()
          if (!cancelled) setEvents(ev.items || [])
        }
        if (sumRes.ok) {
          const sm = await sumRes.json()
          if (!cancelled) setSummary(sm)
        }
      } catch {
        // ignore poll errors
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    const id = setInterval(refresh, 2500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (selectedKinds.size === 0) return events
    return events.filter(evt => selectedKinds.has(evt.kind))
  }, [events, selectedKinds])

  useEffect(() => {
    if (!focusedEventId) return
    const el = document.getElementById(`timeline-${focusedEventId}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusedEventId, filtered])

  function toggleKind(kind) {
    setSelectedKinds(prev => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-border bg-background/40 sticky top-0 z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeline</span>
          {kinds.map(kind => (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full border capitalize',
                selectedKinds.has(kind)
                  ? 'bg-primary/15 border-primary/40 text-primary'
                  : 'bg-card border-border text-muted-foreground/80 hover:text-foreground'
              )}
            >
              {kind}
            </button>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            <p className="text-muted-foreground/60">Current step</p>
            <p className="text-foreground/85 line-clamp-2">{summary?.summary?.currentStep || 'Waiting for activity'}</p>
          </div>
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            <p className="text-muted-foreground/60">Last error</p>
            <p className="text-status-failed/85 line-clamp-2">{summary?.summary?.lastError || 'None'}</p>
          </div>
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            <p className="text-muted-foreground/60">Files / Tools</p>
            <p className="text-foreground/85">{summary?.summary?.filesTouched?.length || 0} files, {summary?.summary?.toolCalls || 0} tools</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {loading && events.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/60 text-sm">Loading timeline...</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/60 text-sm">No events yet for this worker.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(evt => {
              const meta = kindMeta(evt.kind, evt.level)
              const Icon = meta.icon
              const isFocused = focusedEventId === evt.id
              return (
                <div
                  key={evt.id}
                  id={`timeline-${evt.id}`}
                  className={cn(
                    'rounded-md border px-3 py-2 bg-card/60 animate-slide-in',
                    isFocused ? 'border-primary/50 ring-1 ring-primary/40' : 'border-border'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon size={13} className={cn('mt-0.5 shrink-0', meta.cls)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('text-[10px] uppercase tracking-wider font-medium', meta.cls)}>{meta.label}</span>
                        <span className="text-[10px] text-muted-foreground/50 font-mono" style={{ fontFamily: 'var(--font-mono)' }}>
                          {evt.id}
                        </span>
                        <span className="text-[10px] text-muted-foreground/40">{repoName || evt.repo || 'repo'}</span>
                      </div>
                      <p className="text-[12px] text-foreground/90 whitespace-pre-wrap break-words mt-0.5">{evt.text}</p>

                      {(evt.raw && evt.raw !== evt.text) && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-muted-foreground/70">Raw payload</summary>
                          <pre className="mt-1 p-2 rounded bg-background text-[10px] overflow-x-auto border border-border text-foreground/75">{evt.raw}</pre>
                        </details>
                      )}

                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          onClick={() => {
                            onFocusEvent?.(evt.id)
                            jumpToRaw?.()
                          }}
                          className="text-[11px] text-primary hover:text-primary/80"
                        >
                          Jump to raw console
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ChatView({ sessionId, repoName, onCitationClick }) {
  const [scope, setScope] = useState('session')
  const [provider, setProvider] = useState('auto')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  const quickPrompts = [
    'Summarize the latest progress and blockers.',
    'Risk scan: what looks likely to fail next?',
    'What changed in files recently?',
    'What should happen next to finish this task?',
  ]

  async function ask(messageText) {
    const text = String(messageText || '').trim()
    if (!text || !sessionId || loading) return

    setMessages(prev => [...prev, { role: 'user', text }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          scope,
          provider,
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Interactive Chat</span>
          <span className="text-[10px] text-muted-foreground/60">{repoName || 'repo'}</span>

          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="ml-auto text-[11px] bg-card border border-border rounded px-2 py-1"
          >
            <option value="session">Session</option>
            <option value="repo">Repo</option>
            <option value="all">All</option>
          </select>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="text-[11px] bg-card border border-border rounded px-2 py-1"
          >
            <option value="auto">Provider: auto</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickPrompts.map(prompt => (
            <button
              key={prompt}
              onClick={() => ask(prompt)}
              className="text-[11px] px-2 py-1 rounded-full border border-border bg-card hover:bg-card-hover text-foreground/85"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="text-sm text-muted-foreground/60 py-6 text-center">
            Ask about blockers, failures, file changes, or next actions.
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
            {msg.citations?.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground/70">Citations:</span>
                {msg.citations.map(c => (
                  <button
                    key={c.eventId}
                    onClick={() => onCitationClick?.(c.eventId)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-background hover:bg-card text-primary"
                  >
                    {c.eventId}
                  </button>
                ))}
              </div>
            )}
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
            placeholder="Ask about this worker timeline..."
            className="flex-1 h-8 bg-card border border-border rounded px-2 text-[12px] focus:outline-none focus:border-primary/40"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
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
  skipPermissions,
  onKill,
  confirmKill,
  onUpdateSessionId,
  onPromptSent,
  onContextUsage,
}) {
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
          if (hoursOnly) resetMinutes = parseInt(hoursOnly[1]) * 60
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
        setTimeout(() => sendRawRef.current?.('\r'), 200)
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

  if (!showRaw) {
    return (
      <div className="hidden">
        <RawConsoleView termRef={termRef} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
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

      <div className="flex-1 min-h-0">
        <RawConsoleView termRef={termRef} />
      </div>
    </div>
  )
}

export default function TerminalPanel({ sessions, activeSessionId, skipPermissions, onKillSession, onUpdateSessionId, onPromptSent, onContextUsage }) {
  const hasTerminal = activeSessionId && sessions.has(activeSessionId)
  const [confirmKill, setConfirmKill] = useState(null)
  const [view, setView] = useState('timeline')
  const [focusedEventId, setFocusedEventId] = useState(null)

  useEffect(() => {
    setConfirmKill(null)
    setView('timeline')
    setFocusedEventId(null)
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

  const activeInfo = hasTerminal ? sessions.get(activeSessionId) : null

  return (
    <div className="h-full relative flex flex-col">
      {hasTerminal && (
        <div className="px-3 py-2 border-b border-border bg-background/50 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setView('timeline')}
              className={cn('text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5', view === 'timeline' ? 'bg-card border-card-border-hover text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              <ListTree size={12} /> Timeline
            </button>
            <button
              onClick={() => setView('chat')}
              className={cn('text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5', view === 'chat' ? 'bg-card border-card-border-hover text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              <MessageSquare size={12} /> Chat
            </button>
            <button
              onClick={() => setView('raw')}
              className={cn('text-[11px] px-2.5 py-1 rounded border flex items-center gap-1.5', view === 'raw' ? 'bg-card border-card-border-hover text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              <TerminalSquare size={12} /> Raw
            </button>
          </div>
        </div>
      )}

      {hasTerminal && <AgentHeader taskInfo={activeInfo} />}

      <div className="relative flex-1 min-h-0">
        {[...sessions.entries()].map(([id, info]) => (
          <div key={id} className="absolute inset-0" style={{ display: hasTerminal && id === activeSessionId ? 'block' : 'none' }}>
            <TerminalInstance
              sessionId={id}
              taskInfo={info}
              showRaw={view === 'raw'}
              skipPermissions={skipPermissions}
              onKill={() => handleKill(id)}
              confirmKill={confirmKill === id}
              onUpdateSessionId={onUpdateSessionId}
              onPromptSent={onPromptSent}
              onContextUsage={onContextUsage}
            />
          </div>
        ))}

        {hasTerminal && view === 'timeline' && (
          <div className="absolute inset-0">
          <TimelineView
            sessionId={activeSessionId}
            repoName={activeInfo?.repoName}
            jumpToRaw={() => setView('raw')}
            focusedEventId={focusedEventId}
            onFocusEvent={setFocusedEventId}
          />
          </div>
        )}

        {hasTerminal && view === 'chat' && (
          <div className="absolute inset-0">
            <ChatView
              sessionId={activeSessionId}
              repoName={activeInfo?.repoName}
              onCitationClick={(eventId) => {
                setFocusedEventId(eventId)
                setView('timeline')
              }}
            />
          </div>
        )}
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
