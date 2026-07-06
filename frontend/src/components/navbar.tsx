import { Menu, Key } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from './ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

interface NavbarProps {
  environment: 'qa' | 'dev' | 'prod'
  onEnvironmentChange: (env: 'qa' | 'dev' | 'prod') => void
  onToggleSidebar: () => void
  onReconnectClick?: () => void
}

export default function Navbar({
  environment,
  onEnvironmentChange,
  onToggleSidebar,
  onReconnectClick,
}: NavbarProps) {
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
        {onReconnectClick && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReconnectClick}
            className="flex items-center gap-1.5 h-8 border-primary/20 hover:bg-primary/5 hover:text-primary transition"
          >
            <Key className="h-3.5 w-3.5" />
            <span>Reconnect AWS</span>
          </Button>
        )}
      </div>
    </nav>
  )
}
