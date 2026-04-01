import { Sparkles, MousePointer2 } from 'lucide-react'
import clawdIcon from '../clawd.png'
import { getAgentBrandColor, normalizeAgentId } from '../lib/constants'
import { cn } from '../lib/utils'

function labelForAgent(agentId) {
  const normalized = normalizeAgentId(agentId)
  if (normalized === 'codex') return 'Codex'
  if (normalized === 'cursor') return 'Cursor'
  return 'Claude'
}

export function getAgentLabel(agentId) {
  return labelForAgent(agentId)
}

export default function AgentIcon({ agent = 'claude', size = 14, className, color, title, style }) {
  const normalizedAgent = normalizeAgentId(agent)
  const label = labelForAgent(normalizedAgent)

  if (normalizedAgent === 'claude') {
    return (
      <img
        src={clawdIcon}
        alt={`${label} icon`}
        width={size}
        height={size}
        title={title || `${label} icon`}
        className={cn('shrink-0 object-contain', className)}
        style={style}
      />
    )
  }

  if (normalizedAgent === 'cursor') {
    return (
      <MousePointer2
        size={size}
        title={title || `${label} icon`}
        className={className}
        style={{ color: color || getAgentBrandColor(normalizedAgent), ...style }}
      />
    )
  }

  return (
    <Sparkles
      size={size}
      title={title || `${label} icon`}
      className={className}
      style={{ color: color || getAgentBrandColor(normalizedAgent), ...style }}
    />
  )
}
