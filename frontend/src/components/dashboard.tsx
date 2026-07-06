import { useState, useEffect } from 'react'
import { Activity, Clock, Server, AlertCircle, RefreshCw } from 'lucide-react'
import { getDashboardStatus, type AppDashboardStatus } from '@/lib/cloudwatch'
import { cn } from '@/lib/utils'

interface DashboardProps {
    environment: 'qa' | 'dev' | 'prod'
    onAppSelect: (appName: string, initialStream?: string) => void
    isAuthError?: boolean
}

export default function Dashboard({ environment, onAppSelect, isAuthError }: DashboardProps) {
    const [status, setStatus] = useState<AppDashboardStatus[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

    const fetchStatus = async () => {
        try {
            setLoading(true)
            const data = await getDashboardStatus(environment)
            setStatus(data)
            setError(null)
            setLastUpdated(new Date())
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch status')
        } finally {
            setLoading(false)
        }
    }

    // Refresh on mount and when environment changes
    useEffect(() => {
        fetchStatus()
        // polling interval for dashboard freshness (every 30s)
        const interval = setInterval(fetchStatus, 30000)
        return () => clearInterval(interval)
    }, [environment])

    // Format relative time
    const getRelativeTime = (timestamp: number | null) => {
        if (!timestamp) return 'Never'
        const diff = Date.now() - timestamp
        if (diff < 60000) return 'Just now'
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
        return new Date(timestamp).toLocaleDateString()
    }

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300 font-sans p-6 overflow-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-2">System Status</h1>
                    <p className="text-gray-400 text-sm">
                        Real-time overview of log activity across {environment.toUpperCase()} environment
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-500">
                        Updated: {lastUpdated.toLocaleTimeString()}
                    </span>
                    <button
                        onClick={fetchStatus}
                        className="p-2 hover:bg-[#2d2d2d] rounded-full transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            {isAuthError && (
                <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-900/50 rounded-lg flex items-center gap-3 text-yellow-400">
                    <AlertCircle className="w-5 h-5" />
                    <div>
                        <p className="font-semibold">AWS Connection Required</p>
                        <p className="text-sm opacity-80">Real-time status and ECS data are currently unavailable. Please re-authenticate.</p>
                    </div>
                </div>
            )}

            {error && !isAuthError && (
                <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-3 text-red-400">
                    <AlertCircle className="w-5 h-5" />
                    <span>{error}</span>
                </div>
            )}

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {status.map((app) => (
                    <button
                        key={app.name}
                        onClick={() => onAppSelect(app.name, app.lastStreamName || undefined)}
                        className="flex flex-col text-left bg-[#2d2d2d] hover:bg-[#353535] border border-[#404040] hover:border-[#505050] rounded-xl p-5 transition-all group h-full"
                    >
                        <div className="flex items-start justify-between w-full mb-4">
                            <span className="font-semibold text-lg text-white group-hover:text-blue-400 transition-colors">
                                {app.displayName}
                            </span>
                            <div className={cn(
                                "flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium",
                                isAuthError ? "bg-gray-800 text-gray-400 border border-gray-700" :
                                    app.ecsStatus?.runningCount ? "bg-green-900/30 text-green-400 border border-green-900/50" : "bg-red-900/30 text-red-400 border border-red-900/50"
                            )}>
                                <div className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    isAuthError ? "bg-gray-500" :
                                        app.ecsStatus?.runningCount ? "bg-green-400 animate-pulse" : "bg-red-400"
                                )} />
                                {isAuthError ? "OFFLINE" :
                                    app.ecsStatus ? (app.ecsStatus.runningCount > 0 ? "RUNNING" : "STOPPED") : "UNKNOWN"}
                            </div>
                        </div>

                        <div className="space-y-3 w-full flex-1">
                            {/* ECS Service Detail */}
                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Activity className="w-4 h-4" />
                                    <span>Task Count</span>
                                </div>
                                <span className="font-mono text-gray-200">
                                    {app.ecsStatus ? `${app.ecsStatus.runningCount}/${app.ecsStatus.desiredCount}` : '-/-'}
                                </span>
                            </div>

                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Server className="w-4 h-4" />
                                    <span>Active Streams</span>
                                </div>
                                <span className={cn(
                                    "font-mono font-medium",
                                    app.activeStreamCount > 0 ? "text-gray-200" : "text-yellow-500"
                                )}>
                                    {app.activeStreamCount}
                                </span>
                            </div>

                            <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 text-gray-400">
                                    <Clock className="w-4 h-4" />
                                    <span>Last Log</span>
                                </div>
                                <span className="font-mono text-gray-200">
                                    {getRelativeTime(app.lastActivityTime)}
                                </span>
                            </div>

                            {/* ECS Event Snippet */}
                            {app.ecsStatus?.events?.[0] && (
                                <div className="mt-2 text-xs text-gray-500 bg-[#252525] p-2 rounded border border-[#333] truncate">
                                    {app.ecsStatus.events[0]}
                                </div>
                            )}
                        </div>
                    </button>
                ))}
            </div>
        </div>
    )
}
