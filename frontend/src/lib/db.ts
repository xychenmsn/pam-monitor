import { API_BASE, AuthError } from './cloudwatch';

export interface DatabaseConfig {
  id: string;
  name: string;
  host: string;
  database: string;
}

export interface TableColumn {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default: string | null;
  Extra: string;
}

export interface TableDataResponse {
  columns: TableColumn[];
  rows: Record<string, any>[];
  total: number;
  limit: number;
  offset: number;
}

export interface QueryResponse {
  rows: Record<string, any>[];
  columns: { name: string; type: number }[];
  executionTimeMs: number;
}

/**
 * Handle API responses and throw appropriate AuthErrors or standard Errors
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || data.requiresAuth) {
      throw new AuthError(data.error || 'AWS credentials expired');
    }
    throw new Error(data.error || data.message || `API Error: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch available databases for current environment
 */
export async function listDatabases(env: 'qa' | 'dev' | 'prod'): Promise<DatabaseConfig[]> {
  const response = await fetch(`${API_BASE}/api/databases?env=${env}`);
  return handleResponse<DatabaseConfig[]>(response);
}

/**
 * Fetch list of tables inside a database
 */
export async function listTables(env: 'qa' | 'dev' | 'prod', dbId: string): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/databases/${dbId}/tables?env=${env}`);
  return handleResponse<string[]>(response);
}

/**
 * Fetch paginated rows and schema details for a table
 */
export async function getTableData(
  env: 'qa' | 'dev' | 'prod',
  dbId: string,
  tableName: string,
  limit: number = 50,
  offset: number = 0
): Promise<TableDataResponse> {
  const response = await fetch(
    `${API_BASE}/api/databases/${dbId}/tables/${tableName}/data?env=${env}&limit=${limit}&offset=${offset}`
  );
  return handleResponse<TableDataResponse>(response);
}

/**
 * Execute custom read-only SQL query
 */
export async function executeCustomQuery(
  env: 'qa' | 'dev' | 'prod',
  dbId: string,
  query: string
): Promise<QueryResponse> {
  const response = await fetch(`${API_BASE}/api/databases/${dbId}/query?env=${env}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return handleResponse<QueryResponse>(response);
}
