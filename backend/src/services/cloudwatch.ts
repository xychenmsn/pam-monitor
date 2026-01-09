import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

const LOG_GROUPS = {
  qa: 'custom-apps-pam-cloudwatch-qa',
  dev: 'custom-apps-pam-cloudwatch-nonprod',
};

const APP_DISPLAY_NAMES: Record<string, string> = {
  pamadminqa: 'PAM Admin',
  pamapiqa: 'PAM API',
  'pamapiqa-worker': 'PAM API Worker',
  pamqa: 'PAM QA',
  rmxqa: 'RMX',
  'rmxqa-worker': 'RMX Worker',
  gatewayadminqa: 'Gateway Admin',
  psiqa: 'PSI',
};

const APP_PREFIXES = [
  'pamadminqa',
  'pamapiqa',
  'pamapiqa-worker',
  'pamqa',
  'rmxqa',
  'rmxqa-worker',
  'rmxqa-migrations',
  'gatewayadminqa',
  'psiqa',
  'tadqa',
  'pammanagementqa',
];

// Singleton CloudWatch client (uses env vars for credentials)
const client = new CloudWatchLogsClient({ region: 'us-east-1' });

/**
 * List all available apps for an environment
 * GET /api/apps?env=qa
 */
export async function listApps(env: 'qa' | 'dev' = 'qa') {
  const logGroupName = LOG_GROUPS[env];
  const apps = [];

  // Check each app prefix in parallel
  const results = await Promise.allSettled(
    APP_PREFIXES.map(async (prefix) => {
      try {
        const command = new DescribeLogStreamsCommand({
          logGroupName,
          logStreamNamePrefix: `ecs/${prefix}`,
          limit: 1,
        });
        const response = await client.send(command);

        if (response.logStreams && response.logStreams.length > 0) {
          return {
            name: prefix,
            displayName: APP_DISPLAY_NAMES[prefix] || prefix,
            logStreamPrefix: `ecs/${prefix}`,
          };
        }
        return null;
      } catch {
        return null;
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      apps.push(result.value);
    }
  }

  return apps.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Get all log streams for an app
 */
async function getLogStreams(env: 'qa' | 'dev', appPrefix: string): Promise<string[]> {
  const logGroupName = LOG_GROUPS[env];
  const streams: string[] = [];
  let nextToken: string | undefined = undefined;

  do {
    const command = new DescribeLogStreamsCommand({
      logGroupName,
      logStreamNamePrefix: appPrefix,
      nextToken,
      limit: 50,
    });

    const response = await client.send(command);

    for (const stream of response.logStreams || []) {
      if (stream.logStreamName) {
        streams.push(stream.logStreamName);
      }
    }

    nextToken = response.nextToken;
  } while (nextToken);

  return streams;
}

/**
 * Fetch latest logs (most recent first, no time filter)
 * GET /api/logs?app=pamapiqa-worker&env=qa
 */
export async function fetchLatestLogs(
  env: 'qa' | 'dev',
  appName: string,
  limit: number = 500
) {
  const logGroupName = LOG_GROUPS[env];
  const logStreamPrefix = `ecs/${appName}`;

  const allEvents = [];

  // Get logs from the last 60 days
  const startTime = Date.now() - 60 * 24 * 60 * 60 * 1000;

  const command = new FilterLogEventsCommand({
    logGroupName,
    logStreamNamePrefix: logStreamPrefix,
    startTime,
    limit,
  });

  const response = await client.send(command);

  for (const event of response.events || []) {
    if (event.timestamp && event.message) {
      allEvents.push({
        timestamp: event.timestamp,
        stream: event.logStreamName || '',
        message: event.message,
      });
    }
  }

  // Sort by timestamp ascending (oldest first for display)
  return allEvents.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetch logs older than a timestamp (for background loading)
 * GET /api/logs/older?app=pamapiqa-worker&env=qa&olderThan=1234567890
 */
export async function fetchOlderLogs(
  env: 'qa' | 'dev',
  appName: string,
  olderThanTimestamp: number,
  limit: number = 500
) {
  const logGroupName = LOG_GROUPS[env];
  const logStreamPrefix = `ecs/${appName}`;

  const allEvents = [];

  const command = new FilterLogEventsCommand({
    logGroupName,
    logStreamNamePrefix: logStreamPrefix,
    endTime: olderThanTimestamp - 1, // Get logs older than this timestamp
    limit,
  });

  const response = await client.send(command);

  for (const event of response.events || []) {
    if (event.timestamp && event.message) {
      allEvents.push({
        timestamp: event.timestamp,
        stream: event.logStreamName || '',
        message: event.message,
      });
    }
  }

  return allEvents.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetch logs newer than a timestamp (for polling)
 * GET /api/logs/newer?app=pamapiqa-worker&env=qa&newerThan=1234567890
 */
export async function fetchNewLogs(
  env: 'qa' | 'dev',
  appName: string,
  newerThanTimestamp: number
) {
  const logGroupName = LOG_GROUPS[env];
  const logStreamPrefix = `ecs/${appName}`;

  const allEvents = [];

  const command = new FilterLogEventsCommand({
    logGroupName,
    logStreamNamePrefix: logStreamPrefix,
    startTime: newerThanTimestamp + 1, // Get logs newer than this timestamp
    limit: 1000,
  });

  const response = await client.send(command);

  for (const event of response.events || []) {
    if (event.timestamp && event.message) {
      allEvents.push({
        timestamp: event.timestamp,
        stream: event.logStreamName || '',
        message: event.message,
      });
    }
  }

  return allEvents.sort((a, b) => a.timestamp - b.timestamp);
}
