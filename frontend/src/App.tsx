import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom'
import { cn } from './lib/utils'
import { listApps, type App } from './lib/cloudwatch'
import Navbar from './components/navbar'
import Sidebar from './components/sidebar'
import Dashboard from './components/dashboard'
import AppDetailView from './components/app-detail-view'
import RobustAuthDialog from './components/robust-auth-dialog'
import { useAuthHeartbeat } from './hooks/useAuthHeartbeat'

// Shell wraps the layout (navbar + sidebar) and renders route children
function Shell() {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const { isAuthError, check: retryAuth } = useAuthHeartbeat(30000)
  const navigate = useNavigate()
  const { appId } = useParams<{ appId?: string }>()

  const environment = (searchParams.get('env') === 'dev' ? 'dev' : 'qa') as 'qa' | 'dev'

  const setEnvironment = (env: 'qa' | 'dev') => {
    setSearchParams(prev => { prev.set('env', env); return prev })
  }

  const fetchApps = useCallback(async () => {
    try {
      setLoading(true)
      const data = await listApps(environment)
      setApps(data)
    } catch (error) {
      console.error('Error fetching apps:', error)
    } finally {
      setLoading(false)
    }
  }, [environment])

  useEffect(() => { fetchApps() }, [fetchApps])

  const handleAppSelect = (appName: string, stream?: string) => {
    // stream is kept as a query param if provided
    const params = new URLSearchParams({ env: environment })
    if (stream) params.set('stream', stream)
    navigate(`/app/${appName}/logs?${params.toString()}`)
  }

  return (
    <>
      <RobustAuthDialog isOpen={isAuthError} onRetry={retryAuth} />
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Navbar
          environment={environment}
          onEnvironmentChange={setEnvironment}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            apps={apps}
            selectedApp={appId || ''}
            onAppSelect={(name) => handleAppSelect(name)}
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
  environment: 'qa' | 'dev'
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

export default function AppRoot() {
  return (
    <Routes>
      <Route path="/*" element={<Shell />} />
    </Routes>
  )
}
