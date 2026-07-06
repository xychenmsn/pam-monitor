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
export async function listApps(env: 'qa' | 'dev' | 'prod' = 'qa'): Promise<App[]> {
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
export async function getStreamList(env: 'qa' | 'dev' | 'prod', appName: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/logs/streams?app=${appName}&env=${env}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch streams: ${response.statusText}`);
  }
  const data = await response.json();
  return data;
}

/**
 * Fetch logs using GetLogEvents (polling with tokens)
 */
export async function getLogEvents(
  env: 'qa' | 'dev' | 'prod',
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

export interface AppDashboardStatus {
  name: string;
  displayName: string;
  activeStreamCount: number;
  lastActivityTime: number | null;
  lastStreamName: string | null;
  streams: string[];
  status: 'active' | 'inactive';
  ecsStatus: {
    status: string;
    runningCount: number;
    desiredCount: number;
    events: string[];
  } | null;
}

/**
 * Fetch dashboard status (global scan)
 */
export async function getDashboardStatus(env: 'qa' | 'dev' | 'prod'): Promise<AppDashboardStatus[]> {
  const response = await fetch(`${API_BASE}/api/dashboard/status?env=${env}`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch dashboard status: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Check if AWS credentials are valid across the whole app
 */
export async function checkAuth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/aws/status`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Trigger the local AWS login script via backend
 */
export async function triggerLogin(env: 'qa' | 'dev' | 'prod'): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/auth/aws/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env })
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Failed to trigger login:', error);
    return false;
  }
}
