import { useState, useEffect } from 'react';
import { ArrowLeft, Activity, Box, Settings, FileText, CheckCircle, Clock, RotateCcw, Shield, Layers, AlertCircle, KeyRound, Eye, EyeOff, Copy, Check, Calendar, Play, RefreshCw } from 'lucide-react';
import LogViewer from './log-viewer';
import ConfirmationModal from './confirmation-modal';
import { cn } from '@/lib/utils';

interface AppDetailViewProps {
    appName: string;
    initialStream?: string;
    environment: 'qa' | 'dev';
    onBack: () => void;
    isAuthError?: boolean;
}

interface AppDetails {
    overview: {
        status: string;
        displayName?: string;
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
        taskDefinitionArn: string;
        image: string;
        cpu: string;
        memory: string;
        environment: Record<string, string>;
    };
    deployments: {
        id: string;
        status: string;
        taskDefinition: string;
        desiredCount: number;
        pendingCount: number;
        runningCount: number;
        rolloutState?: string;
        rolloutStateReason?: string;
        createdAt: string;
        updatedAt: string;
    }[];
}

interface SecretEntry {
    key: string;
    value: string;
}

interface SecretsResult {
    secretId: string;
    entries: SecretEntry[];
    error?: string;
}

interface SchedulerRuleInfo {
    name: string;
    arn: string;
    scheduleExpression: string;
    state: string;
    targets: {
        id: string;
        taskDefinitionArn: string;
        taskCount: number;
        subnets: string[];
        securityGroups: string[];
    }[];
}

