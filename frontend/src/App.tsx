import { useState, useEffect, useCallback } from 'react'
import { Database } from 'lucide-react'
import { cn } from './lib/utils'
import { listApps, type App, AuthError } from './lib/cloudwatch'
import Navbar from './components/navbar'
import Sidebar from './components/sidebar'
import LogViewer from './components/log-viewer'
import AuthDialog from './components/auth-dialog'

function AppComponent() {
  const [apps, setApps] = useState<App[]>([])
  const [selectedApp, setSelectedApp] = useState<string>('')
  const [environment, setEnvironment] = useState<'qa' | 'dev'>('qa')
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [authError, setAuthError] = useState(false)

  // Fetch available apps directly from AWS
  const fetchApps = useCallback(async () => {
    try {
      setLoading(true)
      const data = await listApps(environment)
      setApps(data)
      setAuthError(false)
      if (data.length > 0 && !selectedApp) {
        setSelectedApp(data[0].name)
      }
    } catch (error) {
      console.error('Error fetching apps:', error)
      if (error instanceof AuthError) {
        setAuthError(true)
      }
    } finally {
      setLoading(false)
    }
  }, [environment, selectedApp])

  useEffect(() => {
    fetchApps()
  }, [fetchApps, environment])

  // Update selected app if current selection is no longer available
  useEffect(() => {
    if (apps.length > 0 && !apps.find(a => a.name === selectedApp)) {
      setSelectedApp(apps[0].name)
    }
  }, [apps, selectedApp])

  const handleRetryAuth = () => {
    setAuthError(false)
    fetchApps()
  }

  return (
    <>
      <AuthDialog isOpen={authError} onRetry={handleRetryAuth} />
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
          onAppSelect={setSelectedApp}
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
            <LogViewer
              appName={selectedApp}
              appDisplayName={apps.find(a => a.name === selectedApp)?.displayName || selectedApp}
              environment={environment}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Database className="mx-auto mb-4 h-16 w-16 opacity-50" />
                <p className="text-lg">No apps available</p>
                <p className="text-sm">Make sure you've run `peacock security` to authenticate with AWS</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
    </>
  )
}

export default AppComponent
