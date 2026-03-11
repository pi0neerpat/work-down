import { cn } from '../lib/utils'

export default function CenterTabs({ tabs, activeTab, onTabChange, contentMap }) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition-all relative',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground-secondary'
              )}
            >
              <Icon size={14} />
              {tab.label}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map(tab => {
          const content = contentMap[tab.id]
          if (!content) return null

          if (tab.id === 'terminal') {
            return (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ display: activeTab === 'terminal' ? 'block' : 'none' }}
              >
                {content}
              </div>
            )
          }

          if (activeTab !== tab.id) return null
          return (
            <div key={tab.id} className="absolute inset-0 overflow-y-auto px-6 py-5">
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
