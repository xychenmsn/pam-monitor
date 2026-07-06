import { useState, useEffect, useRef } from 'react'
import { AlertCircle, Terminal, Loader2, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { triggerLogin } from '../lib/cloudwatch'

interface RobustAuthDialogProps {
    isOpen: boolean
    environment: 'qa' | 'dev' | 'prod'
    onRetry: () => Promise<boolean> // Returns true if auth succeeded
    onClose?: () => void
    isManual?: boolean
}

export default function RobustAuthDialog({ isOpen, environment, onRetry, onClose, isManual }: RobustAuthDialogProps) {
    const [retryCount, setRetryCount] = useState(0)
    const [countdown, setCountdown] = useState(30)
    const [isRetrying, setIsRetrying] = useState(false)
    const [lastError, setLastError] = useState<string | null>(null)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // Clear intervals on unmount or when dialog closes
    useEffect(() => {
        if (!isOpen) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (countdownRef.current) clearInterval(countdownRef.current)
            setRetryCount(0)
            setCountdown(30)
            setIsRetrying(false)
            setLastError(null)
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (countdownRef.current) clearInterval(countdownRef.current)
        }
    }, [isOpen])

    // Start auto-retry when dialog opens
    useEffect(() => {
        if (!isOpen) return

        const attemptRetry = async () => {
            setIsRetrying(true)
            setLastError(null)
            try {
                const success = await onRetry()
                if (success) {
                    // Auth succeeded, dialog will close via parent/onClose
                    if (onClose) onClose()
                    return
                }
                setRetryCount(prev => prev + 1)
                setLastError('Credentials still expired')
            } catch (error) {
                setRetryCount(prev => prev + 1)
                setLastError(error instanceof Error ? error.message : 'Auth check failed')
            } finally {
                setIsRetrying(false)
                setCountdown(30)
            }
        }

        // Start countdown timer
        countdownRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    return 30 // Reset after reaching 0
                }
                return prev - 1
            })
        }, 1000)

        // Start retry interval (every 30 seconds)
        intervalRef.current = setInterval(attemptRetry, 30000)

        // Do first retry after a short delay
        const initialTimeout = setTimeout(attemptRetry, 1000)

        return () => {
            clearTimeout(initialTimeout)
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (countdownRef.current) clearInterval(countdownRef.current)
        }
    }, [isOpen, onRetry, onClose])

    const handleManualRetry = async () => {
        setIsRetrying(true)
        setLastError(null)
        try {
            // 1. Trigger the login script (MFA)
            await triggerLogin(environment)

            // Give user a moment to see the push notification/confirm
            // The process might return before they click.
            await new Promise(resolve => setTimeout(resolve, 2000))

            // 2. Check if it worked
            const success = await onRetry()
            if (success) {
                if (onClose) onClose()
            } else {
                setRetryCount(prev => prev + 1)
                setLastError('Credentials still expired. Ensure you confirmed the push notification on your phone, then try again.')
            }
        } catch (error) {
            setRetryCount(prev => prev + 1)
            setLastError(error instanceof Error ? error.message : 'Auth check failed')
        } finally {
            setIsRetrying(false)
            setCountdown(30)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="mx-4 max-w-lg rounded-lg border border-primary/20 bg-background p-6 shadow-lg">
                <div className="flex items-start gap-4">
                    <div className="rounded-full bg-primary/10 p-2">
                        <AlertCircle className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-lg font-semibold">
                            {isManual ? 'AWS Reconnect' : 'AWS Credentials Expired'}
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {isManual 
                                ? 'Verify or refresh your AWS credentials. Please run the following command in your terminal:'
                                : 'Your AWS credentials have expired. Please run the following command in your terminal:'
                            }
                        </p>
                        <div className="mt-3 rounded-md bg-muted p-3 font-mono text-sm">
                            <div className="flex items-center gap-2">
                                <Terminal className="h-4 w-4 text-muted-foreground" />
                                <code className="text-green-400">
                                    {environment === 'prod' ? 'awslogin_prod' : 'awslogin_nonprod'}
                                </code>
                            </div>
                        </div>

                        {/* Status Section */}
                        <div className="mt-4 space-y-2">
                            {isRetrying ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Checking credentials...</span>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <RefreshCw className="h-4 w-4" />
                                    <span>Next auto-retry in {countdown}s</span>
                                </div>
                            )}

                            {retryCount > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Retry attempts: {retryCount}
                                </p>
                            )}

                            {lastError && (
                                <p className="text-xs text-destructive">
                                    {lastError}
                                </p>
                            )}
                        </div>

                        <p className="mt-4 text-xs text-muted-foreground">
                            💡 This dialog will automatically check every 30 seconds. Run the command above and wait for auto-retry, or click the button below.
                        </p>
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                    {onClose && (
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            disabled={isRetrying}
                        >
                            Cancel
                        </Button>
                    )}
                    <Button
                        onClick={handleManualRetry}
                        disabled={isRetrying}
                        className="gap-2"
                    >
                        {isRetrying ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Checking...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="h-4 w-4" />
                                {isManual ? 'Reconnect Now' : 'Retry Now'}
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
