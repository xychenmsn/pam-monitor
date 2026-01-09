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

/**
 * Get a fresh CloudWatch client (reads credentials from current environment)
 * This allows picking up new credentials after running `peacock security`
 */
function getClient(): CloudWatchLogsClient {
  return new CloudWatchLogsClient({ region: 'us-east-1' });
}

/**
 * Check if an error is an AWS credentials/auth error
 */
function isAuthError(error: any): boolean {
  if (!error) return false;
  const errorCode = error.name || error.Code || error.errorCode;
  const errorMessage = error.message || error.Message || error.errorMessage || '';
  return (
    errorCode === 'ExpiredTokenException' ||
    errorCode === 'UnauthorizedException' ||
    errorCode === 'InvalidClientTokenId' ||
    errorCode === 'SignatureDoesNotMatch' ||
    errorMessage.includes('security token') ||
    errorMessage.includes('credentials') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('expired')
  );
}

/**
 * Wrapper that automatically retries with fresh credentials on auth errors
 */
async function withAutoRetry<T>(
  fn: (client: CloudWatchLogsClient) => Promise<T>
): Promise<T> {
  let client = getClient();
  try {
    return await fn(client);
  } catch (error: any) {
    if (isAuthError(error)) {
      console.log('⚠️  AWS credentials expired, retrying with fresh credentials...');
      // Create a fresh client that will read new credentials from environment
      client = getClient();
      return await fn(client);
    }
    throw error;
  }
}

/**
 * List all available apps for an environment
 */
export async function listApps(env: 'qa' | 'dev' = 'qa') {
  const logGroupName = LOG_GROUPS[env];
  const apps = [];

  const results = await Promise.allSettled(
    APP_PREFIXES.map(async (prefix) => {
      try {
        return await withAutoRetry(async (client) => {
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
        });
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
 * Get all log streams for an app, sorted by last event time (most recent first)
 */
export async function getStreamList(env: 'qa' | 'dev', appName: string): Promise<string[]> {
  return await withAutoRetry(async (client) => {
    const logGroupName = LOG_GROUPS[env];
    const logStreamPrefix = `ecs/${appName}`;
    const streams: { name: string; lastEventTime?: number }[] = [];
    let nextToken: string | undefined = undefined;

    // Use logStreamNamePrefix for efficient filtering, then sort by lastEventTime
    do {
      const command = new DescribeLogStreamsCommand({
        logGroupName,
        logStreamNamePrefix: logStreamPrefix,
        limit: 50,
        nextToken,
      });

      const response = await client.send(command);

      for (const stream of response.logStreams || []) {
        if (stream.logStreamName) {
          streams.push({
            name: stream.logStreamName,
            lastEventTime: stream.lastEventTime,
          });
        }
      }

      nextToken = response.nextToken;
    } while (nextToken);

    // Sort by lastEventTime descending (most recent first)
    streams.sort((a, b) => (b.lastEventTime || 0) - (a.lastEventTime || 0));

    return streams.map(s => s.name);
  });
}

/**
 * Fetch logs from a specific stream with time range
 */
export async function fetchLogsFromStream(
  env: 'qa' | 'dev',
  streamName: string,
  startTime?: number,
  limit: number = 1000
) {
  try {
    return await withAutoRetry(async (client) => {
      const logGroupName = LOG_GROUPS[env];
      const allEvents = [];

      const command = new FilterLogEventsCommand({
        logGroupName,
        logStreamNames: [streamName],
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

      return allEvents.sort((a, b) => a.timestamp - b.timestamp);
    });
  } catch (error) {
    console.warn(`Failed to fetch from stream ${streamName}:`, error);
    return [];
  }
}

/**
 * Fetch logs from specific streams with timestamp filter (efficient polling)
 */
export async function fetchNewLogsFromStreams(
  env: 'qa' | 'dev',
  streams: { streamName: string; startTime: number }[]
) {
  if (streams.length === 0) {
    return [];
  }

  return await withAutoRetry(async (client) => {
    const allEvents = [];

    for (const { streamName, startTime } of streams) {
      const command = new FilterLogEventsCommand({
        logGroupName: LOG_GROUPS[env],
        logStreamNames: [streamName],
        startTime: startTime + 1,
        limit: 100,
      });

      try {
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
      } catch (error) {
        console.warn(`Failed to fetch from stream ${streamName}:`, error);
      }
    }

    return allEvents.sort((a, b) => a.timestamp - b.timestamp);
  });
}

/**
 * Initial load: Get latest logs from the last 24 hours
 */
export async function fetchLatestLogs(
  env: 'qa' | 'dev',
  appName: string,
  limit: number = 500
) {
  return await withAutoRetry(async (client) => {
    const logGroupName = LOG_GROUPS[env];
    const logStreamPrefix = `ecs/${appName}`;
    const allEvents = [];
    const startTime = Date.now() - 24 * 60 * 60 * 1000; // Last 24 hours

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

    return allEvents.sort((a, b) => a.timestamp - b.timestamp);
  });
}
