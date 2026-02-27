import { useState, useRef, useCallback, useEffect } from 'react'
import type { LogEvent } from '@/lib/cloudwatch'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:31191'

export interface ApiCall {
    id: string
    timestamp: number
    method: 'GET' | 'POST'
    endpoint: string
    body?: object
    status: 'pending' | 'success' | 'error'
    duration?: number
    error?: string
}

interface SimpleLogState {
    logs: LogEvent[]
    apiCalls: ApiCall[]
    loading: boolean
    error: string | null
    currentStream: string | null
    lastTimestamp: number
}

/**
 * Simple log stream hook - focuses on one stream at a time
 * 
 * Logic:
 * 1. Get all streams for the app
 * 2. Pick the latest stream (by lastEventTime)
 * 3. Load logs from that stream
 * 4. Poll every 3s for new logs
 */
export function useSimpleLogStream() {
    const [state, setState] = useState<SimpleLogState>({
        logs: [],
        apiCalls: [],
        loading: false,
        error: null,
        currentStream: null,
        lastTimestamp: 0,
    })

    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const mountedRef = useRef(true)
    const stateRef = useRef(state)
    const apiCallIdRef = useRef(0)

    // Keep stateRef in sync
    useEffect(() => {
        stateRef.current = state
    }, [state])



    // Fetch with API logging - made stable with empty deps and using refs
    const fetchWithLog = useCallback(async <T>(
        method: 'GET' | 'POST',
        endpoint: string,
        body?: object
    ): Promise<T> => {
        const startTime = Date.now()
        apiCallIdRef.current += 1
        const callId = `${Date.now()}-${apiCallIdRef.current}`

        // Add API call to state
        setState(prev => ({
            ...prev,
            apiCalls: [...prev.apiCalls.slice(-50), {
                id: callId,
                timestamp: startTime,
                method,
                endpoint,
                body,
                status: 'pending' as const,
            }]
        }))

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
            })

            const duration = Date.now() - startTime

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                const errorMsg = errorData.error || `HTTP ${response.status}`
                setState(prev => ({
                    ...prev,
                    apiCalls: prev.apiCalls.map(call =>
                        call.id === callId ? { ...call, status: 'error' as const, duration, error: errorMsg } : call
                    )
                }))
                throw new Error(errorMsg)
            }

            const data = await response.json()
            setState(prev => ({
                ...prev,
                apiCalls: prev.apiCalls.map(call =>
                    call.id === callId ? { ...call, status: 'success' as const, duration } : call
                )
            }))
            return data
        } catch (error) {
            const duration = Date.now() - startTime
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            setState(prev => ({
                ...prev,
                apiCalls: prev.apiCalls.map(call =>
                    call.id === callId ? { ...call, status: 'error' as const, duration, error: errorMsg } : call
                )
            }))
            throw error
        }
    }, []) // Empty deps - uses refs and setState functional updates

    // Stop polling
    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
        }
    }, [])

    // Load logs for an app - SIMPLE: get latest stream, load all logs, done (no polling)
    const loadLogs = useCallback(async (appName: string, env: 'qa' | 'dev') => {
        if (!mountedRef.current) return

        stopPolling()
        setState(prev => {
            const newState = {
                ...prev,
                loading: true,
                error: null,
                logs: [],
                currentStream: null,
                lastTimestamp: 0,
            }
            stateRef.current = newState
            return newState
        })

        try {
            // Step 1: Get all streams for this app
            const streamsData = await fetchWithLog<{ streams: string[] }>(
                'GET',
                `/api/streams?app=${encodeURIComponent(appName)}&env=${env}`
            )

            if (!mountedRef.current) return

            if (!streamsData.streams || streamsData.streams.length === 0) {
                setState(prev => {
                    const newState = {
                        ...prev,
                        loading: false,
                        error: 'No log streams found for this app',
                    }
                    stateRef.current = newState
                    return newState
                })
                return
            }

            // Step 2: Pick the first stream (should be the latest)
            const latestStream = streamsData.streams[0]

            // Step 3: Load ALL logs from that single stream
            const logsData = await fetchWithLog<{ logs: LogEvent[] }>(
                'POST',
                '/api/logs/stream',
                {
                    streamName: latestStream,
                    env,
                    limit: 2000, // Get lots of logs
                }
            )

            if (!mountedRef.current) return

            const logs = logsData.logs || []
            const lastTimestamp = logs.length > 0
                ? Math.max(...logs.map(l => l.timestamp))
                : Date.now()

            // Done - set state, NO polling
            setState(prev => {
                const newState = {
                    ...prev,
                    loading: false,
                    error: null,
                    logs,
                    currentStream: latestStream,
                    lastTimestamp,
                }
                stateRef.current = newState
                return newState
            })

        } catch (error) {
            if (!mountedRef.current) return
            setState(prev => {
                const newState = {
                    ...prev,
                    loading: false,
                    error: error instanceof Error ? error.message : 'Failed to load logs',
                }
                stateRef.current = newState
                return newState
            })
        }
    }, [fetchWithLog, stopPolling])

    // Clear logs
    const clearLogs = useCallback(() => {
        setState(prev => ({
            ...prev,
            logs: [],
            lastTimestamp: 0,
        }))
    }, [])

    // Clear API calls
    const clearApiCalls = useCallback(() => {
        setState(prev => ({
            ...prev,
            apiCalls: [],
        }))
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            stopPolling()
        }
    }, [stopPolling])

    return {
        ...state,
        loadLogs,
        clearLogs,
        clearApiCalls,
        stopPolling,
    }
}
