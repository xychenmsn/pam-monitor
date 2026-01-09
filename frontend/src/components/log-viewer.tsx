import { useState, useRef, useEffect } from 'react'
import { Search, Trash2, Loader2, ArrowUp } from 'lucide-react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { useAppLogsManager, type AppLogsState } from '@/hooks/useAppLogsManager'
import type { LogEvent } from '@/lib/cloudwatch'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface LogViewerProps {
  appName: string
  appDisplayName: string
  environment: 'qa' | 'dev'
}

export default function LogViewer({ appName, appDisplayName, environment }: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const previousLogCount = useRef(0)
  const hasScrolledToTop = useRef(false)

  const { initializeApp, getAppLogs, loadOlderLogs, clearAppLogs } = useAppLogsManager()

  // Initialize app when component mounts or app changes
  useEffect(() => {
    initializeApp(appName, environment)
  }, [appName, environment, initializeApp])

  // Get current log state
  const logState: AppLogsState = getAppLogs(appName, environment) || {
    logs: [],
    loading: true,
    error: null,
    hasMore: true,
    newestTimestamp: 0,
    oldestTimestamp: 0,
  }

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !logState.loading && logState.logs.length > previousLogCount.current) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    previousLogCount.current = logState.logs.length
  }, [logState.logs.length, autoScroll, logState.loading])

  // Toggle auto-scroll on user scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const scrollTop = target.scrollTop
    const isNearBottom = target.scrollHeight - scrollTop - target.clientHeight < 100
    const isAtTop = scrollTop < 50

    setAutoScroll(isNearBottom)

    // Load older logs when scrolling to top
    if (isAtTop && logState.hasMore && !loadingOlder && !logState.loading && logState.logs.length > 0) {
      hasScrolledToTop.current = true
      setLoadingOlder(true)
      loadOlderLogs(appName, environment).finally(() => setLoadingOlder(false))
    }
  }

  // Client-side filter logs by search query
  const filteredLogs = logState.logs.filter((log) =>
    log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.stream.toLowerCase().includes(searchQuery.toLowerCase())
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
          {logState.hasMore && !logState.loading && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Scroll up for more
            </Badge>
          )}
          {!logState.hasMore && logState.logs.length > 0 && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              All logs loaded
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
              {/* Loading indicator for older logs */}
              {loadingOlder && (
                <div className="flex items-center justify-center py-2 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading older logs...
                </div>
              )}

              {filteredLogs.map((log, index) => (
                <div
                  key={`${log.timestamp}-${log.stream}-${index}`}
                  className={cn(
                    'group rounded border-l-2 border-transparent px-3 py-1 hover:bg-muted/50',
                    log.message.includes('ERROR') && 'border-l-red-500 bg-red-500/5',
                    log.message.includes('WARN') && 'border-l-yellow-500 bg-yellow-500/5'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatDate(log.timestamp)}
                    </span>
                    <span className="shrink-0 text-xs text-blue-400">
                      [{log.stream.split('/').pop()}]
                    </span>
                    <span className="flex-1 break-words">{log.message}</span>
                  </div>
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
