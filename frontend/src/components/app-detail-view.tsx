import { useState, useEffect } from 'react';
import { ArrowLeft, Activity, Box, Settings, FileText, AlertCircle, CheckCircle, Clock, RotateCcw } from 'lucide-react';
import LogViewer from './log-viewer';
import { cn } from '@/lib/utils';

interface AppDetailViewProps {
    appName: string;
    initialStream?: string;
    environment: 'qa' | 'dev';
    onBack: () => void;
}

interface AppDetails {
    overview: {
        status: string;
        runningCount: number;
        desiredCount: number;
        createdAt: string;
        clusterArn: string;
        serviceArn: string;
    };
    events: {
        id: string;
        createdAt: string;
        message: string;
    }[];
    tasks: {
        taskArn: string;
        lastStatus: string;
        healthStatus: string;
        startedAt?: string;
        ip?: string;
    }[];
    configuration: {
        image: string;
        cpu: string;
        memory: string;
        environment: Record<string, string>;
    };
}

export default function AppDetailView({ appName, initialStream, environment, onBack }: AppDetailViewProps) {
    const [activeTab, setActiveTab] = useState<'logs' | 'overview' | 'config'>('logs');
    const [details, setDetails] = useState<AppDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [restartSuccess, setRestartSuccess] = useState(false);

    useEffect(() => {
        if (activeTab === 'overview' || activeTab === 'config') {
            loadDetails();
        }
    }, [activeTab]);

    const loadDetails = async () => {
        setLoading(true);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/details?env=${environment}`);
            const data = await res.json();
            setDetails(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleRestart = async () => {
        if (!confirm(`Are you sure you want to restart ${appName} in ${environment.toUpperCase()}? This will trigger a rolling update.`)) {
            return;
        }

        setRestarting(true);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/restart?env=${environment}`, {
                method: 'POST'
            });
            if (res.ok) {
                setRestartSuccess(true);
                setTimeout(() => setRestartSuccess(false), 5000);
                // Refresh details after a delay to see the new deployment event
                setTimeout(loadDetails, 2000);
            } else {
                alert('Failed to restart service');
            }
        } catch (e) {
            console.error(e);
            alert('Error triggering restart');
        } finally {
            setRestarting(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300">
            {/* Header */}
            <div className="flex items-center gap-4 p-4 border-b border-[#333] bg-[#252525]">
                <button onClick={onBack} className="p-2 hover:bg-[#333] rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-400" />
                </button>
                <div>
                    <h1 className="text-xl font-bold text-white">{appName}</h1>
                    <span className="text-xs text-blue-400 font-mono">{environment.toUpperCase()}</span>
                </div>

                {/* Tabs */}
                <div className="flex ml-auto bg-[#1a1a1a] rounded-lg p-1">
                    {[
                        { id: 'logs', label: 'Logs', icon: FileText },
                        { id: 'overview', label: 'Overview', icon: Activity },
                        { id: 'config', label: 'Config', icon: Settings },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
                                activeTab === tab.id
                                    ? "bg-[#333] text-white shadow-sm"
                                    : "text-gray-500 hover:text-gray-300"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'logs' && (
                    <LogViewer
                        appName={appName}
                        appDisplayName={appName} // AppDetailView doesn't have display name yet, use id for now
                        initialStream={initialStream}
                        environment={environment}
                        minimal={true}
                    />
                )}

                {activeTab === 'overview' && (
                    <div className="p-8 overflow-auto h-full">
                        {loading && !details ? (
                            <div className="flex items-center justify-center h-64 text-gray-500">Loading vital signs...</div>
                        ) : details ? (
                            <div className="max-w-5xl mx-auto space-y-6">
                                {/* Vital Signs Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="bg-[#2d2d2d] p-5 rounded-xl border border-[#404040]">
                                        <div className="flex items-center justify-between mb-2">
                                            <h3 className="text-gray-400 text-sm font-medium flex items-center gap-2">
                                                <Activity className="w-4 h-4" /> Service Status
                                            </h3>
                                            <button
                                                onClick={handleRestart}
                                                disabled={restarting || restartSuccess}
                                                className={cn(
                                                    "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all",
                                                    restartSuccess
                                                        ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                        : "bg-[#333] hover:bg-[#444] text-gray-300 border border-[#404040]"
                                                )}
                                            >
                                                {restarting ? (
                                                    <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                                ) : restartSuccess ? (
                                                    <CheckCircle className="w-3 h-3" />
                                                ) : (
                                                    <RotateCcw className="w-3 h-3" />
                                                )}
                                                {restartSuccess ? 'Restart Triggered' : restarting ? 'Restarting...' : 'Restart Service'}
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className={cn("w-3 h-3 rounded-full", details.overview.runningCount > 0 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500")} />
                                            <span className="text-2xl font-bold text-white">{details.overview.status}</span>
                                        </div>
                                        <p className="text-sm text-gray-500 mt-1">Running: {details.overview.runningCount} / {details.overview.desiredCount}</p>
                                    </div>
                                    <div className="bg-[#2d2d2d] p-5 rounded-xl border border-[#404040]">
                                        <h3 className="text-gray-400 text-sm font-medium mb-2 flex items-center gap-2">
                                            <Box className="w-4 h-4" /> Task Health
                                        </h3>
                                        {details.tasks[0] ? (
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className={cn("text-xl font-bold", details.tasks[0].healthStatus === 'HEALTHY' ? "text-green-400" : "text-yellow-400")}>
                                                        {details.tasks[0].healthStatus || 'UNKNOWN'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 font-mono">{details.tasks[0].ip}</p>
                                            </div>
                                        ) : (
                                            <span className="text-gray-500 italic">No running tasks</span>
                                        )}
                                    </div>
                                    <div className="bg-[#2d2d2d] p-5 rounded-xl border border-[#404040]">
                                        <h3 className="text-gray-400 text-sm font-medium mb-2 flex items-center gap-2">
                                            <Clock className="w-4 h-4" /> Uptime
                                        </h3>
                                        <span className="text-xl font-bold text-white">
                                            {details.tasks[0]?.startedAt ? new Date(details.tasks[0].startedAt).toLocaleString() : 'N/A'}
                                        </span>
                                    </div>
                                </div>

                                {/* Events List */}
                                <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                    <div className="p-4 border-b border-[#404040] bg-[#333]">
                                        <h3 className="font-semibold text-white">Recent ECS Events</h3>
                                    </div>
                                    <div className="divide-y divide-[#404040]">
                                        {details.events.map(event => (
                                            <div key={event.id} className="p-4 hover:bg-[#353535] transition-colors flex gap-4">
                                                <span className="text-xs text-gray-500 whitespace-nowrap pt-1">
                                                    {new Date(event.createdAt).toLocaleTimeString()}
                                                </span>
                                                <p className="text-sm text-gray-300">{event.message}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}

                {activeTab === 'config' && (
                    <div className="p-8 overflow-auto h-full">
                        {details && (
                            <div className="max-w-4xl mx-auto bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                <div className="p-6 border-b border-[#404040]">
                                    <h2 className="text-xl font-bold text-white mb-1">Configuration Snapshot</h2>
                                    <p className="text-sm text-gray-400 font-mono">{details.configuration.image}</p>
                                </div>
                                <div className="p-6 grid grid-cols-2 gap-8">
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">Resources</h4>
                                        <div className="space-y-4">
                                            <div className="flex justify-between border-b border-[#404040] pb-2">
                                                <span className="text-gray-400">CPU</span>
                                                <span className="font-mono text-white">{details.configuration.cpu}</span>
                                            </div>
                                            <div className="flex justify-between border-b border-[#404040] pb-2">
                                                <span className="text-gray-400">Memory</span>
                                                <span className="font-mono text-white">{details.configuration.memory}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">Environment Limit</h4>
                                        <div className="bg-[#1a1a1a] p-3 rounded text-xs font-mono text-gray-400 max-h-60 overflow-auto">
                                            {/* Just showing count for now to avoid sensitive data leak in demo */}
                                            {Object.keys(details.configuration.environment).length} Variables Defined
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
