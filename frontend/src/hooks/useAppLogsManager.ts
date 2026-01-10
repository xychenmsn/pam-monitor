import { useState, useRef, useCallback, useEffect } from 'react'
import { API_BASE, type LogEvent, getStreamList, getLogEvents } from '@/lib/cloudwatch'

interface AppLogsState {
  logs: LogEvent[]
  loading: boolean
  error: string | null
  connected: boolean // "Connected" means we found a stream and are polling
  streamName?: string
  nextForwardToken?: string
}

export function useAppLogsManager() {
  const [appLogsMap, setAppLogsMap] = useState<Map<string, AppLogsState>>(new Map())
  const appLogsMapRef = useRef(appLogsMap)
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  // Keep ref in sync
  useEffect(() => {
    appLogsMapRef.current = appLogsMap
  }, [appLogsMap])

  const updateAppState = useCallback((key: string, updates: Partial<AppLogsState>) => {
    setAppLogsMap((prev) => {
      const newMap = new Map(prev)
      const current = newMap.get(key) || {
        logs: [],
        loading: false,
        error: null,
        connected: false
      }
      newMap.set(key, { ...current, ...updates })
      return newMap
    })
  }, [])

  const getAppKey = (appName: string, env: 'qa' | 'dev') => `${env}:${appName}`

  /**
   * Start Polling for an app
   */
  const initializeApp = useCallback(async (appName: string, env: 'qa' | 'dev'): Promise<void> => {
    const key = getAppKey(appName, env)

    // Skip if already polling
    if (intervalsRef.current.has(key)) {
      return
    }

    updateAppState(key, { loading: true, error: null, logs: [] })

    try {
      // 1. Find the active stream
      const strings = await getStreamList(env, appName);
      // Ensure we treat the response correctly (it's string[])
      const streams: string[] = Array.isArray(strings) ? strings : (strings as any).streams || [];

      if (!streams || streams.length === 0) {
        updateAppState(key, {
          loading: false,
          error: 'No active log streams found for this app. Trigger some activity and try again.'
        })
        return;
      }

      const streamName = streams[0]; // Latest stream
      console.log(`[${key}] Found active stream: ${streamName}`);

      // 2. Initial Fetch
      const initialData = await getLogEvents(env, streamName, 1000, false);

      updateAppState(key, {
        loading: false,
        connected: true,
        streamName,
        logs: initialData.events,
        nextForwardToken: initialData.nextForwardToken
      });

      // 3. Start Polling Loop
      const intervalId = setInterval(async () => {
        const currentState = appLogsMapRef.current.get(key);
        if (!currentState || !currentState.connected || !currentState.streamName) return;

        try {
          // Poll using the forward token
          const result = await getLogEvents(
            env,
            currentState.streamName,
            1000,
            false,
            currentState.nextForwardToken
          );

          if (result.events.length > 0) {
            updateAppState(key, {
              logs: [...currentState.logs, ...result.events],
              nextForwardToken: result.nextForwardToken
            });
          } else if (result.nextForwardToken && result.nextForwardToken !== currentState.nextForwardToken) {
            // Even if 0 events, update token if changed (AWS sometimes rotates tokens even for empty)
            updateAppState(key, { nextForwardToken: result.nextForwardToken });
          }
        } catch (err: any) {
          console.error(`[${key}] Polling error:`, err);
          // If auth error, it might recover automatically via backend retry, 
          // but if persistent, maybe show warning? For now just log.
        }
      }, 3000); // Poll every 3 seconds

      intervalsRef.current.set(key, intervalId);

    } catch (err: any) {
      console.error(`[${key}] Init failed:`, err);
      updateAppState(key, {
        loading: false,
        error: err.message || 'Failed to initialize logs'
      });
    }

  }, [updateAppState])


  const getAppLogs = useCallback((appName: string, env: 'qa' | 'dev'): AppLogsState => {
    const key = getAppKey(appName, env)
    return appLogsMap.get(key) || {
      logs: [],
      loading: false,
      error: null,
      connected: false
    }
  }, [appLogsMap])

  const clearAppLogs = useCallback((appName: string, env: 'qa' | 'dev') => {
    const key = getAppKey(appName, env)
    const interval = intervalsRef.current.get(key)
    if (interval) {
      clearInterval(interval)
      intervalsRef.current.delete(key)
    }
    setAppLogsMap((prev) => {
      const newMap = new Map(prev)
      newMap.delete(key)
      return newMap
    })
  }, [])

  const clearAllPolling = useCallback(() => {
    for (const interval of intervalsRef.current.values()) {
      clearInterval(interval)
    }
    intervalsRef.current.clear()
    setAppLogsMap(new Map())
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const interval of intervalsRef.current.values()) {
        clearInterval(interval)
      }
      intervalsRef.current.clear()
    }
  }, [])

  return {
    initializeApp,
    getAppLogs,
    clearAppLogs,
    clearAllPolling,
  }
}

export type { AppLogsState, LogEvent }
