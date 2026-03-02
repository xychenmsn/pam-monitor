import { CloudWatchLogsClient, DescribeLogStreamsCommand, DescribeLogGroupsCommand, FilterLogEventsCommand, GetLogEventsCommand, StartLiveTailCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ECSClient, ListTasksCommand } from '@aws-sdk/client-ecs';
import { withAwsRecovery, getCredentialProvider } from './auth.js';

export const LOG_GROUPS = {
  qa: 'custom-apps-pam-cloudwatch-qa',
  dev: 'custom-apps-pam-cloudwatch-nonprod',
};

export const APP_DISPLAY_NAMES: Record<string, string> = {
  pamadminqa: 'PAM Admin',
  pamapiqa: 'PAM API',
  'pamapiqa-worker': 'PAM API Worker',
  pamqa: 'PAM QA',
  rmxqa: 'RMX',
  'rmxqa-worker': 'RMX Worker',
  gatewayadminqa: 'Gateway Admin',
  psiqa: 'PSI',
  psi: 'PSI',
};

export const APP_PREFIXES = [
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

const REGION = 'us-east-1';

let cwClient: CloudWatchLogsClient | null = null;
let ecsClient: ECSClient | null = null;

export async function getClient(forceRefetch: boolean = false): Promise<CloudWatchLogsClient> {
  if (cwClient && !forceRefetch) return cwClient;

  cwClient = new CloudWatchLogsClient({
    region: REGION,
    credentials: getCredentialProvider(forceRefetch),
  });
  return cwClient;
}

export async function getECSClient(forceRefetch: boolean = false): Promise<ECSClient> {
  if (ecsClient && !forceRefetch) return ecsClient;

  ecsClient = new ECSClient({
    region: REGION,
    credentials: getCredentialProvider(forceRefetch),
  });
  return ecsClient;
}

/**
 * Invalidate cached AWS clients to force fresh creation
 */
export function invalidateClients() {
  cwClient = null;
  ecsClient = null;
}

/**
 * Wrapper that automatically retries with fresh credentials on auth errors
 */
export async function withAutoRetry<T>(
  fn: (client: CloudWatchLogsClient, forceRefetch: boolean) => Promise<T>
): Promise<T> {
  return withAwsRecovery(
    async (forceRefetch) => {
      const client = await getClient(forceRefetch);
      return await fn(client, forceRefetch);
    },
    () => {
      invalidateClients();
    }
  );
}

/**
 * List all available apps for an environment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '../config/applications.json');
const allApps = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

/**
 * Helper to get app configuration by name or ID
 */
export function getAppConfig(env: 'qa' | 'dev', identifier: string) {
  const apps = allApps[env] || [];
  return apps.find((a: any) => a.id === identifier || a.name === identifier);
}

/**
 * Check if AWS credentials are valid
 */
export async function checkAuth(): Promise<boolean> {
  try {
    await withAutoRetry(async (client) => {
      await client.send(new DescribeLogGroupsCommand({ limit: 1 }));
    });
    return true;
  } catch (error) {
    console.error('Auth check failed:', error);
    // On auth failure, insure the clients are cleared so next heartbeat checks again with fresh state
    cwClient = null;
    ecsClient = null;
    return false;
  }
}

/**
 * List all available apps for an environment
 */
export async function listApps(env: 'qa' | 'dev' = 'qa') {
  const appsConfig = allApps[env] || [];

  return appsConfig.map((app: any) => ({
    name: app.id, // Use ID as the primary key ID to match Dashboard
    displayName: app.name,
    logStreamPrefix: app.logStreamPrefix,
    // We can also return other props if needed, but this satisfies the App interface
  }));
}

/**
 * Get the latest log stream for an app
 * Optimized to find the exact active stream by querying ECS directly.
 */
export async function getStreamList(env: 'qa' | 'dev', appName: string): Promise<string[]> {
  const config = getAppConfig(env, appName);
  const logStreamPrefix = config?.logStreamPrefix || `ecs/${appName}`;
  const logGroupName = config?.logGroup || LOG_GROUPS[env];

  return await withAutoRetry(async (client, forceRefetch) => {
    // 1. Ask ECS for running tasks to determine exact stream names
    if (config && !config.isScheduledTask && config.cluster && config.service) {
      try {
        const ecs = await getECSClient(forceRefetch);
        const listCmd = new ListTasksCommand({
          cluster: config.cluster,
          serviceName: config.service,
          desiredStatus: 'RUNNING'
        });
        const listRes = await ecs.send(listCmd);
        const taskArns = listRes.taskArns || [];

        if (taskArns.length > 0) {
          // Construct expected log stream names: <prefix>/<container-name>/<task-id>
          // Note: container-name usually matches the service/app name minus "qa" or "-service" 
          // but the prefix in config usually captures "ecs/<container-name>".
          // So if logStreamPrefix is "ecs/pamqa", generated stream is "ecs/pamqa/<task-id>"
          const streamNames = taskArns.map(arn => {
            const taskId = arn.split('/').pop();
            return `${logStreamPrefix}/${taskId}`;
          });

          // Verify these streams actually exist in CloudWatch (to handle starting tasks)
          const validStreams: string[] = [];
          for (const sName of streamNames) {
            try {
              const checkCmd = new DescribeLogStreamsCommand({
                logGroupName,
                logStreamNamePrefix: sName,
              });
              const checkRes = await client.send(checkCmd);
              if (checkRes.logStreams && checkRes.logStreams.length > 0) {
                validStreams.push(sName);
              }
            } catch (e) {
              console.warn(`Failed to verify stream ${sName}:`, e);
            }
          }

          if (validStreams.length > 0) {
            return validStreams;
          }
        }
      } catch (err) {
        console.warn(`Failed to get ECS tasks for ${appName}, falling back to CloudWatch scan:`, err);
      }
    }

    // 2. Fallback: CloudWatch scan (mainly for scheduled tasks like PSI that aren't 'SERVICES')
    let nextToken: string | undefined = undefined;

    for (let i = 0; i < 5; i++) {
      const command = new DescribeLogStreamsCommand({
        logGroupName,
        orderBy: 'LastEventTime',
        descending: true,
        limit: 50,
        nextToken,
      });

      const response: any = await client.send(command as any);
      const streams = response.logStreams || [];

      // Find all streams that match our app
      const matches = streams.filter((s: any) => s.logStreamName && s.logStreamName.startsWith(logStreamPrefix));

      if (matches.length > 0) {
        return matches.map((m: any) => m.logStreamName);
      }

      nextToken = response.nextToken;
      if (!nextToken) break;
    }

    return [];
  });
}

/**
 * Fetch logs from a specific stream with time range
 */
export async function fetchLogsFromStream(
  env: 'qa' | 'dev',
  streamName: string,
  startTime?: number,
  limit?: number
) {
  try {
    return await withAutoRetry(async (client) => {
      const logGroupName = LOG_GROUPS[env];
      const allEvents: { timestamp: number; stream: string; message: string }[] = [];
      let nextToken: string | undefined = undefined;

      // Loop to fetch all logs (or up to limit if specified)
      do {
        const command = new FilterLogEventsCommand({
          logGroupName,
          logStreamNames: [streamName],
          startTime,
          limit: limit || undefined, // If limit not specified, AWS default is used, but we handle pagination
          nextToken,
        });

        const response: any = await client.send(command as any);

        for (const event of response.events || []) {
          if (event.timestamp && event.message) {
            allEvents.push({
              timestamp: event.timestamp,
              stream: event.logStreamName || '',
              message: event.message,
            });
          }
        }

        nextToken = response.nextToken;

        // If limit was specified and we reached it, stop
        // (Note: this is a loose limit check, strict limit would require counting)
        if (limit && allEvents.length >= limit) {
          break;
        }

      } while (nextToken);

      return allEvents.sort((a, b) => a.timestamp - b.timestamp);
    });
  } catch (err) {
    console.error('Error fetching logs from stream:', err);
    return [];
  }
}

/**
 * Get logs using GetLogEventsCommand (better for polling/pagination)
 */
export async function getLogEvents(
  env: 'qa' | 'dev',
  streamName: string,
  limit: number = 1000,
  startFromHead: boolean = false,
  nextToken?: string
) {
  return await withAutoRetry(async (client) => {
    const logGroupName = LOG_GROUPS[env];
    const command = new GetLogEventsCommand({
      logGroupName,
      logStreamName: streamName,
      limit,
      startFromHead,
      nextToken,
    });

    const response = await client.send(command);

    return {
      events: (response.events || []).map(e => ({
        timestamp: e.timestamp || 0,
        message: e.message || '',
        ingestionTime: e.ingestionTime,
        stream: streamName
      })),
      nextForwardToken: response.nextForwardToken,
      nextBackwardToken: response.nextBackwardToken
    };
  });
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
 * Initial load: Get latest logs from the last 24 hours (or since startTime)
 */
export async function fetchLatestLogs(
  env: 'qa' | 'dev',
  appName: string,
  limit: number = 500,
  startTime?: number
) {
  const config = getAppConfig(env, appName);
  const logStreamPrefix = config?.logStreamPrefix || `ecs/${appName}`;
  const logGroupName = config?.logGroup || LOG_GROUPS[env];

  return await withAutoRetry(async (client) => {
    const allEvents = [];
    // Use provided startTime or default to last 7 days 
    // (24h was too strict for apps like RMX/PAM that might not log every day)
    const effectiveStartTime = startTime ?? (Date.now() - 7 * 24 * 60 * 60 * 1000);

    const command = new FilterLogEventsCommand({
      logGroupName,
      logStreamNamePrefix: logStreamPrefix,
      startTime: effectiveStartTime,
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

/**
 * Helper to get Log Group ARN
 */
async function getLogGroupArn(client: CloudWatchLogsClient, logGroupName: string): Promise<string | undefined> {
  const command = new DescribeLogGroupsCommand({
    logGroupNamePrefix: logGroupName,
    limit: 1,
  });
  const response = await client.send(command);
  // Find exact match
  const group = response.logGroups?.find(g => g.logGroupName === logGroupName);
  return group?.arn; // Format: arn:aws:logs:region:account:log-group:name:*
}

/**
 * Start a Live Tail session via SSE
 * Returns a cleanup function
 */
export async function startLiveTail(
  env: 'qa' | 'dev',
  appName: string,
  onEvent: (event: any) => void,
  onError: (err: any) => void,
  onClose: () => void
): Promise<() => void> {
  const config = getAppConfig(env, appName);
  const logStreamPrefix = config?.logStreamPrefix || `ecs/${appName}`;
  const logGroupName = config?.logGroup || LOG_GROUPS[env];

  const abortController = new AbortController();

  try {
    // 1. Get ARN
    // This call uses withAutoRetry, which includes the "Smart Recovery" logic (clearing stale env vars).
    // So if auth fails here, it will clean up process.env before we create the streaming client.
    const logGroupArn = await withAutoRetry(async (c) => getLogGroupArn(c, logGroupName));

    if (!logGroupArn) {
      onError(new Error(`Log group ARN not found for ${logGroupName}`));
      return () => { };
    }

    // 2. Create client AFTER ARN check (so it picks up any env changes from withAutoRetry)
    const client = await getClient();

    // Remove :* suffix if present (sometimes ARN has it)
    const cleanArn = logGroupArn.endsWith(':*') ? logGroupArn.slice(0, -2) : logGroupArn;

    const command = new StartLiveTailCommand({
      logGroupIdentifiers: [cleanArn],
      logStreamNamePrefixes: [logStreamPrefix], // Filter by app!
    });
    // Note: To use abortSignal with recent AWS SDK v3, pass it in the handler config or Client but for live tail specifically:
    // Some versions accept { abortSignal } in options.
    // However, destroying the client is the surest way if signal isn't supported on command level.
    // The command itself works with client.send(command, { abortSignal })

    const response = await client.send(command, { abortSignal: abortController.signal });

    // Handle the stream
    const processStream = async () => {
      try {
        if (response.responseStream) {
          for await (const event of response.responseStream) {
            if (event.sessionUpdate) {
              const logs = event.sessionUpdate.sessionResults || [];
              onEvent(logs);
            } else if ((event as any).sessionTimeout) {
              onError(new Error('Live tail session timed out'));
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          onError(err);
        }
      } finally {
        onClose();
      }
    };

    processStream();

    return () => {
      abortController.abort();
    };
  } catch (err) {
    onError(err);
    return () => { };
  }
}
