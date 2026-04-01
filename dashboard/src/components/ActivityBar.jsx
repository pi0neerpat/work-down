import { Activity, Bot, ListTodo, Send, CalendarClock, Settings, ArrowLeft, Map, RefreshCcw } from 'lucide-react'
import { cn } from '../lib/utils'

const NAV_ITEMS = [
  { id: 'dispatch', label: 'Dispatch', icon: Send },
  { id: 'jobs', label: 'Jobs', icon: Bot },
  { id: 'loops', label: 'Loops', icon: RefreshCcw },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'plans', label: 'Plans', icon: Map },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'status', label: 'Status', icon: Activity },
]

export default function ActivityBar({ activeNav, onNavChange, jobCount = 0, reviewCount = 0, loopCount = 0, settingsOpen = false, onToggleSettings }) {
  if (settingsOpen) {
    return (
      <aside className="w-[160px] shrink-0 border-r border-border bg-background flex flex-col pt-1">
        <button
          onClick={onToggleSettings}
          className="flex items-center gap-1.5 px-3 py-2 mb-1 text-muted-foreground hover:text-foreground transition-colors text-[12px]"
        >
          <ArrowLeft size={13} strokeWidth={1.8} />
          <span className="font-medium">Back</span>
        </button>

        <div className="px-2">
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] bg-primary/[0.14]"
            style={{ color: '#8bab8f' }}
          >
            <Bot size={14} strokeWidth={2.2} />
            <span>Agents</span>
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="w-[60px] shrink-0 border-r border-border bg-background flex flex-col items-center pt-2 gap-1">
      {NAV_ITEMS.map(item => {
        const Icon = item.icon
        const isActive = activeNav === item.id
        const badge = item.id === 'jobs' ? jobCount : item.id === 'loops' ? loopCount : item.id === 'status' && reviewCount > 0 ? reviewCount : 0

        return (
          <button
            key={item.id}
            onClick={() => onNavChange(item.id)}
            style={isActive ? { color: '#8bab8f' } : undefined}
            className={cn(
              'relative w-[52px] flex flex-col items-center gap-0.5 py-2 rounded-md transition-colors',
              isActive
                ? 'bg-primary/[0.14]'
                : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
            )}
            title={item.label}
          >
            <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="text-[9px] font-medium leading-none" style={{ color: 'var(--foreground-secondary)' }}>
              {item.label}
            </span>

            {badge > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-status-active text-[8px] font-bold text-primary-foreground px-0.5">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        )
      })}

      <div className="mt-auto mb-2">
        <button
          onClick={onToggleSettings}
          className="w-[52px] flex items-center justify-center py-2 rounded-md transition-colors text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-card/50"
          title="Settings"
        >
          <Settings size={14} strokeWidth={1.5} />
        </button>
      </div>
    </aside>
  )
}
