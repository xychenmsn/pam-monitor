import { useState, useRef, useEffect } from 'react'
import { Search, Trash2, Loader2 } from 'lucide-react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { useAppLogsManager, type AppLogsState } from '@/hooks/useAppLogsManager'
import { cn } from '@/lib/utils'

interface LogViewerProps {
  appName: string
  appDisplayName: string
  environment: 'qa' | 'dev'
}

export default function LogViewer({ appName, appDisplayName, environment }: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const previousLogCount = useRef(0)

  const { initializeApp, getAppLogs, clearAppLogs, clearAllPolling } = useAppLogsManager()

  // Clear all polling when environment changes
  useEffect(() => {
    return () => {
      clearAllPolling()
    }
  }, [environment, clearAllPolling])

  // Initialize app when component mounts or app changes
  useEffect(() => {
    initializeApp(appName, environment)
    setInitialLoadDone(false)
  }, [appName, environment, initializeApp])

  // Get current log state
  const logState: AppLogsState = getAppLogs(appName, environment)

  // Check if there are more streams to load in background
  const hasMoreStreams = logState.streams.some((s, i) => i > 0 && !s.loaded)
  const isLoadingOlder = logState.streams.some((s, i) => i > 0 && s.loading)

  // Scroll to bottom when initial load completes
  useEffect(() => {
    if (!logState.loading && !initialLoadDone && logState.logs.length > 0) {
      scrollRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      setInitialLoadDone(true)
    }
  }, [logState.loading, initialLoadDone, logState.logs.length])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !logState.loading && logState.logs.length > previousLogCount.current && initialLoadDone) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    previousLogCount.current = logState.logs.length
  }, [logState.logs.length, autoScroll, logState.loading, initialLoadDone])

  // Toggle auto-scroll on user scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const scrollTop = target.scrollTop
    const isNearBottom = target.scrollHeight - scrollTop - target.clientHeight < 100
    setAutoScroll(isNearBottom)
  }

  // Client-side filter logs by search query
  const filteredLogs = logState.logs.filter((log) =>
    log.message.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{appDisplayName}</h2>
          <Badge variant="outline" className="text-xs">
            {appName}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            {filteredLogs.length} {filteredLogs.length === 1 ? 'log' : 'logs'}
          </Badge>
          {logState.loading && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading
            </Badge>
          )}
          {isLoadingOlder && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading older logs...
            </Badge>
          )}
          {hasMoreStreams && !logState.loading && !isLoadingOlder && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Loading more streams...
            </Badge>
          )}
          {!hasMoreStreams && logState.streams.length > 1 && !logState.loading && !isLoadingOlder && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              All streams loaded
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {logState.logs.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => clearAppLogs(appName, environment)} className="gap-1">
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="border-b bg-muted/20 px-4 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Logs */}
      <ScrollArea ref={scrollAreaRef} className="flex-1" onScroll={handleScroll}>
        <div className="space-y-0 p-4 font-mono text-sm">
          {logState.loading && logState.logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                <p>Loading logs...</p>
              </div>
            </div>
          ) : logState.error ? (
            <div className="flex h-full items-center justify-center text-destructive">
              <div className="text-center">
                <p className="font-semibold">Error loading logs</p>
                <p className="text-sm">{logState.error}</p>
              </div>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              {searchQuery ? 'No logs match your search' : 'No logs available'}
            </div>
          ) : (
            <>
              {filteredLogs.map((log, index) => (
                <div
                  key={`${log.timestamp}-${log.stream}-${index}`}
                  className={cn(
                    'rounded px-3 py-1 hover:bg-muted/50',
                    log.message.includes('ERROR') && 'bg-red-500/5',
                    log.message.includes('WARN') && 'bg-yellow-500/5'
                  )}
                >
                  <pre className="whitespace-pre-wrap break-words font-mono text-sm">{log.message}</pre>
                </div>
              ))}
            </>
          )}
        </div>
        <div ref={scrollRef} />
      </ScrollArea>
    </div>
  )
}
