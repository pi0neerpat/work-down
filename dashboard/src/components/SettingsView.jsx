import { Bot, Sparkles } from 'lucide-react'
import { useAgentModels } from '../lib/useAgentModels'
import { getAgentBrandColor } from '../lib/constants'
import Toggle from './Toggle'

function AgentCard({ agentId, label, icon: Icon, agentSettings, onUpdate, showMaxTurns = true, showTuiMode = false }) {
  const { defaultModel, defaultMaxTurns, skipPermissions, tuiMode, extraFlags } = agentSettings
  const models = useAgentModels(agentId)
  const brandColor = getAgentBrandColor(agentId)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: brandColor }} />
        <span className="text-[13px] font-medium" style={{ color: brandColor }}>{label}</span>
      </div>

      <div className="flex items-end gap-3">
        {/* Default Model */}
        <div className="w-56">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Default Model</label>
          <select
            value={defaultModel}
            onChange={(e) => onUpdate(agentId, { defaultModel: e.target.value })}
            className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground focus:outline-none focus:border-primary/30"
          >
            {models.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Default Max Turns */}
        {showMaxTurns && (
          <div className="w-20 shrink-0">
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">
              Max Turns
            </label>
            <input
              type="number"
              min={0}
              max={200}
              value={defaultMaxTurns ?? 0}
              onChange={(e) => { const v = parseInt(e.target.value); onUpdate(agentId, { defaultMaxTurns: !v ? null : v }) }}
              placeholder="0 = no limit"
              className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground font-mono focus:outline-none focus:border-primary/30"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        )}
      </div>

      {/* Skip Permissions */}
      <div className="flex items-center gap-3">
        <Toggle
          checked={skipPermissions}
          onChange={(val) => onUpdate(agentId, { skipPermissions: val })}
        />
        <div>
          <span className="text-[12px] text-foreground/80">Skip Permissions</span>
          <p className="text-[10px] text-muted-foreground/50">
            {agentId === 'claude' ? '--dangerously-skip-permissions' : '--dangerously-bypass-approvals-and-sandbox'}
          </p>
        </div>
      </div>

      {/* TUI Mode */}
      {showTuiMode && (
        <div className="flex items-center gap-3">
          <Toggle
            checked={tuiMode}
            onChange={(val) => onUpdate(agentId, { tuiMode: val })}
          />
          <div>
            <span className="text-[12px] text-foreground/80">TUI Mode</span>
            <p className="text-[10px] text-muted-foreground/50">
              {agentId === 'claude' ? 'Off: adds -p --output-format text' : 'Off: adds --quiet, runs headless'}
            </p>
          </div>
        </div>
      )}

      {/* Extra Flags */}
      <div>
        <label className="block text-[11px] font-medium text-muted-foreground mb-1">Extra Flags</label>
        <input
          type="text"
          value={extraFlags}
          onChange={(e) => onUpdate(agentId, { extraFlags: e.target.value })}
          placeholder="e.g. --add-dir ../shared"
          className="w-full h-8 px-2.5 rounded-md border border-border bg-background text-[12px] text-foreground font-mono focus:outline-none focus:border-primary/30"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
      </div>
    </div>
  )
}

export default function SettingsView({ settings, onUpdateAgent }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[13px] font-semibold mb-0.5">Agents</h2>
        <p className="text-[11px] text-muted-foreground">Configure default behavior for each agent provider.</p>
      </div>

      <div className="space-y-3">
        <AgentCard
          agentId="claude"
          label="Claude"
          icon={Bot}
          agentSettings={settings.agents.claude}
          onUpdate={onUpdateAgent}
          showMaxTurns={true}
          showTuiMode={true}
        />
        <AgentCard
          agentId="codex"
          label="Codex"
          icon={Sparkles}
          agentSettings={settings.agents.codex}
          onUpdate={onUpdateAgent}
          showMaxTurns={false}
          showTuiMode={true}
        />
      </div>
    </div>
  )
}
