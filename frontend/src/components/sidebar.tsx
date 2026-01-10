import { ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from './ui/scroll-area'
import type { App } from '@/lib/cloudwatch'

interface SidebarProps {
  apps: App[]
  selectedApp: string
  onAppSelect: (app: string) => void
  collapsed: boolean
  loading: boolean
}

export default function Sidebar({
  apps,
  selectedApp,
  onAppSelect,
  collapsed,
  loading,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-14 z-10 flex h-[calc(100vh-3.5rem)] w-64 flex-col border-r bg-muted/40 transition-all duration-300',
        collapsed && 'w-16'
      )}
    >
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          <div className="mb-2 px-2 py-1 text-xs font-semibold uppercase text-muted-foreground tracking-wider">
            {!collapsed ? 'Apps' : ''}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {!collapsed && 'Loading apps...'}
            </div>
          ) : (
            apps.map((app) => (
              <button
                key={app.name}
                onClick={() => onAppSelect(app.name)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground',
                  selectedApp === app.name
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground',
                  collapsed && 'justify-center px-2'
                )}
                title={collapsed ? app.displayName : undefined}
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 shrink-0',
                    selectedApp === app.name ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {!collapsed && <span>{app.displayName}</span>}
              </button>
            ))
          )}

          {apps.length === 0 && !loading && (
            <div className="px-2 py-1 text-sm text-muted-foreground">
              {!collapsed ? 'No apps found' : ''}
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
