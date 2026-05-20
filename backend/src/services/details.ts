import { DescribeServicesCommand, ListTasksCommand, DescribeTasksCommand, DescribeTaskDefinitionCommand, UpdateServiceCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
import { getECSClient, invalidateClients } from './cloudwatch.js';
import { triggerScheduledTask } from './scheduler.js';
import { withAwsRecovery } from './auth.js';
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

    // Bypass ECS calls entirely for static/managed resources like RabbitMQ
    if (!appConfig.cluster) {
        return {
            overview: {
                status: 'RUNNING',
                displayName: appConfig.name,
                runningCount: 1,
                desiredCount: 1,
                createdAt: new Date(),
                clusterArn: 'N/A',
                serviceArn: 'N/A'
            },
            events: [
                {
                    id: 'mq-1',
                    createdAt: new Date(),
                    message: `Broker customapps-nonprod-rabbitMQ is actively running.`
                }
            ],
            tasks: [],
            configuration: {
                taskDefinitionArn: 'N/A',
                image: 'RabbitMQ 3.13.7 (Managed)',
                cpu: 'mq.m7g.medium',
                memory: 'EBS Backed',
                environment: {
                    ENGINE_VERSION: '3.13.7',
                    DEPLOYMENT_MODE: 'SINGLE_INSTANCE',
                    REGION: 'us-east-1',
                    HOST: 'customapps-nonprod-rabbitMQ'
                }
            },
            deployments: []
        };
    }

    return await withAwsRecovery(
        async (forceRefetch) => {
            const ecs = await getECSClient(forceRefetch);
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
                    const svcRes: any = await ecs.send(svcCmd);
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
            const listRunningRes: any = await ecs.send(listRunningCmd);
            taskArns = listRunningRes.taskArns || [];

            // If scheduled and no running tasks, find last stopped task
            if (appConfig.isScheduledTask && taskArns.length === 0) {
                const listStoppedCmd = new ListTasksCommand({
                    cluster: appConfig.cluster,
                    family: appConfig.taskFamily,
                    desiredStatus: 'STOPPED',
                    maxResults: 1 // Just get the last one
                });
                const listStoppedRes: any = await ecs.send(listStoppedCmd);
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
                const descTasksRes: any = await ecs.send(descTasksCmd);
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
                const tdRes: any = await ecs.send(tdCmd);
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
        },
        () => invalidateClients()
    );
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

    if (!appConfig.cluster) {
        throw new Error(`Restart is not supported for static resource ${appName}`);
    }

    if (appConfig.isScheduledTask) {
        return await withAwsRecovery(
            async (forceRefetch) => {
                const ecs = await getECSClient(forceRefetch);

                // 1. Find all running tasks for this family
                const listCmd = new ListTasksCommand({
                    cluster: appConfig.cluster,
                    family: appConfig.taskFamily,
                    desiredStatus: 'RUNNING'
                });
                const listRes = await ecs.send(listCmd);
                const runningTaskArns = listRes.taskArns || [];

                // 2. Stop them
                for (const taskArn of runningTaskArns) {
                    try {
                        await ecs.send(new StopTaskCommand({
                            cluster: appConfig.cluster,
                            task: taskArn,
                            reason: 'Manual restart triggered via dashboard'
                        }));
                    } catch (e) {
                        console.warn(`Failed to stop task ${taskArn}:`, e);
                    }
                }

                // 3. Trigger a fresh run
                const triggerRes = await triggerScheduledTask(appName, env);
                return triggerRes.success;
            },
            () => invalidateClients()
        );
    }

    return await withAwsRecovery(
        async (forceRefetch) => {
            const ecs = await getECSClient(forceRefetch);

            const command = new UpdateServiceCommand({
                cluster: appConfig.cluster,
                service: appConfig.service,
                forceNewDeployment: true
            });

            const response: any = await ecs.send(command);
            return !!response.service;
        },
        () => invalidateClients()
    );
}
