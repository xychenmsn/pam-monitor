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

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:31191';

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
  const response = await fetch(`${API_BASE}/api/streams?app=${appName}&env=${env}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch streams: ${response.statusText}`);
  }
  const data = await response.json();
  return data.streams;
}

/**
 * Fetch latest logs (initial load - 24 hours)
 */
export async function fetchLatestLogs(
  env: 'qa' | 'dev',
  appName: string,
  limit: number = 500
): Promise<LogEvent[]> {
  const response = await fetch(
    `${API_BASE}/api/logs/latest?app=${appName}&env=${env}&limit=${limit}`
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch logs: ${response.statusText}`);
  }
  const data = await response.json();
  return data.logs;
}

/**
 * Fetch logs from a specific stream
 */
export async function fetchLogsFromStream(
  env: 'qa' | 'dev',
  streamName: string,
  startTime?: number,
  limit: number = 1000
): Promise<LogEvent[]> {
  const response = await fetch(`${API_BASE}/api/logs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamName, env, startTime, limit }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch stream logs: ${response.statusText}`);
  }
  const data = await response.json();
  return data.logs;
}

/**
 * Poll specific streams for new logs (efficient)
 */
export async function pollStreams(
  env: 'qa' | 'dev',
  streams: { streamName: string; startTime: number }[]
): Promise<LogEvent[]> {
  const response = await fetch(`${API_BASE}/api/logs/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env, streams }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to poll streams: ${response.statusText}`);
  }
  const data = await response.json();
  return data.logs;
}
