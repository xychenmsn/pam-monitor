import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate, useParams, useSearchParams, Navigate, useLocation } from 'react-router-dom'
import { cn } from './lib/utils'
import { listApps, type App } from './lib/cloudwatch'
import { listDatabases, type DatabaseConfig } from './lib/db'
import Navbar from './components/navbar'
import Sidebar from './components/sidebar'
import Dashboard from './components/dashboard'
import AppDetailView from './components/app-detail-view'
import DbExplorer from './components/db-explorer'
import RobustAuthDialog from './components/robust-auth-dialog'
import { useAuthHeartbeat } from './hooks/useAuthHeartbeat'

// Shell wraps the layout (navbar + sidebar) and renders route children
function Shell() {
  const [apps, setApps] = useState<App[]>([])
  const [databases, setDatabases] = useState<DatabaseConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const { isAuthError, check: retryAuth } = useAuthHeartbeat(30000)
  const [manualAuthOpen, setManualAuthOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { appId } = useParams<{ appId?: string }>()

  const environment = (() => {
    const env = searchParams.get('env');
    if (env === 'prod') return 'prod';
    if (env === 'dev') return 'dev';
    return 'qa';
  })() as 'qa' | 'dev' | 'prod'

  const setEnvironment = (env: 'qa' | 'dev' | 'prod') => {
    setSearchParams(prev => { prev.set('env', env); return prev })
  }

  // Extract selected DB from location pathname
  const dbMatch = location.pathname.match(/\/database\/([^/]+)/)
  const selectedDbId = dbMatch ? dbMatch[1] : ''

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [appsData, dbsData] = await Promise.all([
        listApps(environment),
        listDatabases(environment)
      ])
      setApps(appsData)
      setDatabases(dbsData)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }, [environment])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAppSelect = (appName: string, stream?: string) => {
    const params = new URLSearchParams({ env: environment })
    if (stream) params.set('stream', stream)
    navigate(`/app/${appName}/logs?${params.toString()}`)
  }

  const handleDbSelect = (dbId: string) => {
    navigate(`/database/${dbId}?env=${environment}`)
  }

  return (
    <>
      <RobustAuthDialog
        isOpen={isAuthError || manualAuthOpen}
        environment={environment}
        onRetry={retryAuth}
        onClose={() => setManualAuthOpen(false)}
        isManual={manualAuthOpen && !isAuthError}
      />
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Navbar
          environment={environment}
          onEnvironmentChange={setEnvironment}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onReconnectClick={() => setManualAuthOpen(true)}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            apps={apps}
            selectedApp={appId || ''}
            onAppSelect={(name) => handleAppSelect(name)}
            databases={databases}
            selectedDb={selectedDbId}
            onDbSelect={handleDbSelect}
            collapsed={sidebarCollapsed}
            loading={loading}
          />
          <main className={cn('flex-1 overflow-hidden', sidebarCollapsed ? 'ml-16' : 'ml-64')}>
            <Routes>
              <Route
                path="/"
                element={
                  <Dashboard
                    environment={environment}
                    onAppSelect={handleAppSelect}
                    isAuthError={isAuthError}
                  />
                }
              />
              <Route
                path="/app/:appId/:tab?"
                element={
                  <AppDetailViewRoute
                    environment={environment}
                    isAuthError={isAuthError}
                  />
                }
              />
              <Route
                path="/database/:dbId"
                element={
                  <DbExplorerRoute
                    environment={environment}
                  />
                }
              />
              {/* Catch-all → home */}
              <Route path="*" element={<Navigate to={`/?env=${environment}`} replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </>
  )
}

// Separate component so it can use useParams freely
function AppDetailViewRoute({
  environment,
  isAuthError,
}: {
  environment: 'qa' | 'dev' | 'prod'
  isAuthError: boolean
}) {
  const { appId, tab } = useParams<{ appId: string; tab?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const initialStream = searchParams.get('stream') || undefined

  if (!appId) return <Navigate to="/" replace />

  return (
    <AppDetailView
      appName={appId}
      initialStream={initialStream}
      environment={environment}
      activeTab={(tab as any) || 'logs'}
      onBack={() => navigate(`/?env=${environment}`)}
      isAuthError={isAuthError}
    />
  )
}

function DbExplorerRoute({ environment }: { environment: 'qa' | 'dev' | 'prod' }) {
  const { dbId } = useParams<{ dbId: string }>()
  const navigate = useNavigate()

  if (!dbId) return <Navigate to="/" replace />

  return (
    <DbExplorer
      dbId={dbId}
      environment={environment}
      onBack={() => navigate(`/?env=${environment}`)}
    />
  )
}

export default function AppRoot() {
  return (
    <Routes>
      <Route path="/*" element={<Shell />} />
    </Routes>
  )
}
