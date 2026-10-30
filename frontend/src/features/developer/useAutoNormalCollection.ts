import { useCallback, useEffect, useRef, useState } from 'react'
import { AutoNormalCapture, type AutoNormalObservation } from './autoNormalCollection'

/** Local memory only. Receives matched engine observations; never opens a camera or uploads data. */
export function useAutoNormalCollection() {
  const capture = useRef<AutoNormalCapture | null>(null)
  if (!capture.current) capture.current = new AutoNormalCapture(`anon_${crypto.randomUUID().slice(0, 8)}`, crypto.randomUUID(), new Date().toISOString())
  const [snapshot, setSnapshot] = useState(() => capture.current!.snapshot())
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const publishedAt = useRef(0)
  const publish = useCallback(() => { if (mounted.current) { publishedAt.current = performance.now(); setSnapshot(capture.current!.snapshot()) } }, [])
  const markGap = useCallback((reason?: string) => { if (capture.current!.markGap(reason)) publish() }, [publish])
  const endRun = useCallback(() => { if (capture.current!.endRun()) publish() }, [publish])
  const observe = useCallback((input: AutoNormalObservation) => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { markGap('백그라운드 관측은 제외합니다.'); return }
    const changed = capture.current!.observe(input)
    // Rejection counts remain visible without creating a React update for every raw frame.
    if (changed || performance.now() - publishedAt.current >= 250) publish()
  }, [markGap, publish])
  const setEnabled = useCallback((enabled: boolean) => { capture.current!.setEnabled(enabled); publish(); setError('') }, [publish])
  const setParticipantCode = useCallback((code: string) => {
    try { capture.current!.setParticipantCode(code.trim()); publish(); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '익명 코드를 확인해 주세요.') }
  }, [publish])
  const setMaximumDeviation = useCallback((value: number) => {
    try { capture.current!.setMaximumDeviation(value); publish(); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '선별 기준을 확인해 주세요.') }
  }, [publish])
  const discard = useCallback(() => { capture.current!.discard(); publish(); setError('') }, [publish])
  const downloadDataset = useCallback(() => {
    try {
      const dataset = capture.current!.exportDataset()
      const url = URL.createObjectURL(new Blob([JSON.stringify(dataset)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `normal-auto-${dataset.id}.json`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '내보내지 못했습니다.') }
  }, [])
  useEffect(() => {
    mounted.current = true
    const hide = () => { if (document.visibilityState === 'hidden') markGap('백그라운드 관측은 제외합니다.') }
    document.addEventListener('visibilitychange', hide)
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', hide); capture.current!.endRun() }
  }, [markGap])
  return { snapshot, error, observe, markGap, endRun, setEnabled, setMaximumDeviation, setParticipantCode, discard, downloadDataset }
}
export type AutoNormalCollectionController = ReturnType<typeof useAutoNormalCollection>
