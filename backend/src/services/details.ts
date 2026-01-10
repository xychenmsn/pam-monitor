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

        // 1. Describe Service
        const svcCmd = new DescribeServicesCommand({
            cluster: appConfig.cluster,
            services: [appConfig.service]
        });
        const svcRes = await ecs.send(svcCmd);
        const service = svcRes.services?.[0];

        if (!service) return null;

        // 2. List Tasks
        const listTasksCmd = new ListTasksCommand({
            cluster: appConfig.cluster,
            serviceName: appConfig.service,
            desiredStatus: 'RUNNING'
        });
        const listTasksRes = await ecs.send(listTasksCmd);
        const taskArns = listTasksRes.taskArns || [];

        // 3. Describe Tasks
        let tasks: any[] = [];
        if (taskArns.length > 0) {
            const descTasksCmd = new DescribeTasksCommand({
                cluster: appConfig.cluster,
                tasks: taskArns
            });
            const descTasksRes = await ecs.send(descTasksCmd);
            tasks = descTasksRes.tasks || [];
        }

        // 4. Describe Task Definition (from Service or Task)
        const tdArn = tasks[0]?.taskDefinitionArn || service.taskDefinition;
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
                runningCount: service.runningCount || 0,
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
