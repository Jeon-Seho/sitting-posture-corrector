import { useEffect, useRef, useState } from 'react'
import type { CameraController } from '../../hooks/useCamera'
import { accountClient, accountError } from './client'

/** New captures keep their timestamp across retries. Stale responses cannot replace a new capture. */
export function useRemoteBaseline(camera: CameraController, userId: string, canWrite: boolean) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const latest = useRef(camera)
  latest.current = camera
  const { calibrationId, registeredAt, baselineStored, calibrationSummary, adoptBaseline } = camera

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    const capture = latest.current.calibrationId
    void accountClient.currentBaseline(abort.signal).then(value => {
      if (!abort.signal.aborted && value && capture === null && latest.current.calibrationId === null) adoptBaseline(value)
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted) setError(accountError(failure))
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [userId, adoptBaseline, retry])

  useEffect(() => {
    if (loading || !canWrite || baselineStored || !calibrationId || !registeredAt || !calibrationSummary?.landmarks) return
    const abort = new AbortController()
    setError('')
    void accountClient.registerBaseline({ registered_at: registeredAt, landmarks: calibrationSummary.landmarks,
      sample_count: calibrationSummary.sampleCount, calibration_ms: Math.round(calibrationSummary.durationMs) }, abort.signal)
      .then(value => {
        if (!abort.signal.aborted && latest.current.calibrationId === calibrationId) adoptBaseline(value)
      }).catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(accountError(failure))
      })
    return () => abort.abort()
  }, [loading, canWrite, baselineStored, calibrationId, registeredAt, calibrationSummary, adoptBaseline, retry])

  return { error, loading, retry: () => setRetry(value => value + 1) }
}
