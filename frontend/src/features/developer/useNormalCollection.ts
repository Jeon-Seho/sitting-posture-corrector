import { useCallback, useEffect, useRef, useState } from 'react'
import { readNormalPostureProfile, type NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import type { CameraController } from '../../hooks/useCamera'
import { emptyNormalCollection, NormalCollectionCapture, NORMAL_COLLECTION_LIMITS, type DeveloperCollectionMetadata } from './normalCollection'

function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
export function useNormalCollection(camera: CameraController, options: {
  onApplyProfile: (profile: NormalPostureProfile) => void
  onClearProfile: () => void
  disabled?: boolean
}) {
  const [snapshot, setSnapshot] = useState(emptyNormalCollection)
  const [profile, setProfile] = useState<NormalPostureProfile | null>(null)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const capture = useRef<NormalCollectionCapture | null>(null)
  const latest = useRef({ camera, options }); latest.current = { camera, options }
  const generation = useRef(0)
  const connectingRef = useRef(false)
  const mounted = useRef(true)
  const publish = useCallback(() => { if (mounted.current && capture.current) setSnapshot(capture.current.snapshot(performance.now())) }, [])
  const interrupt = useCallback((reason = '수집 화면에서 이동해 수집을 중단했습니다.') => {
    if (connectingRef.current) latest.current.camera.stop()
    generation.current++; connectingRef.current = false; setConnecting(false)
    capture.current?.interrupt(reason, performance.now()); publish()
  }, [publish])
  useEffect(() => {
    mounted.current = true
    const unsubscribe = camera.subscribe(frame => {
      if (!capture.current?.active) return
      if (document.visibilityState === 'hidden') capture.current?.tick(performance.now(), true)
      else capture.current?.observe(frame)
      publish()
    })
    const timer = setInterval(() => {
      if (!capture.current?.active) return
      capture.current.tick(performance.now(), document.visibilityState === 'hidden'); publish()
    }, 100)
    const hide = () => { if (document.visibilityState === 'hidden') interrupt('탭을 벗어나 수집을 중단했습니다.') }
    document.addEventListener('visibilitychange', hide)
    return () => { mounted.current = false; generation.current++; unsubscribe(); clearInterval(timer); document.removeEventListener('visibilitychange', hide); capture.current = null }
  }, [camera.subscribe, interrupt, publish])
  useEffect(() => {
    if ((camera.state === 'off' || camera.state === 'error') && capture.current?.active) interrupt('카메라 연결이 끊겨 수집을 중단했습니다.')
  }, [camera.state, interrupt])
  const start = useCallback(async (metadata: DeveloperCollectionMetadata) => {
    if (capture.current?.active || connectingRef.current || latest.current.options.disabled) return
    const token = ++generation.current
    setError(''); connectingRef.current = true; setConnecting(true)
    try {
      // Validate before camera permission. This object is replaced after camera preparation.
      new NormalCollectionCapture(metadata, 'validation', new Date().toISOString(), performance.now())
      if (latest.current.camera.state !== 'on') await latest.current.camera.connect()
      if (!mounted.current || token !== generation.current) return
      if (latest.current.options.disabled) throw new Error('진행 중인 자세 측정을 먼저 종료해 주세요.')
      if (!latest.current.camera.streamRef.current || latest.current.camera.streamRef.current.getVideoTracks().every(track => track.readyState === 'ended')) {
        throw new Error(latest.current.camera.error || '카메라 연결에 실패했습니다. 권한과 연결 상태를 확인해 주세요.')
      }
      capture.current = new NormalCollectionCapture(metadata, crypto.randomUUID(), new Date().toISOString(), performance.now())
      connectingRef.current = false; setConnecting(false); publish()
    } catch (reason) {
      if (mounted.current && token === generation.current) { connectingRef.current = false; setConnecting(false); setError(reason instanceof Error ? reason.message : '카메라와 수집 코드를 확인해 주세요.') }
    }
  }, [publish])
  const finish = useCallback(() => { capture.current?.finish(); publish() }, [publish])
  const confirmAndApply = useCallback(() => {
    if (latest.current.options.disabled) return
    try {
      if (!capture.current) return
      const fitted = capture.current.confirm()
      if (capture.current.metadata.purpose === 'personal_calibration' && fitted?.provenance.purpose === 'personal_calibration') {
        latest.current.options.onApplyProfile(fitted); setProfile(fitted)
      }
      setError(''); publish()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '구간 확인에 실패했습니다.') }
  }, [publish])
  const discard = useCallback(() => {
    generation.current++; connectingRef.current = false; capture.current = null; setSnapshot(emptyNormalCollection()); setError(''); setConnecting(false)
  }, [])
  const downloadDataset = useCallback(() => {
    try {
      if (!capture.current) return
      const dataset = capture.current.exportDataset()
      const prefix = dataset.schema_version === 'forecast-evaluation-collection-v1' ? 'forecast-evaluation' : 'normal-collection'
      downloadJson(dataset, `${prefix}-${dataset.id}.json`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '내보내기에 실패했습니다.') }
  }, [])
  const downloadProfile = useCallback(() => { if (profile) downloadJson(profile, `normal-profile-${profile.id}.json`) }, [profile])
  const importProfile = useCallback(async (file: File) => {
    if (latest.current.options.disabled || connectingRef.current || capture.current?.active) { setError('진행 중인 수집 또는 자세 측정을 마친 뒤 개인 범위를 불러와 주세요.'); return }
    const token = ++generation.current
    setError('')
    try {
      if (file.size > NORMAL_COLLECTION_LIMITS.maxFileBytes) throw new Error('개인 정상 범위 JSON은 100KB 이하여야 합니다.')
      const text = await file.text()
      if (new TextEncoder().encode(text).length > NORMAL_COLLECTION_LIMITS.maxFileBytes) throw new Error('개인 정상 범위 JSON은 100KB 이하여야 합니다.')
      const parsed = readNormalPostureProfile(JSON.parse(text))
      if (!mounted.current || token !== generation.current) return
      if (latest.current.options.disabled) throw new Error('진행 중인 자세 측정을 먼저 종료해 주세요.')
      if (parsed.provenance.purpose !== 'personal_calibration') throw new Error('학습 자료용 구간은 개인 기준으로 불러올 수 없습니다. 개인 기준 등록용으로 수집해 주세요.')
      latest.current.options.onApplyProfile(parsed); setProfile(parsed)
    } catch (reason) { if (mounted.current && token === generation.current) setError(reason instanceof Error ? reason.message : '개인 정상 범위를 불러오지 못했습니다.') }
  }, [])
  const clearProfile = useCallback(() => { if (!latest.current.options.disabled && !capture.current?.active && !connectingRef.current) { latest.current.options.onClearProfile(); setProfile(null) } }, [])
  return { snapshot, profile, error, connecting, start, finish, interrupt, confirmAndApply, discard, downloadDataset, downloadProfile, importProfile, clearProfile }
}
export type NormalCollectionController = ReturnType<typeof useNormalCollection>
