import { Bot, Sparkles } from 'lucide-react'
import { cn } from '../lib/utils'
import { AGENT_OPTIONS, getAgentBrandColor } from '../lib/constants'
import Toggle from './Toggle'

const AGENT_ICONS = { claude: Bot, codex: Sparkles }

/**
 * Shared dispatch settings controls: Agent, Model, Turns, TUI, Auto-merge, Worktree.
 * Returns a Fragment — parent must supply the flex container.
 */
export default function DispatchSettingsRow({
  agent, onSwitchAgent,
  model, setModel, models,
  maxTurns, setMaxTurns,
  useWorktree, setUseWorktree,
  autoMerge, setAutoMerge,
  plainOutput, setPlainOutput,
}) {
  const isCodex = agent === 'codex'
  return (
    <>
      {/* Agent selector */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Agent</label>
        <div className="flex flex-col gap-1">
          {AGENT_OPTIONS.map(opt => {
            const Icon = AGENT_ICONS[opt.id] || Bot
            const isSelected = agent === opt.id
            const brandColor = getAgentBrandColor(opt.id)
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSwitchAgent(opt.id)}
                style={isSelected ? { color: brandColor, borderColor: `${brandColor}40`, backgroundColor: `${brandColor}18` } : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors',
                  isSelected
                    ? 'border-transparent'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-card-hover'
                )}
              >
                <Icon size={13} />
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Model */}
      <div className="w-44">
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground focus:outline-none focus:border-primary/30"
        >
          {models.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Turns */}
      <div className="w-20">
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Turns</label>
        <input
          type="number"
          min={1}
          max={200}
          value={isCodex ? '' : (maxTurns ?? '')}
          disabled={isCodex}
          onChange={(e) => setMaxTurns(parseInt(e.target.value) || 10)}
          placeholder={isCodex ? 'N/A' : '10'}
          title={isCodex ? 'N/A for Codex' : undefined}
          className={cn(
            'w-full h-8 px-2.5 rounded-md border border-border bg-card text-[12px] text-foreground font-mono focus:outline-none focus:border-primary/30',
            isCodex && 'opacity-40 cursor-not-allowed'
          )}
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>

      {/* TUI */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">TUI</label>
        <div className="h-8 flex items-center">
          <Toggle
            checked={!plainOutput}
            onChange={(val) => setPlainOutput(!val)}
            title={isCodex ? 'TUI mode — off adds --quiet' : 'TUI mode — off adds -p --output-format text'}
          />
        </div>
      </div>

      {/* Auto-merge */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Auto-Merge</label>
        <div className="h-8 flex items-center">
          <Toggle checked={autoMerge} onChange={setAutoMerge} />
        </div>
      </div>

      {/* Worktree */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Worktree</label>
        <div className="h-8 flex items-center">
          <Toggle checked={useWorktree} onChange={setUseWorktree} title="Run in an isolated git worktree" />
        </div>
      </div>
    </>
  )
}
