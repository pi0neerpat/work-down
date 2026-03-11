import { useEffect, useMemo, useState } from 'react'
import { Command, Search, Play, FolderOpen, TerminalSquare, Skull } from 'lucide-react'
import { cn } from '../lib/utils'

function kindIcon(kind) {
  if (kind === 'repo') return FolderOpen
  if (kind === 'task') return Play
  if (kind === 'agent') return TerminalSquare
  return Search
}

export default function CommandPalette({
  open,
  onClose,
  repos,
  selectedRepo,
  searchResults,
  onSelectResult,
  activeWorkers,
  onStartWorker,
  onKillSession,
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])

  const commands = useMemo(() => {
    const base = []

    if (selectedRepo) {
      base.push({
        key: `start:${selectedRepo}`,
        label: `Start worker in ${selectedRepo}`,
        subtitle: 'Launch a blank worker terminal',
        icon: Play,
        run: () => onStartWorker?.(selectedRepo),
      })
    }

    for (const repo of repos || []) {
      base.push({
        key: `switch:${repo.name}`,
        label: `Switch to ${repo.name}`,
        subtitle: `${repo.tasks.openCount} open tasks`,
        icon: FolderOpen,
        run: () => onSelectResult?.({ kind: 'repo', targetId: repo.name, repo: repo.name }),
      })
    }

    if (activeWorkers) {
      for (const [sessionId, info] of activeWorkers.entries()) {
        base.push({
          key: `open:${sessionId}`,
          label: `Open worker: ${info.taskText || 'Manual worker'}`,
          subtitle: `Session ${sessionId}`,
          icon: TerminalSquare,
          run: () => onSelectResult?.({ kind: 'agent', targetId: sessionId, repo: info.repoName }),
        })
        base.push({
          key: `kill:${sessionId}`,
          label: `Kill worker: ${info.taskText || 'Manual worker'}`,
          subtitle: `Session ${sessionId}`,
          icon: Skull,
          run: () => onKillSession?.(sessionId),
        })
      }
    }

    return base
  }, [repos, selectedRepo, activeWorkers, onStartWorker, onSelectResult, onKillSession])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const commandMatches = commands.filter(cmd => !q || cmd.label.toLowerCase().includes(q) || cmd.subtitle.toLowerCase().includes(q))
    const searchMatches = searchResults
      .filter(item => !q || item.label.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q))
      .map(item => ({
        key: `search:${item.key}`,
        label: item.label,
        subtitle: item.subtitle,
        icon: kindIcon(item.kind),
        run: () => onSelectResult?.(item),
      }))

    return [...commandMatches, ...searchMatches].slice(0, 18)
  }, [query, commands, searchResults, onSelectResult])

  useEffect(() => {
    setIndex(prev => {
      if (filtered.length === 0) return 0
      return Math.min(prev, filtered.length - 1)
    })
  }, [filtered])

  useEffect(() => {
    if (!open) return

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex(prev => (prev + 1) % Math.max(filtered.length, 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex(prev => (prev - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1))
      }
      if (e.key === 'Enter' && filtered[index]) {
        e.preventDefault()
        filtered[index].run?.()
        onClose?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, filtered, index, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-[2px] flex items-start justify-center pt-[12vh]">
      <div className="w-full max-w-2xl mx-4 rounded-xl border border-card-border bg-background-raised shadow-2xl overflow-hidden animate-fade-up">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Command size={15} className="text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or run command..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
        </div>

        <div className="max-h-[56vh] overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground/70">
              No matching commands.
            </div>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon || Search
              return (
                <button
                  key={item.key}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => {
                    item.run?.()
                    onClose?.()
                  }}
                  className={cn(
                    'w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors',
                    i === index ? 'bg-card border border-card-border-hover' : 'hover:bg-card/70 border border-transparent'
                  )}
                >
                  <Icon size={14} className="text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground/70 truncate">{item.subtitle}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
