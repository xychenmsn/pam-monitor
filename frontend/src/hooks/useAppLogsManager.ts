import { useState, useRef, useCallback, useEffect } from 'react'
import { getStreamList, fetchLatestLogs, fetchLogsFromStream, pollStreams, type LogEvent, AuthError } from '@/lib/cloudwatch'

interface StreamState {
  streamName: string
  lastTimestamp: number
  loaded: boolean
  loading: boolean
}

interface AppLogsState {
  logs: LogEvent[]
  loading: boolean
  error: string | null
  newestTimestamp: number
  oldestTimestamp: number
  streams: StreamState[] // All streams sorted by recency
  latestStreamIndex: number // Index of the actively monitored stream
  lastPollTime: number
}

/**
 * Two-stage log loading system:
 * 1. Initial: Load only the latest log stream (last 24 hours)
 * 2. Background 1: Gradually load older streams (2nd, 3rd, etc.)
 * 3. Background 2: Continuously monitor the latest stream for new entries
 */
export function useAppLogsManager() {
  const [appLogsMap, setAppLogsMap] = useState<Map<string, AppLogsState>>(new Map())
  const appLogsMapRef = useRef(appLogsMap)
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const loadingOlderStreamsRef = useRef<Map<string, boolean>>(new Map())

  // Keep ref in sync with state
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
        newestTimestamp: 0,
        oldestTimestamp: 0,
        streams: [],
        latestStreamIndex: -1,
        lastPollTime: Date.now(),
      }
      newMap.set(key, { ...current, ...updates })
      return newMap
    })
  }, [])

  /**
   * Initialize app - load latest stream only
   */
  const initializeApp = useCallback(async (appName: string, env: 'qa' | 'dev'): Promise<void> => {
    // Use ref to check if already initialized (avoids dependency on appLogsMap)
    const key = `${env}:${appName}`

    // Skip if already initialized (using ref to avoid dependency on appLogsMap)
    if (appLogsMapRef.current.has(key)) {
      return
    }

    updateAppState(key, {
      logs: [],
      loading: true,
      error: null,
      streams: [],
      latestStreamIndex: -1,
      newestTimestamp: 0,
      oldestTimestamp: 0,
      lastPollTime: Date.now(),
    })

    try {
      // Get all streams sorted by recency (most recent first)
      const streamList = await getStreamList(env, appName)
      const streamsState: StreamState[] = streamList.map(name => ({
        streamName: name,
        lastTimestamp: 0,
        loaded: false,
        loading: false,
      }))

      if (streamsState.length === 0) {
        updateAppState(key, {
          logs: [],
          loading: false,
          error: 'No log streams found',
          streams: [],
          latestStreamIndex: -1,
        })
        return
      }

      // Load logs from last 24 hours across ALL streams (not just the latest one)
      const logs = await fetchLatestLogs(env, appName, 1000)

      // Group logs by stream to track which streams we've loaded
      const logsByStream = new Map<string, LogEvent[]>()
      for (const log of logs) {
        if (!logsByStream.has(log.stream)) {
          logsByStream.set(log.stream, [])
        }
        logsByStream.get(log.stream)!.push(log)
      }

      // Mark streams that have logs as loaded
      for (const [streamName, streamLogs] of logsByStream.entries()) {
        const streamIndex = streamsState.findIndex(s => s.streamName === streamName)
        if (streamIndex >= 0) {
          streamsState[streamIndex].loaded = true
          streamsState[streamIndex].lastTimestamp = Math.max(...streamLogs.map(l => l.timestamp))
        }
      }

      // Find the most recent stream (highest timestamp) for polling
      let mostRecentStreamIndex = -1
      let mostRecentTimestamp = 0
      for (let i = 0; i < streamsState.length; i++) {
        if (streamsState[i].lastTimestamp > mostRecentTimestamp) {
          mostRecentTimestamp = streamsState[i].lastTimestamp
          mostRecentStreamIndex = i
        }
      }

      if (logs.length > 0) {
        const newestTimestamp = Math.max(...logs.map(l => l.timestamp))
        const oldestTimestamp = Math.min(...logs.map(l => l.timestamp))

        updateAppState(key, {
          logs,
          loading: false,
          error: null,
          newestTimestamp,
          oldestTimestamp,
          streams: streamsState,
          latestStreamIndex: mostRecentStreamIndex >= 0 ? mostRecentStreamIndex : 0,
        })
      } else {
        updateAppState(key, {
          logs: [],
          loading: false,
          error: null,
          streams: streamsState,
          latestStreamIndex: 0,
        })
      }

      // Start background processes regardless of whether we found logs
      startPollingLatestStream(appName, env)
      startLoadingOlderStreams(appName, env)
    } catch (error) {
      // Log AuthError but don't re-throw - let the app state handle it
      if (error instanceof AuthError) {
        updateAppState(key, {
          logs: [],
          loading: false,
          error: 'AWS credentials expired. Please run `peacock security` and retry.',
          streams: [],
          latestStreamIndex: -1,
        })
        return
      }
      updateAppState(key, {
        logs: [],
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load logs',
        streams: [],
        latestStreamIndex: -1,
      })
    }
    // Note: We intentionally exclude appLogsMap from deps and use appLogsMapRef instead
    // to prevent infinite loops when state updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateAppState])

  /**
   * Background process 1: Load older streams (2nd, 3rd, etc.) gradually
   * Looks for logs not yet loaded (fills gaps in 24h window, then older)
   */
  const startLoadingOlderStreams = useCallback((appName: string, env: 'qa' | 'dev') => {
    const key = `${env}:${appName}`
    const startTime = Date.now() - 24 * 60 * 60 * 1000 // Last 24 hours

    // Load one stream at a time, starting from index 1 (2nd latest)
    const loadNextStream = async (index: number) => {
      const state = appLogsMapRef.current.get(key)
      if (!state || index >= state.streams.length) {
        // All streams loaded
        loadingOlderStreamsRef.current.delete(key)
        return
      }

      const stream = state.streams[index]
      if (stream.loaded || stream.loading) {
        // Already loaded or loading, move to next
        loadNextStream(index + 1)
        return
      }

      // Mark as loading
      updateAppState(key, {
        streams: state.streams.map((s, i) =>
          i === index ? { ...s, loading: true } : s
        ),
      })

      try {
        const logs = await fetchLogsFromStream(env, stream.streamName, startTime)

        // Re-read state after async operation to avoid stale closure
        const currentState = appLogsMapRef.current.get(key)
        if (!currentState) return

        if (logs.length > 0) {
          // Filter duplicates and merge with existing logs (using fresh state)
          const existingKeys = new Set(currentState.logs.map(l => `${l.timestamp}-${l.stream}`))
          const uniqueLogs = logs.filter(l => !existingKeys.has(`${l.timestamp}-${l.stream}`))

          if (uniqueLogs.length > 0) {
            const updatedLogs = [...currentState.logs, ...uniqueLogs].sort((a, b) => a.timestamp - b.timestamp)
            const lastTimestamp = Math.max(...logs.map(l => l.timestamp))

            updateAppState(key, {
              logs: updatedLogs,
              oldestTimestamp: Math.min(...updatedLogs.map(l => l.timestamp)),
              streams: currentState.streams.map((s, i) =>
                i === index ? { ...s, loaded: true, loading: false, lastTimestamp } : s
              ),
            })
          } else {
            // No unique logs in this stream
            updateAppState(key, {
              streams: currentState.streams.map((s, i) =>
                i === index ? { ...s, loaded: true, loading: false, lastTimestamp: Date.now() } : s
              ),
            })
          }
        } else {
          // No logs in this stream
          updateAppState(key, {
            streams: currentState.streams.map((s, i) =>
              i === index ? { ...s, loaded: true, loading: false } : s
            ),
          })
        }

        // Load next stream after a short delay
        setTimeout(() => loadNextStream(index + 1), 500)
      } catch (error) {
        console.error(`Error loading stream ${stream.streamName}:`, error)
        // Re-read state for error handling too
        const currentState = appLogsMapRef.current.get(key)
        if (currentState) {
          // Mark as loaded (even if failed) and move to next
          updateAppState(key, {
            streams: currentState.streams.map((s, i) =>
              i === index ? { ...s, loaded: true, loading: false } : s
            ),
          })
        }
        setTimeout(() => loadNextStream(index + 1), 500)
      }
    }

    loadingOlderStreamsRef.current.set(key, true)
    loadNextStream(1) // Start with 2nd stream (index 1)
  }, [updateAppState])

  /**
   * Background process 2: Continuously monitor the latest stream for new logs
   */
  const startPollingLatestStream = useCallback((appName: string, env: 'qa' | 'dev', interval = 3000) => {
    const key = `${env}:${appName}`

    // Clear existing interval
    const existing = pollIntervalsRef.current.get(key)
    if (existing) {
      clearInterval(existing)
    }

    const pollInterval = setInterval(async () => {
      const state = appLogsMapRef.current.get(key)
      if (!state || state.loading || state.latestStreamIndex < 0) return

      const latestStream = state.streams[state.latestStreamIndex]
      if (!latestStream) return

      try {
        // Poll only the latest stream for new logs
        const newLogs = await pollStreams(env, [{
          streamName: latestStream.streamName,
          startTime: latestStream.lastTimestamp,
        }])

        if (newLogs.length > 0) {
          // Filter duplicates
          const existingKeys = new Set(state.logs.map(l => `${l.timestamp}-${l.stream}`))
          const uniqueLogs = newLogs.filter(l => !existingKeys.has(`${l.timestamp}-${l.stream}`))

          if (uniqueLogs.length > 0) {
            const updatedLogs = [...state.logs, ...uniqueLogs]
            const newestTimestamp = Math.max(...updatedLogs.map(l => l.timestamp))

            updateAppState(key, {
              logs: updatedLogs,
              newestTimestamp,
              streams: state.streams.map((s, i) =>
                i === state.latestStreamIndex
                  ? { ...s, lastTimestamp: newestTimestamp }
                  : s
              ),
              lastPollTime: Date.now(),
            })
          }
        }

        updateAppState(key, { lastPollTime: Date.now() })
      } catch (error) {
        console.error('Error polling latest stream:', error)
      }
    }, interval)

    pollIntervalsRef.current.set(key, pollInterval)
  }, [updateAppState])

  const getAppLogs = useCallback((appName: string, env: 'qa' | 'dev'): AppLogsState => {
    const key = `${env}:${appName}`
    return appLogsMap.get(key) || {
      logs: [],
      loading: false,
      error: null,
      newestTimestamp: 0,
      oldestTimestamp: 0,
      streams: [],
      latestStreamIndex: -1,
      lastPollTime: 0,
    }
  }, [appLogsMap])

  const clearAppLogs = useCallback((appName: string, env: 'qa' | 'dev') => {
    const key = `${env}:${appName}`
    const interval = pollIntervalsRef.current.get(key)
    if (interval) {
      clearInterval(interval)
      pollIntervalsRef.current.delete(key)
    }
    loadingOlderStreamsRef.current.delete(key)
    setAppLogsMap((prev) => {
      const newMap = new Map(prev)
      newMap.delete(key)
      return newMap
    })
  }, [])

  /**
   * Clear all polling intervals and log state (useful when switching environments)
   */
  const clearAllPolling = useCallback(() => {
    for (const interval of pollIntervalsRef.current.values()) {
      clearInterval(interval)
    }
    pollIntervalsRef.current.clear()
    loadingOlderStreamsRef.current.clear()
    setAppLogsMap(new Map())
  }, [])

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
    clearAppLogs,
    clearAllPolling,
  }
}

export type { AppLogsState, LogEvent }
