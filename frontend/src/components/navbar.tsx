import { Menu, RefreshCw, Key, HelpCircle, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from './ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import type { ConnectionState } from '../hooks/useAuthHeartbeat'

interface NavbarProps {
  environment: 'qa' | 'dev' | 'prod'
  onEnvironmentChange: (env: 'qa' | 'dev' | 'prod') => void
  onToggleSidebar: () => void
  connectionStatus: ConnectionState
  onCheckConnection: () => void
  onConnect: () => void
}

export default function Navbar({
  environment,
  onEnvironmentChange,
  onToggleSidebar,
  connectionStatus = 'unknown',
  onCheckConnection,
  onConnect,
}: NavbarProps) {
  const renderConnectionDashboard = () => {
    switch (connectionStatus) {
      case 'checking':
        return (
          <div className="flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/50 px-3 py-1 text-sm text-blue-600 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="font-medium">Checking AWS status...</span>
          </div>
        )

      case 'connecting':
        return (
          <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/50 px-3 py-1 text-sm text-amber-600 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400 animate-pulse">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="font-medium">Connecting (check Duo)...</span>
          </div>
        )

      case 'connected':
        return (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/50 px-3 py-1 text-sm text-emerald-600 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-medium capitalize">{environment} Connected</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckConnection}
              className="flex items-center gap-1.5 h-8 text-xs hover:bg-muted"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Verify</span>
            </Button>
          </div>
        )

      case 'disconnected':
        return (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50/50 px-3 py-1 text-sm text-rose-600 dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-400">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              <span className="font-medium capitalize">{environment} Disconnected</span>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={onConnect}
              className="flex items-center gap-1.5 h-8 text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium"
            >
              <Key className="h-3 w-3" />
              <span>Connect</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckConnection}
              className="flex items-center gap-1.5 h-8 text-xs hover:bg-muted"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Check again</span>
            </Button>
          </div>
        )

      case 'unknown':
      default:
        return (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-sm text-muted-foreground">
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="font-medium capitalize">{environment} Status Unknown</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onCheckConnection}
              className="flex items-center gap-1.5 h-8 text-xs border-primary/20 hover:bg-primary/5 hover:text-primary transition"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Check Connection</span>
            </Button>
          </div>
        )
    }
  }

  return (
    <nav className="flex h-14 items-center justify-between border-b bg-muted/40 px-4 w-full">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className="shrink-0"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2">
          <Link
            to={`/?env=${environment}`}
            className="font-semibold transition-colors hover:text-primary"
          >
            PAM Monitor
          </Link>
          <span className="text-muted-foreground">|</span>
          <Select
            value={environment}
            onValueChange={(value) => onEnvironmentChange(value as 'qa' | 'dev' | 'prod')}
          >
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="qa">QA</SelectItem>
              <SelectItem value="dev">Dev</SelectItem>
              <SelectItem value="prod">Prod</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {renderConnectionDashboard()}
      </div>
    </nav>
  )
}
