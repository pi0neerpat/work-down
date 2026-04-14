import { useState, useEffect, useRef, useCallback } from 'react'

export function usePolling(url, intervalMs) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const isMountedRef = useRef(false)
  const controllerRef = useRef(null)
  const inFlightRef = useRef(false)
  const queuedRefreshRef = useRef(false)

  const fetchData = useCallback(async () => {
    if (!url) return null
    if (inFlightRef.current) {
      queuedRefreshRef.current = true
      return null
    }

    inFlightRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json()
      if (isMountedRef.current) {
        setData(json)
        setError(null)
        setLastRefresh(new Date())
      }
    } catch (err) {
      if (isMountedRef.current && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      inFlightRef.current = false
      if (isMountedRef.current) setLoading(false)

      if (queuedRefreshRef.current && isMountedRef.current) {
        queuedRefreshRef.current = false
        void fetchData()
      }
    }
  }, [url])

  useEffect(() => {
    isMountedRef.current = true
    if (!url) {
      setData(null)
      setError(null)
      setLastRefresh(null)
      setLoading(false)
      return () => {
        isMountedRef.current = false
      }
    }

    setLoading(true)
    setError(null)
    setData(null)
    setLastRefresh(null)
    void fetchData()
    const id = setInterval(fetchData, intervalMs)
    return () => {
      isMountedRef.current = false
      clearInterval(id)
      queuedRefreshRef.current = false
      inFlightRef.current = false
      if (controllerRef.current) {
        controllerRef.current.abort()
        controllerRef.current = null
      }
    }
  }, [url, intervalMs, fetchData])

  return { data, loading, error, lastRefresh, refresh: fetchData }
}
