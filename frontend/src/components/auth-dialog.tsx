import { AlertCircle, Terminal, RotateCcw } from 'lucide-react'
import { Button } from './ui/button'

interface AuthDialogProps {
  isOpen: boolean
  onRetry: () => void
}

export default function AuthDialog({ isOpen, onRetry }: AuthDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="mx-4 max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-destructive/10 p-2">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">AWS Credentials Expired</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your AWS credentials have expired. Please refresh them:
            </p>
            <div className="mt-3 rounded-md bg-muted p-3 font-mono text-sm">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <code>peacock security</code>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              After running the command, click the button below to retry.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              💡 The app will automatically pick up the new credentials - no restart needed!
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button onClick={onRetry}>
            <RotateCcw className="mr-2 h-4 w-4" />
            I've Run peacock security - Retry
          </Button>
        </div>
      </div>
    </div>
  )
}
