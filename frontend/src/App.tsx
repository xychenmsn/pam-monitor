import { useState, useEffect, useCallback } from 'react'
import { cn } from './lib/utils'
import { listApps, type App } from './lib/cloudwatch'
import Navbar from './components/navbar'
import Sidebar from './components/sidebar'
import Dashboard from './components/dashboard'
import AppDetailView from './components/app-detail-view'
import RobustAuthDialog from './components/robust-auth-dialog'
import { useAuthHeartbeat } from './hooks/useAuthHeartbeat'

function AppComponent() {
  const [apps, setApps] = useState<App[]>([])
  const [selectedApp, setSelectedApp] = useState<string>('')
  const [initialStream, setInitialStream] = useState<string | undefined>(undefined)
  const [environment, setEnvironment] = useState<'qa' | 'dev'>('qa')
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { isAuthError, check: retryAuth } = useAuthHeartbeat(30000)

  // Fetch available apps directly from AWS
  const fetchApps = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true)
      const data = await listApps(environment)
      setApps(data)
      return true // Success
    } catch (error) {
      console.error('Error fetching apps:', error)
      return false // Failed
    } finally {
      setLoading(false)
    }
  }, [environment])

  useEffect(() => {
    fetchApps()
  }, [fetchApps, environment])

  // Update selected app if current selection is no longer available
  useEffect(() => {
    if (apps.length > 0 && selectedApp && !apps.find(a => a.name === selectedApp)) {
      setSelectedApp('')
      setInitialStream(undefined)
    }
  }, [apps, selectedApp])

  const handleAppSelect = (appName: string, stream?: string) => {
    setSelectedApp(appName)
    setInitialStream(stream)
  }

  return (
    <>
      <RobustAuthDialog isOpen={isAuthError} onRetry={retryAuth} />
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Navbar */}
        <Navbar
          environment={environment}
          onEnvironmentChange={setEnvironment}
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <Sidebar
            apps={apps}
            selectedApp={selectedApp}
            onAppSelect={(name) => handleAppSelect(name, undefined)}
            collapsed={sidebarCollapsed}
            loading={loading}
          />

          {/* Log Viewer */}
          <main
            className={cn(
              'flex-1 overflow-hidden',
              sidebarCollapsed ? 'ml-16' : 'ml-64'
            )}
          >
            {selectedApp ? (
              <AppDetailView
                appName={selectedApp}
                initialStream={initialStream || undefined}
                environment={environment}
                onBack={() => {
                  setSelectedApp('')
                  setInitialStream(undefined)
                }}
                isAuthError={isAuthError}
              />
            ) : (
              <Dashboard
                environment={environment}
                onAppSelect={handleAppSelect}
                isAuthError={isAuthError}
              />
            )}
          </main>
        </div>
      </div>
    </>
  )
}

export default AppComponent
