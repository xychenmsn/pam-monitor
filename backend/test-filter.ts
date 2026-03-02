import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { getCredentialProvider } from './src/services/auth.js';

async function main() {
    const client = new CloudWatchLogsClient({
        region: 'us-east-1',
        credentials: getCredentialProvider(false),
    });

    const LOG_GROUP = 'custom-apps-pam-cloudwatch-qa';
    const prefix = 'ecs/pamqa';

    console.log(`Searching events for ${prefix} in the last 7 days...`);

    const startTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

    const cmd = new FilterLogEventsCommand({
        logGroupName: LOG_GROUP,
        logStreamNamePrefix: prefix,
        startTime: startTime,
        limit: 50,
    });

    try {
        const response = await client.send(cmd);
        const events = response.events || [];
        console.log(`Found ${events.length} events.`);

        // Group by stream name to find the streams that produced these events
        const streamNames = new Set<string>();
        let latestTimestamp = 0;

        for (const e of events) {
            if (e.logStreamName) streamNames.add(e.logStreamName);
            if (e.timestamp && e.timestamp > latestTimestamp) {
                latestTimestamp = e.timestamp;
            }
        }

        console.log(`Streams found:`, Array.from(streamNames));
        const minsAgo = Math.round((Date.now() - latestTimestamp) / 60000);
        console.log(`Latest event was ${minsAgo} minutes ago`);

    } catch (e: any) {
        console.error('Error:', e.message);
    }
}

main().catch(console.error);
