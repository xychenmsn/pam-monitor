import { useState, useRef, useEffect } from 'react'
import { Search, Trash2, Loader2, ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { useSimpleLogStream, type ApiCall } from '@/hooks/useSimpleLogStream'
import { cn } from '@/lib/utils'

interface SimpleLogViewerProps {
    appName: string
    appDisplayName: string
    environment: 'qa' | 'dev'
}

function ApiCallItem({ call }: { call: ApiCall }) {
    const statusColor = {
        pending: 'text-yellow-500',
        success: 'text-green-500',
        error: 'text-red-500',
    }[call.status]

    const time = new Date(call.timestamp).toLocaleTimeString()

    return (
        <div className="flex items-start gap-2 py-1 text-xs font-mono border-b border-border/50 last:border-0">
            <span className="text-muted-foreground w-20 shrink-0">{time}</span>
            <span className={cn('w-12 shrink-0', statusColor)}>
                {call.status === 'pending' ? '...' : call.duration ? `${call.duration}ms` : '-'}
            </span>
            <span className="text-blue-400">{call.method}</span>
            <span className="text-foreground truncate flex-1">{call.endpoint}</span>
            {call.error && (
                <span className="text-red-400 truncate max-w-48">{call.error}</span>
            )}
        </div>
    )
}

export default function SimpleLogViewer({ appName, appDisplayName, environment }: SimpleLogViewerProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [autoScroll, setAutoScroll] = useState(true)
    const [debugPanelOpen, setDebugPanelOpen] = useState(true)
    const scrollRef = useRef<HTMLDivElement>(null)
    const previousLogCount = useRef(0)
    const currentAppRef = useRef<string>('')
    const currentEnvRef = useRef<'qa' | 'dev'>('qa')

    const {
        logs,
        apiCalls,
        loading,
        error,
        currentStream,
        loadLogs,
        clearLogs,
        clearApiCalls,
    } = useSimpleLogStream()

    // Load logs when app or environment changes - use refs to prevent re-running
    useEffect(() => {
        if (currentAppRef.current !== appName || currentEnvRef.current !== environment) {
            currentAppRef.current = appName
            currentEnvRef.current = environment
            loadLogs(appName, environment)
        }
    }, [appName, environment, loadLogs])

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (autoScroll && logs.length > previousLogCount.current) {
            scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        }
        previousLogCount.current = logs.length
    }, [logs.length, autoScroll])

    // Handle manual scroll
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement
        const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100
        setAutoScroll(isNearBottom)
    }

    // Filter logs by search query
    const filteredLogs = logs.filter((log) =>
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
                    {currentStream && (
                        <Badge variant="secondary" className="text-xs max-w-64 truncate">
                            Stream: {currentStream.split('/').pop()}
                        </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">
                        {filteredLogs.length} logs
                    </Badge>
                    {loading && (
                        <Badge variant="outline" className="gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading
                        </Badge>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {logs.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={clearLogs} className="gap-1">
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

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Logs Area - Scrollable */}
                <ScrollArea className="flex-1" onScroll={handleScroll}>
                    <div className="space-y-0 p-4 font-mono text-sm">
                        {loading && logs.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-muted-foreground py-8">
                                <div className="text-center">
                                    <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin" />
                                    <p>Loading logs...</p>
                                    <p className="text-xs mt-2">Check the API debug panel below</p>
                                </div>
                            </div>
                        ) : error ? (
                            <div className="flex h-full items-center justify-center text-destructive py-8">
                                <div className="text-center">
                                    <p className="font-semibold">Error loading logs</p>
                                    <p className="text-sm">{error}</p>
                                </div>
                            </div>
                        ) : filteredLogs.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-muted-foreground py-8">
                                {searchQuery ? 'No logs match your search' : 'No logs available'}
                            </div>
                        ) : (
                            <>
                                {filteredLogs.map((log, index) => (
                                    <div
                                        key={`${log.timestamp}-${index}`}
                                        className={cn(
                                            'rounded px-3 py-1 hover:bg-muted/50',
                                            log.message.includes('ERROR') && 'bg-red-500/10',
                                            log.message.includes('WARN') && 'bg-yellow-500/10'
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

                {/* API Debug Panel */}
                <div className="border-t bg-muted/20">
                    <button
                        onClick={() => setDebugPanelOpen(!debugPanelOpen)}
                        className="flex w-full items-center justify-between px-4 py-2 hover:bg-muted/40"
                    >
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Terminal className="h-4 w-4" />
                            API Calls
                            <Badge variant="outline" className="text-xs">
                                {apiCalls.length}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                            {apiCalls.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        clearApiCalls()
                                    }}
                                    className="h-6 px-2 text-xs"
                                >
                                    Clear
                                </Button>
                            )}
                            {debugPanelOpen ? (
                                <ChevronDown className="h-4 w-4" />
                            ) : (
                                <ChevronUp className="h-4 w-4" />
                            )}
                        </div>
                    </button>

                    {debugPanelOpen && (
                        <ScrollArea className="h-40 border-t">
                            <div className="p-2">
                                {apiCalls.length === 0 ? (
                                    <div className="text-center text-muted-foreground text-sm py-4">
                                        No API calls yet
                                    </div>
                                ) : (
                                    apiCalls.map((call) => (
                                        <ApiCallItem key={call.id} call={call} />
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </div>
            </div>
        </div>
    )
}