export default function AppDetailView({ appName, initialStream, environment, onBack, isAuthError }: AppDetailViewProps) {
    const [activeTab, setActiveTab] = useState<'logs' | 'infra' | 'events' | 'config' | 'secrets' | 'scheduler'>('logs');
    const [details, setDetails] = useState<AppDetails | null>(null);
    const [loading, setLoading] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [restartSuccess, setRestartSuccess] = useState(false);
    const [showRestartConfirm, setShowRestartConfirm] = useState(false);

    // Scheduler tab state
    const [schedulerRule, setSchedulerRule] = useState<SchedulerRuleInfo | null>(null);
    const [schedulerLoading, setSchedulerLoading] = useState(false);
    const [schedulerError, setSchedulerError] = useState<string | null>(null);
    const [editSchedule, setEditSchedule] = useState('');
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [saveScheduleSuccess, setSaveScheduleSuccess] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [triggerResult, setTriggerResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);

    // Secrets tab state
    const [secrets, setSecrets] = useState<SecretsResult | null>(null);
    const [secretsLoading, setSecretsLoading] = useState(false);
    const [secretsError, setSecretsError] = useState<string | null>(null);
    const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    useEffect(() => {
        if (isAuthError) return;
        loadDetails();
        // Set up polling for vitals
        const interval = setInterval(loadDetails, 30000);
        return () => clearInterval(interval);
    }, [appName, environment, isAuthError]);

    const loadDetails = async () => {
        if (isAuthError) return;
        setLoading(true);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/details?env=${environment}`);
            if (!res.ok) throw new Error('Failed to fetch details');
            const data = await res.json();
            setDetails(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleRestart = async () => {
        setRestarting(true);
        setShowRestartConfirm(false);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/restart?env=${environment}`, {
                method: 'POST'
            });
            if (res.ok) {
                setRestartSuccess(true);
                setTimeout(() => setRestartSuccess(false), 5000);
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

    const loadSecrets = async () => {
        if (isAuthError) return;
        setSecretsLoading(true);
        setSecretsError(null);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/secrets?env=${environment}`);
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setSecretsError(data.error || `HTTP ${res.status}`);
                return;
            }
            const data: SecretsResult = await res.json();
            setSecrets(data);
        } catch (e: any) {
            setSecretsError(e.message || 'Unknown error');
        } finally {
            setSecretsLoading(false);
        }
    };

    // Lazy-load secrets only when tab is opened for the first time
    useEffect(() => {
        if (activeTab === 'secrets' && !secrets && !secretsLoading) {
            loadSecrets();
        }
    }, [activeTab]);

    // Reset secrets when app or env changes
    useEffect(() => {
        setSecrets(null);
        setSecretsError(null);
        setRevealedKeys(new Set());
        setSchedulerRule(null);
        setSchedulerError(null);
        setTriggerResult(null);
    }, [appName, environment]);

    const loadScheduler = async (schedulerRuleName: string) => {
        setSchedulerLoading(true);
        setSchedulerError(null);
        try {
            const res = await fetch(`http://localhost:31191/api/scheduler/${schedulerRuleName}?env=${environment}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: SchedulerRuleInfo = await res.json();
            setSchedulerRule(data);
            setEditSchedule(data.scheduleExpression);
        } catch (e: any) {
            setSchedulerError(e.message || 'Failed to load scheduler rule');
        } finally {
            setSchedulerLoading(false);
        }
    };

    // Load scheduler when tab opens — only for scheduled tasks
    useEffect(() => {
        if (activeTab === 'scheduler' && !schedulerRule && !schedulerLoading) {
            // Find schedulerRule from app config via details — use a naming convention
            // For PSI the rule is psiqa-task-scheduler (env-prefixed)
            const ruleName = `psi${environment}-task-scheduler`;
            loadScheduler(ruleName);
        }
    }, [activeTab]);

    const handleSaveSchedule = async () => {
        if (!schedulerRule) return;
        setSavingSchedule(true);
        setSaveScheduleSuccess(false);
        try {
            const res = await fetch(`http://localhost:31191/api/scheduler/${schedulerRule.name}?env=${environment}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scheduleExpression: editSchedule }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setSaveScheduleSuccess(true);
            // Reload to confirm
            await loadScheduler(schedulerRule.name);
            setTimeout(() => setSaveScheduleSuccess(false), 4000);
        } catch (e: any) {
            setSchedulerError(e.message || 'Failed to update schedule');
        } finally {
            setSavingSchedule(false);
        }
    };

    const handleTrigger = async () => {
        setShowTriggerConfirm(false);
        setTriggering(true);
        setTriggerResult(null);
        try {
            const res = await fetch(`http://localhost:31191/api/apps/${appName}/trigger?env=${environment}`, {
                method: 'POST',
            });
            const data = await res.json();
            setTriggerResult({ success: res.ok, message: data.message || data.error || 'Unknown result' });
            if (res.ok) setTimeout(() => setTriggerResult(null), 8000);
        } catch (e: any) {
            setTriggerResult({ success: false, message: e.message || 'Trigger failed' });
        } finally {
            setTriggering(false);
        }
    };


    const toggleReveal = (key: string) => {
        setRevealedKeys(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const copyToClipboard = async (key: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 2000);
        } catch {
            // Fallback
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300">
            {/* Nav Header */}
            <div className="flex items-center gap-4 p-4 border-b border-[#333] bg-[#252525]">
                <button onClick={onBack} className="p-2 hover:bg-[#333] rounded-full transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-400" />
                </button>
                <div>
                    <h1 className="text-xl font-bold text-white">
                        {details?.overview.displayName || appName}
                    </h1>
                    <span className="text-xs text-blue-400 font-mono">{environment.toUpperCase()}</span>
                </div>
            </div>

            {/* Overview Header (Persistent) */}
            <div className="bg-[#252525] border-b border-[#333] p-6">
                {isAuthError && (
                    <div className="mb-4 p-4 bg-yellow-900/20 border border-yellow-900/50 rounded-lg flex items-center gap-3 text-yellow-400">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold text-sm">AWS Connection Lost</p>
                            <p className="text-xs opacity-80">ECS vitals and infrastructure data cannot be updated until credentials are refreshed.</p>
                        </div>
                    </div>
                )}

                {!details && loading && !isAuthError ? (
                    <div className="flex items-center justify-center p-8 text-gray-500 italic">
                        Loading vitals...
                    </div>
                ) : details ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-[#2d2d2d] p-4 rounded-xl border border-[#404040]">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
                                    <Activity className="w-4 h-4" /> Service Status
                                </h3>
                                {/* Hide Restart for scheduled tasks */}
                                {details.overview.status !== 'SCHEDULED' && details.overview.status !== 'STOPPED' && (
                                    <button
                                        onClick={() => setShowRestartConfirm(true)}
                                        disabled={restarting || restartSuccess || details.deployments[0]?.rolloutState === 'IN_PROGRESS'}
                                        className={cn(
                                            "flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all text-nowrap",
                                            restartSuccess || details.deployments[0]?.rolloutState === 'IN_PROGRESS'
                                                ? "bg-green-500/20 text-green-400 border border-green-500/50"
                                                : "bg-[#333] hover:bg-[#444] text-gray-300 border border-[#404040]"
                                        )}
                                    >
                                        {restarting ? (
                                            <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                        ) : restartSuccess ? (
                                            <CheckCircle className="w-3 h-3" />
                                        ) : details.deployments[0]?.rolloutState === 'IN_PROGRESS' ? (
                                            <div className="w-3 h-3 border-2 border-green-500/30 border-t-green-500 rounded-full animate-spin" />
                                        ) : (
                                            <RotateCcw className="w-3 h-3" />
                                        )}
                                        {restarting
                                            ? 'Restarting...'
                                            : restartSuccess
                                                ? 'Restart Triggered'
                                                : details.deployments[0]?.rolloutState === 'IN_PROGRESS'
                                                    ? 'Deploying...'
                                                    : 'Restart'}
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <div className={cn("w-3 h-3 rounded-full", details.overview.runningCount > 0 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" : "bg-red-500")} />
                                <span className="text-2xl font-bold text-white tracking-tight">{details.overview.status}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 uppercase font-medium">Running: <span className="text-gray-300">{details.overview.runningCount} / {details.overview.desiredCount} Tasks</span></p>
                        </div>

                        <div className="bg-[#2d2d2d] p-4 rounded-xl border border-[#404040]">
                            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Box className="w-4 h-4" /> Task Health
                            </h3>
                            {details.tasks[0] ? (
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={cn("text-xl font-bold", details.tasks[0].healthStatus === 'HEALTHY' ? "text-green-400" : "text-yellow-400")}>
                                            {details.tasks[0].healthStatus || 'UNKNOWN'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 font-mono tracking-tight">{details.tasks[0].ip}</p>
                                </div>
                            ) : (
                                <span className="text-gray-500 italic text-sm">No running tasks</span>
                            )}
                        </div>

                        <div className="bg-[#2d2d2d] p-4 rounded-xl border border-[#404040]">
                            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Clock className="w-4 h-4" /> Last Deploy / Uptime
                            </h3>
                            <div className="text-white text-lg font-bold leading-tight">
                                {details.tasks[0]?.startedAt ? new Date(details.tasks[0].startedAt).toLocaleString() : 'N/A'}
                            </div>
                            <p className="text-xs text-gray-500 mt-1 uppercase font-medium">Deployment Date</p>
                        </div>
                    </div>
                ) : (
                    <div className="text-red-400 text-sm">Failed to load app details.</div>
                )}
            </div>

            {/* Tab Bar Slider */}
            <div className="bg-[#252525] border-b border-[#333] px-4 flex items-center justify-between">
                <div className="flex">
                    {[
                        { id: 'logs', label: 'Logs', icon: FileText },
                        { id: 'infra', label: 'Infrastructure', icon: Layers },
                        { id: 'events', label: 'ECS Events', icon: Activity },
                        { id: 'config', label: 'Config', icon: Settings },
                        { id: 'secrets', label: 'Secrets', icon: KeyRound },
                        // Only show Scheduler tab for scheduled task apps (PSI)
                        ...(details?.overview.status === 'SCHEDULED' || details?.overview.status === 'STOPPED'
                            ? [{ id: 'scheduler', label: 'Scheduler', icon: Calendar }]
                            : []),
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={cn(
                                "flex items-center gap-2 px-6 py-4 relative font-medium text-sm transition-all",
                                activeTab === tab.id
                                    ? "text-blue-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-blue-400"
                                    : "text-gray-500 hover:text-gray-300"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'logs' && (
                    <LogViewer
                        appName={appName}
                        appDisplayName={appName}
                        initialStream={initialStream}
                        environment={environment}
                        minimal={true}
                    />
                )}

                {activeTab === 'infra' && (
                    <div className="p-8 overflow-auto h-full bg-[#1a1a1a]">
                        {details && (
                            <div className="max-w-5xl mx-auto space-y-8">
                                <h2 className="text-2xl font-bold text-white mb-6">Infrastructure & Deployments</h2>

                                {/* ARNs Section */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-[#2d2d2d] p-5 rounded-xl border border-[#404040]">
                                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Core Resources</h3>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-xs text-gray-500 block mb-1">Cluster ARN</label>
                                                <div className="font-mono text-[11px] text-gray-300 bg-[#1a1a1a] p-2 rounded break-all border border-[#333]">
                                                    {details.overview.clusterArn}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 block mb-1">Service ARN</label>
                                                <div className="font-mono text-[11px] text-gray-300 bg-[#1a1a1a] p-2 rounded break-all border border-[#333]">
                                                    {details.overview.serviceArn}
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 block mb-1">Active Task Definition</label>
                                                <div className="font-mono text-[11px] text-blue-400 bg-[#1a1a1a] p-2 rounded break-all border border-[#333]">
                                                    {details.configuration.taskDefinitionArn}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-[#2d2d2d] p-5 rounded-xl border border-[#404040]">
                                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Runtime State</h3>
                                        <div className="space-y-4">
                                            <div className="flex justify-between items-center pb-2 border-b border-[#333]">
                                                <span className="text-sm text-gray-400">Desired Tasks</span>
                                                <span className="text-xl font-bold text-white">{details.overview.desiredCount}</span>
                                            </div>
                                            <div className="flex justify-between items-center pb-2 border-b border-[#333]">
                                                <span className="text-sm text-gray-400">Running Tasks</span>
                                                <span className="text-xl font-bold text-green-400">{details.overview.runningCount}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm text-gray-400">Pending Tasks</span>
                                                <span className="text-xl font-bold text-yellow-400">{details.deployments[0]?.pendingCount || 0}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Deployment Rollout */}
                                <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                    <div className="p-4 bg-[#333] border-b border-[#404040] flex justify-between items-center">
                                        <h3 className="font-semibold text-white">Active Deployments</h3>
                                        <Shield className="w-4 h-4 text-blue-400" />
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-[#252525] text-xs uppercase text-gray-500 font-semibold">
                                                    <th className="px-4 py-3 border-b border-[#404040]">Status</th>
                                                    <th className="px-4 py-3 border-b border-[#404040]">Task Definition</th>
                                                    <th className="px-4 py-3 border-b border-[#404040]">Tasks (R/D)</th>
                                                    <th className="px-4 py-3 border-b border-[#404040]">Rollout</th>
                                                    <th className="px-4 py-3 border-b border-[#404040]">Started</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#404040]">
                                                {details.deployments.map(dep => (
                                                    <tr key={dep.id} className="hover:bg-[#353535] transition-colors text-sm">
                                                        <td className="px-4 py-4">
                                                            <span className={cn(
                                                                "px-2 py-1 rounded text-[10px] font-bold uppercase",
                                                                dep.status === 'PRIMARY' ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "bg-gray-500/20 text-gray-400 border border-gray-500/40"
                                                            )}>
                                                                {dep.status}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-4 font-mono text-xs text-gray-300">
                                                            {dep.taskDefinition.split('/').pop()}
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-white">{dep.runningCount}</span>
                                                                <span className="text-gray-500 text-xs">/ {dep.desiredCount}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-4">
                                                            {dep.rolloutState ? (
                                                                <div className="flex flex-col gap-1">
                                                                    <span className={cn(
                                                                        "text-[10px] font-bold",
                                                                        dep.rolloutState === 'COMPLETED' ? "text-green-400" :
                                                                            dep.rolloutState === 'FAILED' ? "text-red-400" : "text-blue-400"
                                                                    )}>
                                                                        {dep.rolloutState}
                                                                    </span>
                                                                    {dep.rolloutStateReason && (
                                                                        <span className="text-[10px] text-gray-500 leading-tight max-w-[150px] truncate" title={dep.rolloutStateReason}>
                                                                            {dep.rolloutStateReason}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-500 text-xs">-</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-4 text-xs text-gray-500">
                                                            {new Date(dep.createdAt).toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'events' && (
                    <div className="p-8 overflow-auto h-full bg-[#1a1a1a]">
                        {details && (
                            <div className="max-w-5xl mx-auto space-y-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="text-xl font-bold text-white">Recent ECS Events</h2>
                                    <button
                                        onClick={loadDetails}
                                        className="text-xs text-blue-400 hover:text-blue-300 underline"
                                    >
                                        Refresh Events
                                    </button>
                                </div>
                                <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                    <div className="divide-y divide-[#404040]">
                                        {details.events.length > 0 ? (
                                            details.events.map(event => (
                                                <div key={event.id} className="p-4 hover:bg-[#353535] transition-colors flex gap-4 items-start">
                                                    <div className="pt-1">
                                                        <Activity className="w-4 h-4 text-blue-400" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="flex justify-between items-center mb-1">
                                                            <span className="text-xs text-gray-500 font-mono">
                                                                {new Date(event.createdAt).toLocaleString()}
                                                            </span>
                                                        </div>
                                                        <p className="text-sm text-gray-300 leading-relaxed font-sans">{event.message}</p>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="p-12 text-center text-gray-500 italic">No recent events found.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'config' && (
                    <div className="p-8 overflow-auto h-full bg-[#1a1a1a]">
                        {details && (
                            <div className="max-w-4xl mx-auto space-y-6">
                                <h2 className="text-xl font-bold text-white px-2">Deployment Configuration</h2>
                                <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                    <div className="p-6 border-b border-[#404040] bg-[#333]">
                                        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">Docker Image</h3>
                                        <p className="text-blue-400 font-mono text-sm break-all">{details.configuration.image}</p>
                                    </div>
                                    <div className="p-6 grid grid-cols-2 gap-8">
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Resources</h4>
                                            <div className="space-y-4">
                                                <div className="flex justify-between border-b border-[#404040] pb-2">
                                                    <span className="text-gray-400 text-sm">CPU Units</span>
                                                    <span className="font-mono text-white font-bold">{details.configuration.cpu}</span>
                                                </div>
                                                <div className="flex justify-between border-b border-[#404040] pb-2">
                                                    <span className="text-gray-400 text-sm">Memory (MiB)</span>
                                                    <span className="font-mono text-white font-bold">{details.configuration.memory}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Environment Information</h4>
                                            <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333]">
                                                <div className="flex items-center justify-between text-gray-400 text-xs mb-2">
                                                    <span>Variables Count</span>
                                                    <span className="text-white font-mono">{Object.keys(details.configuration.environment).length}</span>
                                                </div>
                                                <div className="w-full bg-[#333] h-1.5 rounded-full overflow-hidden">
                                                    <div className="bg-blue-500 h-full w-2/3" />
                                                </div>
                                                <p className="text-[10px] text-gray-500 mt-2 italic">* Sensitive variables are hidden in dashboard view.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'secrets' && (
                    <div className="p-8 overflow-auto h-full bg-[#1a1a1a]">
                        <div className="max-w-4xl mx-auto space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <KeyRound className="w-5 h-5 text-yellow-400" />
                                    Secrets Manager
                                </h2>
                                <button
                                    onClick={loadSecrets}
                                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                                >
                                    Refresh
                                </button>
                            </div>

                            {/* Warning banner */}
                            <div className="flex items-start gap-3 p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-xl text-yellow-400">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <div className="text-xs leading-relaxed">
                                    <span className="font-semibold">Live secrets — handle with care.</span>{' '}
                                    These values are fetched directly from AWS Secrets Manager ({secrets?.secretId ?? `pam/${environment}/${appName}`}). All values are masked by default.
                                </div>
                            </div>

                            {secretsLoading && (
                                <div className="flex items-center justify-center p-16 text-gray-500 italic">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-6 h-6 border-2 border-gray-600 border-t-yellow-400 rounded-full animate-spin" />
                                        Fetching secrets...
                                    </div>
                                </div>
                            )}

                            {secretsError && !secretsLoading && (
                                <div className="p-6 bg-red-900/20 border border-red-700/40 rounded-xl text-red-400 text-sm flex items-start gap-3">
                                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="font-semibold mb-1">Failed to load secrets</p>
                                        <p className="text-xs opacity-80 font-mono">{secretsError}</p>
                                    </div>
                                </div>
                            )}

                            {secrets && !secretsLoading && (
                                secrets.error ? (
                                    <div className="p-6 bg-orange-900/20 border border-orange-700/40 rounded-xl text-orange-400 text-sm">
                                        {secrets.error}
                                    </div>
                                ) : secrets.entries.length === 0 ? (
                                    <div className="p-12 text-center text-gray-500 italic">No secrets found in this secret.</div>
                                ) : (
                                    <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                        <div className="px-4 py-3 bg-[#333] border-b border-[#404040] flex items-center justify-between">
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                                {secrets.entries.length} keys · <span className="font-mono text-gray-500">{secrets.secretId}</span>
                                            </span>
                                            <span className="text-[10px] text-gray-600 italic">Click <Eye className="w-3 h-3 inline" /> to reveal</span>
                                        </div>
                                        <div className="divide-y divide-[#404040]">
                                            {secrets.entries.map(entry => {
                                                const isRevealed = revealedKeys.has(entry.key);
                                                const isCopied = copiedKey === entry.key;
                                                return (
                                                    <div key={entry.key} className="flex items-center gap-3 px-4 py-3 hover:bg-[#333] transition-colors group">
                                                        {/* Key */}
                                                        <span className="font-mono text-xs text-blue-300 w-64 flex-shrink-0 truncate" title={entry.key}>
                                                            {entry.key}
                                                        </span>

                                                        {/* Value */}
                                                        <div className="flex-1 font-mono text-xs bg-[#1a1a1a] border border-[#404040] rounded px-3 py-1.5 text-gray-300 overflow-hidden">
                                                            {isRevealed ? (
                                                                <span className="break-all">{entry.value}</span>
                                                            ) : (
                                                                <span className="tracking-widest text-gray-600 select-none">{'•'.repeat(Math.min(entry.value.length, 32))}</span>
                                                            )}
                                                        </div>

                                                        {/* Actions */}
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            <button
                                                                onClick={() => toggleReveal(entry.key)}
                                                                title={isRevealed ? 'Hide' : 'Reveal'}
                                                                className="p-1.5 rounded hover:bg-[#444] text-gray-500 hover:text-gray-300 transition-colors"
                                                            >
                                                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                            </button>
                                                            <button
                                                                onClick={() => copyToClipboard(entry.key, entry.value)}
                                                                title="Copy value"
                                                                className={cn(
                                                                    "p-1.5 rounded transition-colors",
                                                                    isCopied
                                                                        ? "text-green-400"
                                                                        : "text-gray-500 hover:text-gray-300 hover:bg-[#444]"
                                                                )}
                                                            >
                                                                {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'scheduler' && (
                    <div className="p-8 overflow-auto h-full bg-[#1a1a1a]">
                        <div className="max-w-2xl mx-auto space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Calendar className="w-5 h-5 text-blue-400" />
                                    CloudWatch Scheduler
                                </h2>
                                <button
                                    onClick={() => schedulerRule && loadScheduler(schedulerRule.name)}
                                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3 h-3" /> Refresh
                                </button>
                            </div>

                            {/* Info banner */}
                            <div className="flex items-start gap-3 p-4 bg-blue-900/20 border border-blue-700/40 rounded-xl text-blue-300">
                                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <div className="text-xs leading-relaxed">
                                    <span className="font-semibold">PSI is a scheduled batch job.</span>{' '}
                                    It starts automatically on a schedule, runs to completion, and exits. Each run is a fresh container — no persistent service to restart. Use <span className="font-mono bg-blue-900/40 px-1 rounded">Run Now</span> to trigger an immediate run outside the schedule.
                                </div>
                            </div>

                            {schedulerLoading && (
                                <div className="flex items-center justify-center p-16 text-gray-500 italic">
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />
                                        Loading scheduler rule...
                                    </div>
                                </div>
                            )}

                            {schedulerError && !schedulerLoading && (
                                <div className="p-4 bg-red-900/20 border border-red-700/40 rounded-xl text-red-400 text-sm flex items-center gap-3">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    {schedulerError}
                                </div>
                            )}

                            {schedulerRule && !schedulerLoading && (
                                <>
                                    {/* Rule Status */}
                                    <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                        <div className="px-4 py-3 bg-[#333] border-b border-[#404040]">
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Rule Details</span>
                                        </div>
                                        <div className="p-5 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-gray-400">Rule Name</span>
                                                <span className="font-mono text-sm text-white">{schedulerRule.name}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-gray-400">State</span>
                                                <div className="flex items-center gap-3">
                                                    <span className={cn(
                                                        "text-xs font-bold px-2 py-1 rounded uppercase",
                                                        schedulerRule.state === 'ENABLED'
                                                            ? "bg-green-500/20 text-green-400 border border-green-500/40"
                                                            : "bg-red-500/20 text-red-400 border border-red-500/40"
                                                    )}>
                                                        {schedulerRule.state}
                                                    </span>
                                                    <button
                                                        onClick={async () => {
                                                            const isEnabled = schedulerRule.state === 'ENABLED';
                                                            const action = isEnabled ? 'disable' : 'enable';
                                                            try {
                                                                const res = await fetch(
                                                                    `http://localhost:31191/api/scheduler/${schedulerRule.name}/${action}`,
                                                                    { method: 'POST' }
                                                                );
                                                                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                                                // Optimistically update state, then refresh
                                                                setSchedulerRule(prev => prev ? { ...prev, state: isEnabled ? 'DISABLED' : 'ENABLED' } : prev);
                                                                setTimeout(() => loadScheduler(schedulerRule.name), 1000);
                                                            } catch (e: any) {
                                                                setSchedulerError(e.message || `Failed to ${action} rule`);
                                                            }
                                                        }}
                                                        className={cn(
                                                            "text-xs font-semibold px-3 py-1 rounded transition-all border",
                                                            schedulerRule.state === 'ENABLED'
                                                                ? "bg-red-900/20 hover:bg-red-900/40 text-red-400 border-red-700/40"
                                                                : "bg-green-900/20 hover:bg-green-900/40 text-green-400 border-green-700/40"
                                                        )}
                                                    >
                                                        {schedulerRule.state === 'ENABLED' ? 'Disable' : 'Enable'}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-gray-400">Task Count</span>
                                                <span className="font-mono text-white">{schedulerRule.targets[0]?.taskCount ?? '—'}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Schedule Expression Editor */}
                                    <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                        <div className="px-4 py-3 bg-[#333] border-b border-[#404040]">
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Schedule Expression</span>
                                        </div>
                                        <div className="p-5">
                                            <p className="text-xs text-gray-500 mb-3">
                                                Use <span className="font-mono bg-[#1a1a1a] px-1 rounded">rate(N minutes)</span>,{' '}
                                                <span className="font-mono bg-[#1a1a1a] px-1 rounded">rate(N hours)</span>, or{' '}
                                                <span className="font-mono bg-[#1a1a1a] px-1 rounded">cron(0 * * * ? *)</span>
                                            </p>
                                            <div className="flex gap-3">
                                                <input
                                                    type="text"
                                                    value={editSchedule}
                                                    onChange={(e) => setEditSchedule(e.target.value)}
                                                    className="flex-1 bg-[#1a1a1a] border border-[#404040] rounded-lg px-4 py-2.5 font-mono text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                                                    placeholder="e.g. rate(10 minutes)"
                                                />
                                                <button
                                                    onClick={handleSaveSchedule}
                                                    disabled={savingSchedule || editSchedule === schedulerRule.scheduleExpression}
                                                    className={cn(
                                                        "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
                                                        saveScheduleSuccess
                                                            ? "bg-green-500/20 text-green-400 border border-green-500/40"
                                                            : editSchedule === schedulerRule.scheduleExpression
                                                                ? "bg-[#333] text-gray-600 border border-[#404040] cursor-not-allowed"
                                                                : "bg-blue-600 hover:bg-blue-500 text-white border border-blue-500"
                                                    )}
                                                >
                                                    {savingSchedule ? (
                                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    ) : saveScheduleSuccess ? (
                                                        <CheckCircle className="w-4 h-4" />
                                                    ) : null}
                                                    {savingSchedule ? 'Saving...' : saveScheduleSuccess ? 'Saved!' : 'Update'}
                                                </button>
                                            </div>
                                            {schedulerRule.scheduleExpression !== editSchedule && (
                                                <p className="text-xs text-yellow-400 mt-2 flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3" /> Current: <span className="font-mono">{schedulerRule.scheduleExpression}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Run Now */}
                                    <div className="bg-[#2d2d2d] rounded-xl border border-[#404040] overflow-hidden">
                                        <div className="px-4 py-3 bg-[#333] border-b border-[#404040]">
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Manual Trigger</span>
                                        </div>
                                        <div className="p-5">
                                            <p className="text-sm text-gray-400 mb-4">
                                                Trigger an immediate run of PSI outside the normal schedule. This starts a fresh Fargate container with the same configuration.
                                            </p>

                                            {triggerResult && (
                                                <div className={cn(
                                                    "p-3 rounded-lg mb-4 text-sm flex items-center gap-3",
                                                    triggerResult.success
                                                        ? "bg-green-900/20 border border-green-700/40 text-green-400"
                                                        : "bg-red-900/20 border border-red-700/40 text-red-400"
                                                )}>
                                                    {triggerResult.success
                                                        ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
                                                        : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                                                    <span className="font-mono text-xs">{triggerResult.message}</span>
                                                </div>
                                            )}

                                            <button
                                                onClick={() => setShowTriggerConfirm(true)}
                                                disabled={triggering}
                                                className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-all"
                                            >
                                                {triggering ? (
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                ) : (
                                                    <Play className="w-4 h-4" />
                                                )}
                                                {triggering ? 'Triggering...' : 'Run Now'}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <ConfirmationModal
                isOpen={showRestartConfirm}
                onClose={() => setShowRestartConfirm(false)}
                onConfirm={handleRestart}
                title="Confirm Restart"
                message={`Are you sure you want to restart ${details?.overview.displayName || appName} in ${environment.toUpperCase()}?`}
                confirmText="Restart Service"
                isLoading={restarting}
            />

            <ConfirmationModal
                isOpen={showTriggerConfirm}
                onClose={() => setShowTriggerConfirm(false)}
                onConfirm={handleTrigger}
                title="Trigger PSI Run Now"
                message={`This will start an immediate PSI run outside its normal schedule in ${environment.toUpperCase()}. The scheduled runs will continue as normal. Proceed?`}
                confirmText="Run Now"
                isLoading={triggering}
            />
        </div>
    );
}
