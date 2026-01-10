export interface LogEvent {
  timestamp: number;
  stream: string;
  message: string;
}

export interface App {
  name: string;
  displayName: string;
  logStreamPrefix: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// Basic API client for CloudWatch logs
export const API_BASE = 'http://localhost:31191';

/**
 * Fetch available apps from backend API
 */
export async function listApps(env: 'qa' | 'dev' = 'qa'): Promise<App[]> {
  const response = await fetch(`${API_BASE}/api/apps?env=${env}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch apps: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch list of log streams sorted by recency (most recent first)
 */
export async function getStreamList(env: 'qa' | 'dev', appName: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/logs/streams?app=${appName}&env=${env}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch streams: ${response.statusText}`);
  }
  const data = await response.json();
  return data; // Backend returns array directly or inside key? index.ts says "res.json(streams)" which is string[]
}

/**
 * Fetch logs using GetLogEvents (polling with tokens)
 */
export async function getLogEvents(
  env: 'qa' | 'dev',
  streamName: string,
  limit: number = 1000,
  startFromHead: boolean = false,
  nextToken?: string
): Promise<{ events: LogEvent[]; nextForwardToken?: string; nextBackwardToken?: string }> {
  const response = await fetch(`${API_BASE}/api/logs/stream/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamName, env, limit, startFromHead, nextToken }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch log events: ${response.statusText}`);
  }
  return response.json();
}

