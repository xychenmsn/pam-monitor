import { Menu } from 'lucide-react'
import { Button } from './ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

interface NavbarProps {
  environment: 'qa' | 'dev'
  onEnvironmentChange: (env: 'qa' | 'dev') => void
  onToggleSidebar: () => void
}

export default function Navbar({
  environment,
  onEnvironmentChange,
  onToggleSidebar,
}: NavbarProps) {
  return (
    <nav className="flex h-14 items-center border-b bg-muted/40 px-4">
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
          <span className="font-semibold">PAM Log Monitor</span>
          <span className="text-muted-foreground">|</span>
          <Select
            value={environment}
            onValueChange={(value) => onEnvironmentChange(value as 'qa' | 'dev')}
          >
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="qa">QA</SelectItem>
              <SelectItem value="dev">Dev</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </nav>
  )
}
