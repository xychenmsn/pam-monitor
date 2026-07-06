import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Database, 
  Search, 
  Play, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle,
  Table as TableIcon,
  Terminal,
  Activity
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  listTables, 
  getTableData, 
  executeCustomQuery, 
  type TableColumn,
  type TableDataResponse,
  type QueryResponse
} from '../lib/db';

interface DbExplorerProps {
  dbId: string;
  environment: 'qa' | 'dev' | 'prod';
  onBack: () => void;
}

export default function DbExplorer({ dbId, environment, onBack }: DbExplorerProps) {
  // Lists
  const [tables, setTables] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingTables, setLoadingTables] = useState(true);
  
  // Selection
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  
  // Custom Query
  const [sqlQuery, setSqlQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [executingQuery, setExecutingQuery] = useState(false);
  const [activeMode, setActiveMode] = useState<'browse' | 'query'>('browse');

  // Pagination
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);

  // General Errors (e.g. connection error)
  const [dbError, setDbError] = useState<string | null>(null);

  // Request counter to discard stale async results
  const requestCountRef = useRef(0);

  // Fetch Tables List
  const fetchTables = useCallback(async () => {
    requestCountRef.current += 1;
    const reqId = requestCountRef.current;

    try {
      setLoadingTables(true);
      setDbError(null);
      const data = await listTables(environment, dbId);
      if (reqId !== requestCountRef.current) return;

      setTables(data);
      // Auto-select first table if none is selected
      if (data.length > 0 && !selectedTable) {
        setSelectedTable(data[0]);
      }
    } catch (err: any) {
      if (reqId !== requestCountRef.current) return;
      console.error('Failed to load tables:', err);
      setDbError(err.message || 'Failed to establish connection to database. Make sure you are connected to the corporate VPN.');
    } finally {
      if (reqId === requestCountRef.current) {
        setLoadingTables(false);
      }
    }
  }, [environment, dbId, selectedTable]);

  useEffect(() => {
    fetchTables();
  }, [dbId, environment]);

  // Fetch Table Data when selection or pagination shifts
  const fetchTableData = useCallback(async (tableName: string, currentOffset: number) => {
    if (!tableName) return;
    requestCountRef.current += 1;
    const reqId = requestCountRef.current;

    try {
      setLoadingData(true);
      setDbError(null);
      const data = await getTableData(environment, dbId, tableName, limit, currentOffset);
      if (reqId !== requestCountRef.current) return;

      setTableData(data);
    } catch (err: any) {
      if (reqId !== requestCountRef.current) return;
      console.error('Failed to fetch table rows:', err);
      setDbError(err.message || `Failed to fetch data for table '${tableName}'`);
    } finally {
      if (reqId === requestCountRef.current) {
        setLoadingData(false);
      }
    }
  }, [environment, dbId, limit]);

  useEffect(() => {
    if (activeMode === 'browse' && selectedTable) {
      fetchTableData(selectedTable, offset);
    }
  }, [selectedTable, offset, activeMode, fetchTableData]);

  // Handle Switch Table
  const handleTableSelect = (tableName: string) => {
    setSelectedTable(tableName);
    setOffset(0);
    setTableData(null);
    setActiveMode('browse');
    setQueryError(null);
    setQueryResult(null);
  };

  // Local Read-Only Security Guard
  const validateQueryFront = (query: string): string | null => {
    const clean = query
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .trim()
      .toLowerCase();

    if (!clean) return 'Query string is empty';

    const allowed = ['select', 'show', 'desc', 'describe', 'explain'];
    const firstWord = clean.split(/[\s()]+/)[0];
    if (!allowed.includes(firstWord)) {
      return `Security Block: '${firstWord.toUpperCase()}' is unauthorized. You can only execute read-only queries (SELECT, SHOW, DESCRIBE, EXPLAIN).`;
    }

    const forbidden = [
      'insert', 'update', 'delete', 'drop', 'truncate', 'alter', 'replace',
      'create', 'rename', 'grant', 'revoke'
    ];
    for (const word of forbidden) {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(clean)) {
        return `Security Block: Mutating keyword '${word.toUpperCase()}' is strictly prohibited.`;
      }
    }
    return null;
  };

  // Run Custom SQL
  const handleExecuteQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sqlQuery.trim()) return;

    // Run security validator locally first
    const securityErr = validateQueryFront(sqlQuery);
    if (securityErr) {
      setQueryError(securityErr);
      setQueryResult(null);
      return;
    }

    try {
      setExecutingQuery(true);
      setQueryError(null);
      setQueryResult(null);
      const res = await executeCustomQuery(environment, dbId, sqlQuery);
      setQueryResult(res);
      setActiveMode('query');
    } catch (err: any) {
      console.error('SQL query error:', err);
      setQueryError(err.message || 'SQL query execution failed');
    } finally {
      setExecutingQuery(false);
    }
  };

  // Filter tables by search query
  const filteredTables = tables.filter(t => 
    t.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar */}
      <header className="flex h-14 items-center justify-between border-b px-6 bg-card shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          <div className="h-4 w-px bg-border mx-2" />
          <Database className="h-5 w-5 text-indigo-500" />
          <h1 className="text-sm font-bold tracking-tight uppercase text-foreground">
            {dbId === 'agency-gateway-db' ? 'Agency Gateway Database' : dbId}
          </h1>
          <span className={cn(
            "text-xs px-2.5 py-0.5 rounded-full font-bold uppercase",
            environment === 'qa' ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
            environment === 'dev' ? "bg-green-500/10 text-green-500 border border-green-500/20" :
            "bg-rose-500/10 text-rose-500 border border-rose-500/20"
          )}>
            {environment}
          </span>
        </div>
        <button 
          onClick={() => {
            fetchTables();
            if (selectedTable) fetchTableData(selectedTable, offset);
          }}
          className="p-2 text-muted-foreground hover:text-foreground transition rounded-md hover:bg-accent"
          title="Refresh Data"
        >
          <RefreshCw className={cn("h-4 w-4", (loadingTables || loadingData) && "animate-spin")} />
        </button>
      </header>

      {/* Main split-screen panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table Sidebar (Searchable list of all schema tables) */}
        <aside className="w-72 border-r bg-card flex flex-col shrink-0">
          <div className="p-4 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tables..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{filteredTables.length} tables found</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingTables ? (
              <div className="flex items-center justify-center p-8 gap-2 text-xs text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                Loading schema...
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">
                No matching tables found.
              </div>
            ) : (
              filteredTables.map((t) => (
                <button
                  key={t}
                  onClick={() => handleTableSelect(t)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-left font-medium transition",
                    selectedTable === t && activeMode === 'browse'
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                  )}
                >
                  <TableIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  <span className="truncate">{t}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col bg-muted/20 overflow-hidden">
          {/* Connection/General DB Error banners */}
          {dbError && (
            <div className="p-4 bg-red-500/10 border-b border-red-500/20 text-red-500 text-xs font-medium flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Database Error</p>
                <p className="mt-1 opacity-90 leading-relaxed">{dbError}</p>
                <p className="mt-2 text-[10px] text-muted-foreground font-mono">
                  Troubleshoot: Verify that your NBC VPN is connected and that your server is running.
                </p>
              </div>
            </div>
          )}

          {/* SQL Console Console Terminal Editor */}
          <section className="bg-card border-b p-4 shrink-0">
            <form onSubmit={handleExecuteQuery} className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Terminal className="h-4 w-4 text-indigo-400" />
                  <span>Custom SQL Editor (SELECT only)</span>
                </div>
                <button
                  type="submit"
                  disabled={executingQuery || !sqlQuery.trim()}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md disabled:opacity-50 disabled:hover:bg-indigo-600 transition"
                >
                  <Play className={cn("h-3.5 w-3.5", executingQuery && "animate-spin")} />
                  {executingQuery ? 'Running...' : 'Run Query'}
                </button>
              </div>

              <textarea
                value={sqlQuery}
                onChange={e => setSqlQuery(e.target.value)}
                placeholder={`-- Write custom SQL here e.g.\nSELECT * FROM verticals LIMIT 10;`}
                className="w-full h-24 p-3 text-xs font-mono rounded-md bg-muted border border-border text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />

              {/* Execution Feedback / Alerts */}
              {queryError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md text-red-500 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{queryError}</span>
                </div>
              )}
            </form>
          </section>

          {/* Table Data Grid Viewer */}
          <div className="flex-1 flex flex-col min-h-0">
            {activeMode === 'browse' && selectedTable ? (
              /* Browse Mode */
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Meta stats bar */}
                <div className="px-6 py-2 border-b bg-card flex items-center justify-between text-xs text-muted-foreground shrink-0">
                  <div className="flex items-center gap-1.5 font-medium">
                    <TableIcon className="h-3.5 w-3.5 text-primary" />
                    <span>Table: <strong className="text-foreground">{selectedTable}</strong></span>
                  </div>
                  {tableData && (
                    <span>
                      Viewing {offset + 1} - {Math.min(offset + limit, tableData.total)} of{' '}
                      <strong>{tableData.total}</strong> rows
                    </span>
                  )}
                </div>

                {/* Table structure schemas info */}
                {tableData && tableData.columns.length > 0 && (
                  <div className="bg-muted/10 border-b px-6 py-1.5 overflow-x-auto whitespace-nowrap shrink-0 flex items-center gap-4 text-[10px] text-muted-foreground font-mono">
                    <span className="font-bold">Columns:</span>
                    {tableData.columns.map((col: TableColumn) => (
                      <span key={col.Field} title={`Null: ${col.Null} | Key: ${col.Key}`}>
                        {col.Field} <span className="text-indigo-400">({col.Type})</span>
                        {col.Key && <span className="text-amber-500 ml-0.5 text-[9px] font-bold">[{col.Key}]</span>}
                      </span>
                    ))}
                  </div>
                )}

                {/* Scrolling Grid */}
                <div className="flex-1 overflow-auto bg-card">
                  {loadingData ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3">
                      <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">Loading table records...</span>
                    </div>
                  ) : !tableData || tableData.rows.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-muted-foreground">
                      <p className="text-xs">No records found inside '{selectedTable}'.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-muted/40 sticky top-0 border-b z-[5]">
                        <tr>
                          {tableData.columns.map((col) => (
                            <th 
                              key={col.Field} 
                              className="px-4 py-2 font-bold text-muted-foreground tracking-tight border-r border-b text-[10px] bg-muted/40 uppercase font-mono"
                            >
                              {col.Field}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {tableData.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30 transition font-mono">
                            {tableData.columns.map((col) => (
                              <td 
                                key={col.Field} 
                                className="px-4 py-2 border-r max-w-xs truncate text-[11px] text-foreground"
                                title={row[col.Field] !== null ? String(row[col.Field]) : 'NULL'}
                              >
                                {row[col.Field] === null ? (
                                  <span className="text-muted-foreground/45 italic">NULL</span>
                                ) : typeof row[col.Field] === 'object' ? (
                                  JSON.stringify(row[col.Field])
                                ) : (
                                  String(row[col.Field])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Grid Pagination Footer */}
                {tableData && tableData.total > limit && (
                  <footer className="h-12 border-t px-6 bg-card flex items-center justify-between shrink-0">
                    <button
                      onClick={() => setOffset(Math.max(0, offset - limit))}
                      disabled={offset === 0 || loadingData}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-muted hover:bg-accent disabled:opacity-40 transition"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Page {Math.floor(offset / limit) + 1} of {Math.ceil(tableData.total / limit)}
                    </span>
                    <button
                      onClick={() => setOffset(offset + limit)}
                      disabled={offset + limit >= tableData.total || loadingData}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded bg-muted hover:bg-accent disabled:opacity-40 transition"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </footer>
                )}
              </div>
            ) : activeMode === 'query' && queryResult ? (
              /* Custom Query View */
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 py-2 border-b bg-card flex items-center justify-between text-xs text-muted-foreground shrink-0">
                  <div className="flex items-center gap-2 font-medium">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    <span>SQL Query Executed Successfully</span>
                    <span className="bg-emerald-500/10 text-emerald-500 px-2 py-0.5 rounded text-[10px] font-bold">
                      {queryResult.executionTimeMs}ms
                    </span>
                  </div>
                  <span>Returned <strong>{queryResult.rows.length}</strong> rows</span>
                </div>

                <div className="flex-1 overflow-auto bg-card">
                  {queryResult.rows.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-muted-foreground">
                      <CheckCircle className="h-8 w-8 text-emerald-500 mb-2" />
                      <p className="text-xs font-medium">Query executed successfully, but returned 0 rows.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-muted/40 sticky top-0 border-b z-[5]">
                        <tr>
                          {queryResult.columns.map((col) => (
                            <th 
                              key={col.name} 
                              className="px-4 py-2 font-bold text-muted-foreground tracking-tight border-r border-b text-[10px] bg-muted/40 uppercase font-mono"
                            >
                              {col.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y font-mono">
                        {queryResult.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-muted/30 transition">
                            {queryResult.columns.map((col) => (
                              <td 
                                key={col.name} 
                                className="px-4 py-2 border-r max-w-xs truncate text-[11px] text-foreground"
                                title={row[col.name] !== null ? String(row[col.name]) : 'NULL'}
                              >
                                {row[col.name] === null ? (
                                  <span className="text-muted-foreground/45 italic">NULL</span>
                                ) : typeof row[col.name] === 'object' ? (
                                  JSON.stringify(row[col.name])
                                ) : (
                                  String(row[col.name])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ) : (
              /* Landing / Placeholder View */
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-12 text-center bg-card">
                <Database className="h-12 w-12 text-indigo-400/40 mb-3 animate-pulse" />
                <h3 className="text-sm font-bold text-foreground mb-1">Explore Connected Tables</h3>
                <p className="text-xs max-w-sm leading-relaxed text-muted-foreground">
                  Select a table from the sidebar to inspect its schemas/rows, or type a custom SELECT SQL query inside the console above.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
