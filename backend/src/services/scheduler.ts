import {
    CloudWatchEventsClient,
    DescribeRuleCommand,
    ListTargetsByRuleCommand,
    PutRuleCommand,
} from '@aws-sdk/client-cloudwatch-events';
import { ECSClient, RunTaskCommand, ListTasksCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { withAutoRetry, getECSClient } from './cloudwatch.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '../config/applications.json');
const allApps = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

let cwClient: CloudWatchEventsClient | null = null;

async function getCWClient(): Promise<CloudWatchEventsClient> {
    if (!cwClient) {
        cwClient = new CloudWatchEventsClient({ region: 'us-east-1' });
    }
    return cwClient;
}

export interface SchedulerRuleInfo {
    name: string;
    arn: string;
    scheduleExpression: string;
    state: string; // ENABLED | DISABLED
    description?: string;
    targets: {
        id: string;
        arn: string;
        taskDefinitionArn: string;
        taskCount: number;
        launchType: string;
        subnets: string[];
        securityGroups: string[];
    }[];
}

/**
 * Get details of a CloudWatch Events scheduler rule + its ECS targets
 */
export async function getSchedulerRule(ruleName: string, _env: string): Promise<SchedulerRuleInfo> {
    const cw = await getCWClient();

    const [ruleRes, targetsRes] = await Promise.all([
        cw.send(new DescribeRuleCommand({ Name: ruleName })),
        cw.send(new ListTargetsByRuleCommand({ Rule: ruleName })),
    ]);

    const targets = (targetsRes.Targets || []).map((t: any) => ({
        id: t.Id || '',
        arn: t.Arn || '',
        taskDefinitionArn: t.EcsParameters?.TaskDefinitionArn || '',
        taskCount: t.EcsParameters?.TaskCount || 1,
        launchType: t.EcsParameters?.LaunchType || 'FARGATE',
        subnets: t.EcsParameters?.NetworkConfiguration?.awsvpcConfiguration?.Subnets || [],
        securityGroups: t.EcsParameters?.NetworkConfiguration?.awsvpcConfiguration?.SecurityGroups || [],
    }));

    return {
        name: ruleRes.Name || ruleName,
        arn: ruleRes.Arn || '',
        scheduleExpression: ruleRes.ScheduleExpression || '',
        state: ruleRes.State || 'UNKNOWN',
        description: ruleRes.Description,
        targets,
    };
}

/**
 * Update the schedule expression for a CloudWatch Events rule
 */
export async function updateSchedulerRule(
    ruleName: string,
    scheduleExpression: string,
    _env: string
): Promise<{ success: boolean; ruleArn?: string }> {
    const cw = await getCWClient();

    // First get current rule to preserve all other settings
    const currentRule = await cw.send(new DescribeRuleCommand({ Name: ruleName }));

    const res = await cw.send(new PutRuleCommand({
        Name: ruleName,
        ScheduleExpression: scheduleExpression,
        State: currentRule.State,
        Description: currentRule.Description,
    }));

    return { success: true, ruleArn: res.RuleArn };
}

/**
 * Manually trigger a scheduled ECS task (Run Now), bypassing the scheduler schedule.
 * Reads the CloudWatch target to reuse the same network config as the scheduled runs.
 */
export async function triggerScheduledTask(
    appName: string,
    env: 'qa' | 'dev'
): Promise<{ success: boolean; taskArn?: string; message: string }> {
    const apps = allApps[env] || [];
    const appConfig = apps.find((a: any) => a.name === appName || a.id === appName);

    if (!appConfig) {
        throw new Error(`App ${appName} not found in config for ${env}`);
    }

    if (!appConfig.isScheduledTask) {
        throw new Error(`App ${appName} is not a scheduled task — use restart instead`);
    }

    const ruleName = appConfig.schedulerRule;
    if (!ruleName) {
        throw new Error(`No schedulerRule configured for ${appName}`);
    }

    return await withAutoRetry(async () => {
        // Get network config from the CloudWatch target
        const rule = await getSchedulerRule(ruleName, env);
        const target = rule.targets[0];

        if (!target) {
            throw new Error(`No ECS target found for rule ${ruleName}`);
        }

        const ecs = await getECSClient();

        const res = await ecs.send(new RunTaskCommand({
            cluster: appConfig.cluster,
            taskDefinition: target.taskDefinitionArn,
            launchType: 'FARGATE',
            count: 1,
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: target.subnets,
                    securityGroups: target.securityGroups,
                    assignPublicIp: 'DISABLED',
                },
            },
        }));

        const task = res.tasks?.[0];
        const failures = res.failures || [];

        if (failures.length > 0) {
            const reason = failures[0].reason || 'Unknown reason';
            return { success: false, message: `ECS run failed: ${reason}` };
        }

        return {
            success: true,
            taskArn: task?.taskArn,
            message: `Task started successfully: ${task?.taskArn?.split('/').pop()}`,
        };
    });
}

/**
 * Get the last N runs (tasks) of a scheduled task
 */
export async function getScheduledTaskRuns(
    appName: string,
    env: 'qa' | 'dev',
    limit = 5
): Promise<{
    taskArn: string;
    lastStatus: string;
    startedAt?: Date;
    stoppedAt?: Date;
    stopCode?: string;
    stoppedReason?: string;
}[]> {
    const apps = allApps[env] || [];
    const appConfig = apps.find((a: any) => a.name === appName || a.id === appName);
    if (!appConfig || !appConfig.isScheduledTask) return [];

    const ecs = await getECSClient();

    // Get recent STOPPED tasks (finished runs)
    const stopped = await ecs.send(new ListTasksCommand({
        cluster: appConfig.cluster,
        family: appConfig.taskFamily,
        desiredStatus: 'STOPPED',
        maxResults: limit,
    }));

    // Get any currently RUNNING tasks
    const running = await ecs.send(new ListTasksCommand({
        cluster: appConfig.cluster,
        family: appConfig.taskFamily,
        desiredStatus: 'RUNNING',
    }));

    const allArns = [...(running.taskArns || []), ...(stopped.taskArns || [])].slice(0, limit);
    if (allArns.length === 0) return [];

    const descRes = await ecs.send(new DescribeTasksCommand({
        cluster: appConfig.cluster,
        tasks: allArns,
    }));

    return (descRes.tasks || []).map((t) => ({
        taskArn: t.taskArn || '',
        lastStatus: t.lastStatus || 'UNKNOWN',
        startedAt: t.startedAt,
        stoppedAt: t.stoppedAt,
        stopCode: t.stopCode,
        stoppedReason: t.stoppedReason,
    }));
}
