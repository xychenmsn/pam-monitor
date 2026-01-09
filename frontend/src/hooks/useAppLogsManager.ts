import { useState, useRef, useCallback, useEffect } from 'react'
import { fetchLatestLogs, fetchOlderLogs, fetchNewLogs, type LogEvent } from '@/lib/cloudwatch'

interface AppLogsState {
  logs: LogEvent[]
  loading: boolean
  error: string | null
  hasMore: boolean // whether there are more historical logs to load
  newestTimestamp: number // timestamp of newest log
  oldestTimestamp: number // timestamp of oldest log
}

/**
 * Manages logs for all apps in memory
 * Logs persist when switching between apps
 */
export function useAppLogsManager() {
  const [appLogsMap, setAppLogsMap] = useState<Map<string, AppLogsState>>(new Map())
  const pollIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Helper to update state for a specific app and trigger re-render
  const updateAppState = useCallback((key: string, updates: Partial<AppLogsState>) => {
    setAppLogsMap((prev) => {
      const newMap = new Map(prev)
      const current = newMap.get(key) || {
        logs: [],
        loading: false,
        error: null,
        hasMore: true,
        newestTimestamp: 0,
        oldestTimestamp: 0,
      }
      newMap.set(key, { ...current, ...updates })
      return newMap
    })
  }, [])

  /**
   * Initialize logs for an app (load latest logs on first selection)
   */
  const initializeApp = useCallback(async (appName: string, env: 'qa' | 'dev'): Promise<void> => {
    const key = `${env}:${appName}`

    // Skip if already initialized
    if (appLogsMap.has(key)) {
      return
    }

    // Set loading state
    updateAppState(key, {
      logs: [],
      loading: true,
      error: null,
      hasMore: true,
      newestTimestamp: 0,
      oldestTimestamp: Infinity,
    })

    try {
      // Fetch latest logs (most recent first)
      const logs = await fetchLatestLogs(env, appName, 500)

      if (logs.length > 0) {
        const newestTimestamp = Math.max(...logs.map(l => l.timestamp))
        const oldestTimestamp = Math.min(...logs.map(l => l.timestamp))

        updateAppState(key, {
          logs,
          loading: false,
          error: null,
          hasMore: true, // Assume there might be more historical logs
          newestTimestamp,
          oldestTimestamp,
        })

        // Start polling for new logs
        startPolling(appName, env)
      } else {
        updateAppState(key, {
          logs: [],
          loading: false,
          error: null,
          hasMore: false,
          newestTimestamp: 0,
          oldestTimestamp: 0,
        })
      }
    } catch (error) {
      updateAppState(key, {
        logs: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load logs',
        hasMore: false,
        newestTimestamp: 0,
        oldestTimestamp: 0,
      })
    }
  }, [appLogsMap, updateAppState])

  /**
   * Start polling for new logs
   */
  const startPolling = useCallback((appName: string, env: 'qa' | 'dev', interval = 3000) => {
    const key = `${env}:${appName}`

    // Clear existing interval if any
    const existing = pollIntervalsRef.current.get(key)
    if (existing) {
      clearInterval(existing)
    }

    // Start new poll interval
    const pollInterval = setInterval(async () => {
      const state = appLogsMap.get(key)
      if (!state || state.loading) return

      try {
        // Fetch logs newer than our newest timestamp
        const newLogs = await fetchNewLogs(env, appName, state.newestTimestamp)

        if (newLogs.length > 0) {
          // Filter out duplicates and add to state
          const existingTimestamps = new Set(state.logs.map(l => `${l.timestamp}-${l.stream}`))
          const uniqueNewLogs = newLogs.filter(l => !existingTimestamps.has(`${l.timestamp}-${l.stream}`))

          if (uniqueNewLogs.length > 0) {
            const updatedLogs = [...state.logs, ...uniqueNewLogs]
            const newestTimestamp = Math.max(...updatedLogs.map(l => l.timestamp))

            updateAppState(key, {
              logs: updatedLogs,
              newestTimestamp,
            })
          }
        }
      } catch (error) {
        console.error('Error polling for new logs:', error)
      }
    }, interval)

    pollIntervalsRef.current.set(key, pollInterval)
  }, [appLogsMap, updateAppState])

  /**
   * Stop polling for an app
   */
  const stopPolling = useCallback((appName: string, env: 'qa' | 'dev') => {
    const key = `${env}:${appName}`
    const interval = pollIntervalsRef.current.get(key)
    if (interval) {
      clearInterval(interval)
      pollIntervalsRef.current.delete(key)
    }
  }, [])

  /**
   * Load older logs (background loading)
   */
  const loadOlderLogs = useCallback(async (appName: string, env: 'qa' | 'dev'): Promise<void> => {
    const key = `${env}:${appName}`
    const state = appLogsMap.get(key)

    if (!state || state.loading || !state.hasMore) {
      return
    }

    // Set loading for this app
    updateAppState(key, { loading: true })

    try {
      // Fetch logs older than our oldest timestamp
      const olderLogs = await fetchOlderLogs(env, appName, state.oldestTimestamp, 500)

      if (olderLogs.length > 0) {
        // Filter out duplicates
        const existingTimestamps = new Set(state.logs.map(l => `${l.timestamp}-${l.stream}`))
        const uniqueOlderLogs = olderLogs.filter(l => !existingTimestamps.has(`${l.timestamp}-${l.stream}`))

        if (uniqueOlderLogs.length > 0) {
          const updatedLogs = [...uniqueOlderLogs, ...state.logs]
          const oldestTimestamp = Math.min(...updatedLogs.map(l => l.timestamp))

          updateAppState(key, {
            logs: updatedLogs,
            loading: false,
            oldestTimestamp,
            hasMore: uniqueOlderLogs.length === 500, // If we got a full batch, there might be more
          })
        } else {
          updateAppState(key, { loading: false, hasMore: false })
        }
      } else {
        // No more logs available
        updateAppState(key, { loading: false, hasMore: false })
      }
    } catch (error) {
      updateAppState(key, {
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load older logs',
      })
    }
  }, [updateAppState])

  /**
   * Get logs for a specific app
   */
  const getAppLogs = useCallback((appName: string, env: 'qa' | 'dev'): AppLogsState => {
    const key = `${env}:${appName}`
    return appLogsMap.get(key) || {
      logs: [],
      loading: false,
      error: null,
      hasMore: false,
      newestTimestamp: 0,
      oldestTimestamp: 0,
    }
  }, [appLogsMap])

  /**
   * Clear logs for a specific app
   */
  const clearAppLogs = useCallback((appName: string, env: 'qa' | 'dev') => {
    const key = `${env}:${appName}`
    stopPolling(appName, env)
    setAppLogsMap((prev) => {
      const newMap = new Map(prev)
      newMap.delete(key)
      return newMap
    })
  }, [stopPolling])

  /**
   * Cleanup all intervals
   */
  useEffect(() => {
    return () => {
      for (const interval of pollIntervalsRef.current.values()) {
        clearInterval(interval)
      }
    }
  }, [])

  return {
    initializeApp,
    getAppLogs,
    loadOlderLogs,
    clearAppLogs,
  }
}

export type { AppLogsState, LogEvent }
