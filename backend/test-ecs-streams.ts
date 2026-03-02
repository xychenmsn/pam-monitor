import { ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs';
import { getCredentialProvider } from './src/services/auth.js';

async function main() {
    const ecs = new ECSClient({
        region: 'us-east-1',
        credentials: getCredentialProvider(false),
    });

    const cluster = 'ecs-custom-apps-pam-qa';
    const service = 'pamqa-service';
    const prefix = 'ecs/pamqa'; // The awslogs-stream-prefix / container-name

    console.log(`Getting running tasks for ${service}...`);

    const cmd = new ListTasksCommand({
        cluster: cluster,
        serviceName: service,
        desiredStatus: 'RUNNING'
    });

    try {
        const response = await ecs.send(cmd);
        const taskArns = response.taskArns || [];
        console.log(`Found ${taskArns.length} tasks.`);

        // Build stream names
        const streamNames = taskArns.map(arn => {
            // ARN format: arn:aws:ecs:region:account:task/cluster/taskId
            const taskId = arn.split('/').pop();
            return `${prefix}/${taskId}`;
        });

        console.log(`Active streams:\n`, streamNames);

    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

main().catch(console.error);
