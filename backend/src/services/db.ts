import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read applications.json to load databases configuration
const configPath = path.resolve(__dirname, '../config/applications.json');
const rawConfig = fs.readFileSync(configPath, 'utf-8');
const config = JSON.parse(rawConfig);
const databasesRegistry = config.databases || {};

// Connection Pool Cache
const pools: Record<string, mysql.Pool> = {};

/**
 * Get or create connection pool for a specific environment and database ID
 */
async function getPool(env: 'qa' | 'dev' | 'prod', dbId: string): Promise<mysql.Pool> {
  const cacheKey = `${env}:${dbId}`;
  if (pools[cacheKey]) {
    return pools[cacheKey];
  }

  const envDbs = databasesRegistry[env] || [];
  const dbConfig = { ...envDbs.find((db: any) => db.id === dbId) };

  if (!dbConfig || !dbConfig.host) {
    throw new Error(`Database connection profile '${dbId}' not found for environment '${env}'`);
  }

  // For agency-gateway-db in QA or Prod, fetch dynamic credentials from Secrets Manager
  if (dbId === 'agency-gateway-db' && (env === 'qa' || env === 'prod')) {
    try {
      console.log(`[DB] Fetching dynamic DB credentials for ${dbId} in ${env} from Secrets Manager...`);
      const { getAppSecrets } = await import('./secrets.js');
      const secrets = await getAppSecrets('agency-gateway-api', env);
      if (secrets && secrets.entries) {
        const dbUser = secrets.entries.find(e => e.key === 'MYSQL_DB_USER_NAME')?.value;
        const dbPass = secrets.entries.find(e => e.key === 'MYSQL_DB_PASSWORD')?.value;
        if (dbUser && dbPass) {
          console.log(`[DB] Successfully resolved database credentials from Secrets Manager.`);
          dbConfig.user = dbUser;
          dbConfig.password = dbPass;
        } else {
          console.warn(`[DB] Secrets found for ${dbId} but MYSQL_DB_USER_NAME/PASSWORD keys were missing.`);
        }
      } else if (secrets?.error) {
        console.warn(`[DB] Failed to retrieve secrets: ${secrets.error}`);
      }
    } catch (secretError: any) {
      console.warn(`[DB] Error fetching database credentials from Secrets Manager (falling back to hardcoded):`, secretError.message);
    }
  }

  console.log(`[DB] Initializing new connection pool for ${cacheKey} (${dbConfig.host}:${dbConfig.port || 3306}/${dbConfig.database})`);
  const pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port || 3306,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000 // 10s connection timeout
  });

  pools[cacheKey] = pool;
  return pool;
}

/**
 * List databases available for a given environment
 */
export async function listDatabases(env: 'qa' | 'dev' | 'prod') {
  return databasesRegistry[env] || [];
}

/**
 * List all tables in a specific database
 */
export async function listTables(env: 'qa' | 'dev' | 'prod', dbId: string): Promise<string[]> {
  const pool = await getPool(env, dbId);
  const [rows] = await pool.query('SHOW TABLES');
  return (rows as any[]).map((row) => Object.values(row)[0] as string);
}

/**
 * Retrieve column description schemas and records for a table
 */
export async function getTableData(
  env: 'qa' | 'dev' | 'prod',
  dbId: string,
  tableName: string,
  limit: number = 50,
  offset: number = 0
) {
  const pool = await getPool(env, dbId);

  // Get table column structures safely
  const [columns] = await pool.query('DESCRIBE ??', [tableName]);
  
  // Get paginated row data safely
  const [rows] = await pool.query('SELECT * FROM ?? LIMIT ? OFFSET ?', [
    tableName,
    Number(limit),
    Number(offset)
  ]);

  // Get total rows count safely
  const [countRows] = await pool.query('SELECT COUNT(*) as total FROM ??', [tableName]);
  const total = (countRows as any[])[0]?.total || 0;

  return {
    columns: columns as any[],
    rows: rows as any[],
    total,
    limit,
    offset
  };
}

/**
 * Safe SQL validator to prevent mutations on the database
 */
export function validateQuerySafety(sql: string): { safe: boolean; error?: string } {
  // Normalize query structure
  const cleanSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove multi-line comments
    .replace(/--.*$/gm, '')           // remove single-line comments
    .trim()
    .toLowerCase();

  if (!cleanSql) {
    return { safe: false, error: 'Query is empty' };
  }

  // Strict starts-with check
  const allowedCommands = ['select', 'show', 'desc', 'describe', 'explain'];
  const firstWord = cleanSql.split(/[\s()]+/)[0];
  if (!allowedCommands.includes(firstWord)) {
    return {
      safe: false,
      error: `Query command '${firstWord.toUpperCase()}' is not allowed. Only read-only operations (SELECT, SHOW, DESCRIBE, EXPLAIN) are permitted.`
    };
  }

  // Forbidden keywords scan anywhere in the query to prevent injection multi-statements
  const forbiddenKeywords = [
    'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'replace',
    'create', 'rename', 'grant', 'revoke', 'load_file', 'outfile', 'dumpfile'
  ];

  for (const keyword of forbiddenKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(cleanSql)) {
      return {
        safe: false,
        error: `Security Violation: Keyword '${keyword.toUpperCase()}' is strictly prohibited to prevent data mutation.`
      };
    }
  }

  return { safe: true };
}

/**
 * Safe read-only wrapper for database executions
 */
export async function executeCustomQuery(env: 'qa' | 'dev' | 'prod', dbId: string, sqlQuery: string) {
  const safety = validateQuerySafety(sqlQuery);
  if (!safety.safe) {
    throw new Error(safety.error || 'Query security violation');
  }

  const pool = await getPool(env, dbId);
  const start = Date.now();
  const [rows, fields] = await pool.query(sqlQuery);
  const executionTimeMs = Date.now() - start;

  // Extract clean column names
  const columns = Array.isArray(fields)
    ? fields.map((f: any) => ({ name: f.name, type: f.type }))
    : [];

  return {
    rows: Array.isArray(rows) ? rows : [rows],
    columns,
    executionTimeMs
  };
}
