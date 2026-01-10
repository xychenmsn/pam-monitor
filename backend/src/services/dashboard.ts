import { DescribeLogStreamsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { withAutoRetry, getClient, getECSClient } from './cloudwatch.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interface for Backend usage (includes internal fields)
interface AppConfig {
    id: string;
    name: string;
    logGroup: string;
    logStreamPrefix: string;
    cluster: string;
    service: string;
}

// Interface for Frontend response
interface AppDashboardStatus {
    id: string;
    name: string;
    displayName: string;
    activeStreamCount: number;
    lastActivityTime: number | null;
    lastStreamName: string | null;
    streams: string[];
    status: 'active' | 'inactive';
    ecsStatus: {
        status: string;
        runningCount: number;
        desiredCount: number;
        events: string[];
    } | null;
}

// Load config
const configPath = path.join(__dirname, '../config/applications.json');
const allApps: Record<string, AppConfig[]> = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

export async function getDashboardStatus(env: 'qa' | 'dev' = 'qa'): Promise<AppDashboardStatus[]> {
    const apps = allApps[env] || [];
    if (apps.length === 0) return [];

    // 1. Fetch ECS Status (Batched by Cluster)
    // Assuming mostly same cluster, but grouping just in case
    const servicesByCluster = new Map<string, string[]>();
    apps.forEach(app => {
        if (!servicesByCluster.has(app.cluster)) {
            servicesByCluster.set(app.cluster, []);
        }
        servicesByCluster.get(app.cluster)!.push(app.service);
    });

    const ecsStatusMap = new Map<string, any>();

    try {
        await withAutoRetry(async () => {
            const ecs = await getECSClient();
            for (const [cluster, services] of servicesByCluster.entries()) {
                const command = new DescribeServicesCommand({
                    cluster,
                    services
                });
                const response = await ecs.send(command);
                (response.services || []).forEach(svc => {
                    ecsStatusMap.set(svc.serviceName!, svc);
                });
            }
        });
    } catch (err) {
        console.error("Failed to fetch ECS status:", err);
        // Continue, just without ECS status
    }

    // 2. Fetch Log Streams & Assemble Result
    const results = await Promise.all(apps.map(async (app) => {
        let streams: any[] = [];

        try {
            await withAutoRetry(async (cw) => {
                // Strategy: Similar to getStreamList, fetch recent streams globally and filter by prefix manually
                // This avoids the forbidden combination of orderBy='LastEventTime' and logStreamNamePrefix
                const command = new DescribeLogStreamsCommand({
                    logGroupName: app.logGroup,
                    orderBy: 'LastEventTime',
                    descending: true,
                    limit: 30 // Check top 30 active streams in the group
                });
                const response = await cw.send(command);
                const allStreams = response.logStreams || [];
                // Filter manually by prefix
                streams = allStreams.filter(s => s.logStreamName && s.logStreamName.startsWith(app.logStreamPrefix)).slice(0, 5);
            });
        } catch (err) {
            console.warn(`Failed to fetch logs for ${app.name}:`, err);
        }

        const latestStream = streams.length > 0 ? streams[0] : null;
        const lastActivity = latestStream ? (latestStream.lastEventTimestamp || latestStream.creationTime || 0) : null;

        // Check for "Active" based on logs (last 24h)
        const isLogActive = lastActivity && (Date.now() - lastActivity) < (24 * 60 * 60 * 1000);

        // Get ECS details
        const ecsSvc = ecsStatusMap.get(app.service);
        const ecsStatus = ecsSvc ? {
            status: ecsSvc.status || 'UNKNOWN',
            runningCount: ecsSvc.runningCount || 0,
            desiredCount: ecsSvc.desiredCount || 0,
            events: (ecsSvc.events || []).slice(0, 3).map((e: any) => e.message || '')
        } : null;

        // Determine overall status: Active if running OR logs active
        const isRunning = ecsStatus && ecsStatus.runningCount > 0;
        const status: 'active' | 'inactive' = (isRunning || isLogActive) ? 'active' : 'inactive';

        return {
            id: app.id,
            name: app.id, // ID is used for routing/selection
            displayName: app.name,
            activeStreamCount: streams.length,
            lastActivityTime: lastActivity,
            lastStreamName: latestStream ? latestStream.logStreamName : null,
            streams: streams.map(s => s.logStreamName || ''),
            status,
            ecsStatus
        };
    }));

    return results;
}
