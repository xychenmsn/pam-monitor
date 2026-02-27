import { useState, useRef, useCallback, useEffect } from 'react'
import { type LogEvent, getStreamList, getLogEvents } from '@/lib/cloudwatch'

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
  const initializeApp = useCallback(async (appName: string, env: 'qa' | 'dev', initialStream?: string): Promise<void> => {
    const key = getAppKey(appName, env)

    // Skip if already polling
    if (intervalsRef.current.has(key)) {
      return
    }

    updateAppState(key, { loading: true, error: null, logs: [] })

    try {
      let streamName = initialStream

      if (!streamName) {
        // 1. Find the active stream (only if not provided)
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
        streamName = streams[0] // Latest stream
      }

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

      // Single poll loop: every 3s check for a newer stream AND fetch new log events.
      // getStreamList is a cheap DescribeLogStreams call — no need for a separate watcher.
      const intervalId = setInterval(async () => {
        const currentState = appLogsMapRef.current.get(key);
        if (!currentState || !currentState.connected || !currentState.streamName) return;

        try {
          // Step 1: Check if a newer stream has appeared (handles restarts and PSI new runs)
          const streams: string[] = await getStreamList(env, appName);
          const latestStream = streams?.[0];
          if (latestStream && latestStream !== currentState.streamName) {
            console.log(`[${key}] New stream detected: ${latestStream}`);
            const freshData = await getLogEvents(env, latestStream, 1000, false);
            updateAppState(key, {
              streamName: latestStream,
              logs: freshData.events,
              nextForwardToken: freshData.nextForwardToken,
              connected: true,
              error: null,
            });
            return; // Skip the normal token poll this tick — we just loaded fresh
          }

          // Step 2: Normal forward-token poll for new events on the current stream
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
            updateAppState(key, { nextForwardToken: result.nextForwardToken });
          }
        } catch (err: any) {
          console.error(`[${key}] Polling error:`, err);
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
