import { useCallback, useEffect, useRef, useState } from 'react'
import { beginCapture, observeCapture, type LandmarkCapture } from './landmarkCapture'
import { fetchCurrentBaseline, registerBaseline, type ServerBaseline } from './client'
import { ApiError } from '../platform/api'
import { getServerAuth, subscribeServerAuth } from '../platform/serverAuth'
import type { Observation } from '../camera/types'

const OUT_OF_FRAME = '얼굴과 양쪽 어깨가 화면 안에 들어오게 앉은 뒤 다시 등록해 주세요.'
const BASELINE_LOAD_FAILED = '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 불러와 주세요.'

/** Server registration is optional: /dev consumes the same camera frames locally. */
export function useServerBaseline(enabled: boolean) {
  const capture = useRef<LandmarkCapture | null>(null)
  const saving = useRef(false)
  const mounted = useRef(true)
  const [baseline, setBaseline] = useState<ServerBaseline | null>(null)
  const [registering, setRegistering] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  const [baselineLoading, setBaselineLoading] = useState(() => enabled && !!getServerAuth())
  const [baselineError, setBaselineError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  const applyBaseline = useCallback((saved: ServerBaseline | null) => {
    setBaseline(saved)
    setBaselineError(null)
  }, [])

  const reloadBaseline = useCallback(async () => {
    if (!enabled) return
    if (!getServerAuth()) {
      applyBaseline(null)
      setBaselineLoading(false)
      return
    }
    setBaselineLoading(true)
    setBaselineError(null)
    try {
      const saved = await fetchCurrentBaseline()
      if (mounted.current) applyBaseline(saved)
    } catch (cause) {
      console.error('[hooks/useCamera.ts:reloadBaseline] Operation failed', cause)
      if (mounted.current)
        setBaselineError(cause instanceof ApiError && cause.kind === 'signed_out' ? cause.message : BASELINE_LOAD_FAILED)
    } finally {
      if (mounted.current) setBaselineLoading(false)
    }
  }, [applyBaseline, enabled])

  useEffect(() => {
    mounted.current = true
    if (!enabled) return () => { mounted.current = false }
    void reloadBaseline()
    const unsubscribe = subscribeServerAuth(() => void reloadBaseline())
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [enabled, reloadBaseline])

  const save = useCallback((captured: Parameters<typeof registerBaseline>[0]) => {
    saving.current = true
    setRegistering(true)
    registerBaseline(captured, crypto.randomUUID())
      .then((saved) => { if (mounted.current) applyBaseline(saved) })
      .catch((cause: unknown) => {
        console.error('[hooks/useCamera.ts:save] Operation failed', cause)
        if (mounted.current)
          setRegistrationError(cause instanceof ApiError ? cause.message : '서버에 자세를 저장하지 못했어요. 다시 등록해 주세요.')
      })
      .finally(() => {
        saving.current = false
        if (mounted.current) setRegistering(false)
      })
  }, [applyBaseline])

  const observe = useCallback((observation: Observation, observationGap: number) => {
    if (!capture.current) return
    const next = observeCapture(capture.current, observation.measurable ? observation.landmarks : null, observation.timeMs, observationGap)
    capture.current = next.capture
    setProgress(next.progress)
    if (next.outOfFrame) {
      capture.current = null
      setProgress(null)
      setRegistrationError(OUT_OF_FRAME)
    } else if (next.ready) {
      capture.current = null
      setProgress(null)
      save(next.ready)
    }
  }, [save])

  const begin = useCallback(() => {
    if (!enabled || capture.current || saving.current) return
    setRegistrationError(null)
    setProgress(0)
    capture.current = beginCapture()
  }, [enabled])
  const clearCapture = useCallback(() => { capture.current = null }, [])
  const interruptCapture = useCallback(() => {
    if (capture.current) {
      capture.current = beginCapture()
      setProgress(0)
    }
  }, [])
  const cancel = useCallback(() => { clearCapture(); setProgress(null) }, [clearCapture])
  const resetProgress = useCallback(() => setProgress(null), [])

  return { baseline, registering, registrationError, baselineLoading, baselineError, progress,
    reloadBaseline, observe, begin, clearCapture, interruptCapture, cancel, resetProgress }
}
