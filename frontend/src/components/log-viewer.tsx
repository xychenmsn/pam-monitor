import { useState, useRef, useEffect } from 'react'
import { Search, Trash2, Loader2 } from 'lucide-react'
import { useAppLogsManager, type AppLogsState } from '@/hooks/useAppLogsManager'

interface LogViewerProps {
  appName: string
  appDisplayName: string
  environment: 'qa' | 'dev'
  initialStream?: string
  minimal?: boolean
}

export default function LogViewer({ appName, appDisplayName, environment, initialStream, minimal }: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const previousLogCount = useRef(0)

  const { initializeApp, getAppLogs, clearAppLogs, clearAllPolling } = useAppLogsManager()

  // Helper to format timestamp
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }

  // Clear all polling when environment changes
  useEffect(() => {
    return () => {
      clearAllPolling()
    }
  }, [environment, clearAllPolling])

  // Initialize app when component mounts or app changes
  useEffect(() => {
    initializeApp(appName, environment, initialStream)
    setInitialLoadDone(false)
  }, [appName, environment, initializeApp, initialStream])

  // Get current log state
  const logState: AppLogsState = getAppLogs(appName, environment)

  // Scroll to bottom when initial load completes
  useEffect(() => {
    if (!logState.loading && !initialLoadDone && logState.logs.length > 0) {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
      }
      setInitialLoadDone(true)
    }
  }, [logState.loading, initialLoadDone, logState.logs.length])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !logState.loading && logState.logs.length > previousLogCount.current && initialLoadDone) {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
      }
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
    <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300 font-sans">
      {/* Header */}
      {!minimal && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#404040]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{appDisplayName}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-[#404040] text-gray-400">
                {environment.toUpperCase()}
              </span>
            </div>
            {/* Connection Status */}
            <div className="flex items-center gap-2 text-xs">
              {logState.connected ? (
                <span className="flex items-center gap-1 text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                  POLLING ACTIVE (v2)
                </span>
              ) : logState.loading ? (
                <span className="text-yellow-400">Connecting...</span>
              ) : logState.error ? (
                <span className="text-red-400">Disconnected</span>
              ) : (
                <span className="text-gray-500">Offline</span>
              )}
              <span className="text-gray-500 ml-2">
                {filteredLogs.length} events
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Filter logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 bg-[#1e1e1e] border border-[#404040] rounded pl-8 pr-3 py-1 text-xs focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            <button
              onClick={() => clearAppLogs(appName, environment)}
              className="p-1.5 hover:bg-[#404040] rounded transition-colors text-gray-400 hover:text-white"
              title="Clear Logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {minimal && (
        <div className="flex items-center justify-between p-2 border-b border-[#333] bg-[#252525] text-xs">
          <div className="flex items-center gap-3">
            {logState.connected ? (
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-gray-600" />
            )}
            <span className="text-gray-500">{logState.connected ? "LIVE" : "PAUSED"}</span>
            {initialStream && <span className="font-mono opacity-50 truncate max-w-[200px]">Stream: {initialStream.split('/').pop()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#1a1a1a] border border-[#333] rounded px-2 py-1 focus:outline-none focus:border-blue-500 w-48"
            />
            <button
              onClick={() => clearAppLogs(appName, environment)}
              className="hover:text-red-400 p-1"
              title="Clear Logs"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Log Content */}
      <div
        ref={scrollAreaRef}
        className="flex-1 overflow-auto p-4 space-y-0.5 custom-scrollbar"
        onScroll={handleScroll}
      >
        {logState.loading && logState.logs.length === 0 && (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span>Connecting to Live Tail...</span>
          </div>
        )}

        {logState.error && (
          <div className="p-4 mb-4 bg-red-900/20 border border-red-900/50 rounded text-red-400 text-xs">
            Error: {logState.error}
          </div>
        )}

        {filteredLogs.map((log, index) => (
          <div
            key={`${log.timestamp}-${index}`}
            className="hover:bg-[#2d2d2d] px-2 py-0.5 rounded leading-relaxed break-all flex gap-3 group"
          >
            <span className="text-gray-500 shrink-0 select-none w-36 text-xs tabular-nums opacity-70 group-hover:opacity-100 transition-opacity">
              {formatTime(log.timestamp)}
            </span>
            <span className="text-gray-300">
              {log.message}
            </span>
          </div>
        ))}

        {/* End anchor */}
        <div ref={scrollRef} />
      </div>
    </div>
  )
}
