import { ECSClient, DescribeServicesCommand, ListTasksCommand, DescribeTasksCommand, DescribeTaskDefinitionCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { withAutoRetry, getECSClient } from './cloudwatch.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '../config/applications.json');
const allApps = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

export interface AppDetail {
    overview: {
        status: string;
        displayName?: string;
        runningCount: number;
        desiredCount: number;
        createdAt: Date;
        clusterArn: string;
        serviceArn: string;
    };
    events: {
        id: string;
        createdAt: Date;
        message: string;
    }[];
    tasks: {
        taskArn: string;
        lastStatus: string;
        healthStatus: string;
        startedAt?: Date;
        cpu?: string;
        memory?: string;
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
        createdAt: Date;
        updatedAt: Date;
    }[];
}

export async function getAppDetails(appName: string, env: 'qa' | 'dev'): Promise<AppDetail | null> {
    const apps = allApps[env] || [];
    const appConfig = apps.find((a: any) => a.name === appName || a.id === appName); // Match by ID or Name

    if (!appConfig) {
        throw new Error(`App ${appName} not found in config for ${env}`);
    }

    return await withAutoRetry(async () => {
        const ecs = await getECSClient();
        let service: any = null;
        let tasks: any[] = [];
        let tdArn: string | undefined;

        // 1. Describe Service (Skip if Scheduled Task)
        if (!appConfig.isScheduledTask) {
            try {
                const svcCmd = new DescribeServicesCommand({
                    cluster: appConfig.cluster,
                    services: [appConfig.service]
                });
                const svcRes = await ecs.send(svcCmd);
                service = svcRes.services?.[0];
            } catch (err) {
                console.warn(`Failed to describe service ${appConfig.service}:`, err);
            }

            if (!service) {
                // Fallback: If service missing but not marked scheduled, maybe it's just down? 
                // Return null or partial? Current behavior is null.
                return null;
            }
        } else {
            // Mock Service Object for Scheduled Task
            service = {
                status: 'SCHEDULED',
                displayName: appConfig.name,
                runningCount: 0,
                desiredCount: 0,
                createdAt: new Date(), // TODO: Get from rule?
                clusterArn: appConfig.cluster,
                serviceArn: 'N/A',
                events: [],
                deployments: []
            };
        }

        // 2. List Tasks
        // For services: List RUNNING. 
        // For scheduled: List RUNNING first, if empty list STOPPED (recent)
        let taskArns: string[] = [];

        const listRunningCmd = new ListTasksCommand({
            cluster: appConfig.cluster,
            serviceName: appConfig.isScheduledTask ? undefined : appConfig.service,
            family: appConfig.isScheduledTask ? appConfig.taskFamily : undefined,
            desiredStatus: 'RUNNING'
        });
        const listRunningRes = await ecs.send(listRunningCmd);
        taskArns = listRunningRes.taskArns || [];

        // If scheduled and no running tasks, find last stopped task
        if (appConfig.isScheduledTask && taskArns.length === 0) {
            const listStoppedCmd = new ListTasksCommand({
                cluster: appConfig.cluster,
                family: appConfig.taskFamily,
                desiredStatus: 'STOPPED',
                maxResults: 1 // Just get the last one
            });
            const listStoppedRes = await ecs.send(listStoppedCmd);
            taskArns = listStoppedRes.taskArns || [];

            if (taskArns.length > 0) {
                service.status = 'STOPPED';
            }
        }

        // 3. Describe Tasks
        if (taskArns.length > 0) {
            const descTasksCmd = new DescribeTasksCommand({
                cluster: appConfig.cluster,
                tasks: taskArns
            });
            const descTasksRes = await ecs.send(descTasksCmd);
            tasks = descTasksRes.tasks || [];
        }

        // 4. Describe Task Definition
        tdArn = tasks[0]?.taskDefinitionArn || service.taskDefinition;
        // If still no TD ARN (e.g. no tasks found for scheduled task), fallback to config
        if (!tdArn && appConfig.isScheduledTask && appConfig.taskFamily) {
            // We could fetch the latest active revision, or just leave empty
            // Let's try to list task definitions? Or just skip.
        }

        let td: any = null;
        if (tdArn) {
            const tdCmd = new DescribeTaskDefinitionCommand({ taskDefinition: tdArn });
            const tdRes = await ecs.send(tdCmd);
            td = tdRes.taskDefinition;
        }

        // Assemble Result
        const container = td?.containerDefinitions?.[0]; // Assume primary container

        return {
            overview: {
                status: service.status || 'UNKNOWN',
                displayName: appConfig.name,
                runningCount: tasks.filter((t: any) => t.lastStatus === 'RUNNING').length || service.runningCount || 0,
                desiredCount: service.desiredCount || 0,
                createdAt: service.createdAt || new Date(),
                clusterArn: service.clusterArn || '',
                serviceArn: service.serviceArn || ''
            },
            events: (service.events || []).slice(0, 10).map((e: any) => ({
                id: e.id,
                createdAt: e.createdAt,
                message: e.message
            })),
            tasks: tasks.map((t: any) => ({
                taskArn: t.taskArn,
                lastStatus: t.lastStatus,
                healthStatus: t.healthStatus,
                startedAt: t.startedAt,
                cpu: t.cpu,
                memory: t.memory,
                ip: t.containers?.[0]?.networkInterfaces?.[0]?.privateIpv4Address || 'N/A'
            })),
            configuration: {
                taskDefinitionArn: td?.taskDefinitionArn || '',
                image: container?.image || 'Unknown',
                cpu: td?.cpu || container?.cpu || 'Unknown',
                memory: td?.memory || container?.memory || 'Unknown',
                environment: (container?.environment || []).reduce((acc: any, curr: any) => {
                    acc[curr.name] = curr.value;
                    return acc;
                }, {})
            },
            deployments: (service.deployments || []).map((d: any) => ({
                id: d.id,
                status: d.status,
                taskDefinition: d.taskDefinition,
                desiredCount: d.desiredCount || 0,
                pendingCount: d.pendingCount || 0,
                runningCount: d.runningCount || 0,
                rolloutState: d.rolloutState,
                rolloutStateReason: d.rolloutStateReason,
                createdAt: d.createdAt,
                updatedAt: d.updatedAt
            }))
        };
    });
}

/**
 * Trigger a force new deployment for a service
 */
export async function restartService(appName: string, env: 'qa' | 'dev'): Promise<boolean> {
    const apps = allApps[env] || [];
    const appConfig = apps.find((a: any) => a.name === appName || a.id === appName);

    if (!appConfig) {
        throw new Error(`App ${appName} not found in config for ${env}`);
    }

    if (appConfig.isScheduledTask) {
        throw new Error(`${appName} is a scheduled task and does not support restart. Use the trigger (Run Now) endpoint instead.`);
    }

    return await withAutoRetry(async () => {
        const ecs = await getECSClient();

        const command = new UpdateServiceCommand({
            cluster: appConfig.cluster,
            service: appConfig.service,
            forceNewDeployment: true
        });

        const response = await ecs.send(command);
        return !!response.service;
    });
}
