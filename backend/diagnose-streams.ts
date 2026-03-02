/**
 * Diagnostic script: Check where PAM and RMX streams appear in the global sort
 * and whether the prefix-based search finds them.
 */
import { CloudWatchLogsClient, DescribeLogStreamsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { getCredentialProvider } from './src/services/auth.js';

const LOG_GROUP = 'custom-apps-pam-cloudwatch-qa';
const PREFIXES = ['ecs/pamqa', 'ecs/rmxqa', 'ecs/pamapiqa', 'ecs/tadqa', 'ecs/pamadminqa', 'ecs/psiqa'];

async function main() {
    const client = new CloudWatchLogsClient({
        region: 'us-east-1',
        credentials: getCredentialProvider(false),
    });

    console.log('=== Phase 1: Global scan (orderBy: LastEventTime, descending) ===');
    console.log('Scanning top 500 streams...\n');

    const foundPositions: Record<string, { position: number; streamName: string; lastEventTime: number }[]> = {};
    PREFIXES.forEach(p => foundPositions[p] = []);

    let nextToken: string | undefined;
    let position = 0;

    for (let page = 0; page < 100; page++) {
        const cmd = new DescribeLogStreamsCommand({
            logGroupName: LOG_GROUP,
            orderBy: 'LastEventTime',
            descending: true,
            limit: 50,
            nextToken,
        });

        const response = await client.send(cmd);
        const streams = response.logStreams || [];

        for (const stream of streams) {
            position++;
            const name = stream.logStreamName || '';
            for (const prefix of PREFIXES) {
                if (name.startsWith(prefix)) {
                    foundPositions[prefix].push({
                        position,
                        streamName: name,
                        lastEventTime: stream.lastEventTimestamp || 0,
                    });
                }
            }
        }

        nextToken = response.nextToken;
        if (!nextToken) {
            console.log(`(Exhausted all streams at position ${position})`);
            break;
        }
    }

    console.log(`Scanned ${position} streams total.\n`);

    for (const prefix of PREFIXES) {
        const found = foundPositions[prefix];
        if (found.length === 0) {
            console.log(`❌ ${prefix}: NOT FOUND in top ${position} streams`);
        } else {
            const first = found[0];
            const timeAgo = Date.now() - first.lastEventTime;
            const minsAgo = Math.round(timeAgo / 60000);
            console.log(`✅ ${prefix}: Found at position ${first.position} (last event ${minsAgo} min ago)`);
            console.log(`   Stream: ${first.streamName}`);
            if (found.length > 1) {
                console.log(`   (${found.length} total streams found in scan)`);
            }
        }
    }

    console.log('\n=== Phase 2: Prefix-based search for each app ===\n');

    for (const prefix of PREFIXES) {
        try {
            const cmd = new DescribeLogStreamsCommand({
                logGroupName: LOG_GROUP,
                logStreamNamePrefix: prefix,
                orderBy: 'LogStreamName',
                descending: true,
                limit: 5,
            });

            const response = await client.send(cmd);
            const streams = response.logStreams || [];

            if (streams.length === 0) {
                console.log(`❌ ${prefix}: No streams found by prefix search`);
            } else {
                // Sort by lastEventTimestamp client-side
                streams.sort((a, b) => (b.lastEventTimestamp || 0) - (a.lastEventTimestamp || 0));
                const latest = streams[0];
                const timeAgo = Date.now() - (latest.lastEventTimestamp || 0);
                const minsAgo = Math.round(timeAgo / 60000);
                console.log(`✅ ${prefix}: ${streams.length} streams found by prefix search`);
                console.log(`   Latest: ${latest.logStreamName} (last event ${minsAgo} min ago)`);
            }
        } catch (err: any) {
            console.log(`❌ ${prefix}: Error - ${err.message}`);
        }
    }

    // Phase 3: Let's check what the actual stream names look like for pamqa and rmxqa
    console.log('\n=== Phase 3: Full prefix listing for pamqa and rmxqa ===\n');
    for (const prefix of ['ecs/pamqa', 'ecs/rmxqa']) {
        const cmd = new DescribeLogStreamsCommand({
            logGroupName: LOG_GROUP,
            logStreamNamePrefix: prefix,
            orderBy: 'LogStreamName',
            descending: true,
            limit: 20,
        });
        const response = await client.send(cmd);
        const streams = response.logStreams || [];
        console.log(`${prefix}: ${streams.length} streams total`);
        for (const s of streams) {
            const timeAgo = Date.now() - (s.lastEventTimestamp || 0);
            const minsAgo = Math.round(timeAgo / 60000);
            console.log(`   ${s.logStreamName} | last event: ${minsAgo} min ago | created: ${s.creationTime ? new Date(s.creationTime).toISOString() : 'N/A'}`);
        }
        console.log('');
    }
}

main().catch(console.error);
