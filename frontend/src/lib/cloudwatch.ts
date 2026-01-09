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

const API_BASE = 'http://localhost:3001';

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
 * Fetch latest logs from backend API
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
 * Fetch older logs from backend API
 */
export async function fetchOlderLogs(
  env: 'qa' | 'dev',
  appName: string,
  olderThanTimestamp: number,
  limit: number = 500
): Promise<LogEvent[]> {
  const response = await fetch(
    `${API_BASE}/api/logs/older?app=${appName}&env=${env}&olderThan=${olderThanTimestamp}&limit=${limit}`
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch older logs: ${response.statusText}`);
  }
  const data = await response.json();
  return data.logs;
}

/**
 * Fetch new logs from backend API (for polling)
 */
export async function fetchNewLogs(
  env: 'qa' | 'dev',
  appName: string,
  newerThanTimestamp: number
): Promise<LogEvent[]> {
  const response = await fetch(
    `${API_BASE}/api/logs/newer?app=${appName}&env=${env}&newerThan=${newerThanTimestamp}`
  );
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || `Failed to fetch new logs: ${response.statusText}`);
  }
  const data = await response.json();
  return data.logs;
}
