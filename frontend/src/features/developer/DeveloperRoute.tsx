import { Profiler, useCallback, useEffect, useState } from 'react'
import type { NormalPostureProfile } from '../../../../model/prototype/normalPosture'
import type { CameraController, CameraRuntimeOptions } from '../../hooks/useCamera'
import DeveloperLab from './DeveloperLab'
import { POSE_MODELS } from '../mediapipe'
import DeveloperPerformance from './DeveloperPerformance'
import { recordPipelineDuration } from './pipelinePerformance'
import { useDeveloperSession } from './useDeveloperSession'
import { useNormalCollection } from './useNormalCollection'
import { useAutoNormalCollection } from './useAutoNormalCollection'
import { useFaceTracking } from './face/useFaceTracking'

/** A separate research surface: it never creates a user profile or service session. */
export default function DeveloperRoute({ camera }: { camera: CameraController }) {
  const [profile, setProfile] = useState<NormalPostureProfile | null>(null)
  const [options, setOptions] = useState<CameraRuntimeOptions>({ variant: 'full', delegate: 'auto', pacing: 'responsive' })
  const [benchmarkBusy, setBenchmarkBusy] = useState(false)
  const connect = useCallback((id?: string) => camera.connect(id, options), [camera.connect, options])
  const devCamera = { ...camera, connect }
  const matchingProfile = !!profile && profile.provenance.poseModelId === POSE_MODELS[options.variant ?? 'heavy'].modelId
  const normalProfileNotice = profile && !matchingProfile ? '개인 정상 범위의 추출 모델이 다르거나 기록되지 않았습니다. 현재는 거리·시간 규칙을 사용합니다. 선택한 모델로 정상 자세를 다시 수집하면 적용할 수 있습니다.' : undefined
  const automatic = useAutoNormalCollection()
  const session = useDeveloperSession(devCamera, matchingProfile ? profile : null, automatic)
  const active = ['connecting', 'guiding', 'registering', 'measuring'].includes(session.phase)
  const face = useFaceTracking(devCamera, active && session.source === 'camera' && !benchmarkBusy)
  const collection = useNormalCollection(devCamera, {
    disabled: active,
    onApplyProfile: next => { if (!active && next.provenance.purpose === 'personal_calibration') setProfile(next) },
    onClearProfile: () => { if (!active) setProfile(null) },
  })
  useEffect(() => {
    const previous = document.title
    document.title = 'Posture Lab · PoseGood'
    return () => { document.title = previous }
  }, [])
  return <>
    <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
    <Profiler id="developer-lab" onRender={(_, __, duration) => recordPipelineDuration('reactRender', duration)}><DeveloperLab camera={devCamera} session={session} collection={collection} automatic={automatic} face={face} benchmarkBusy={benchmarkBusy} normalProfileNotice={normalProfileNotice}
      performancePanel={<DeveloperPerformance camera={devCamera} active={active || camera.state === 'on' || camera.state === 'loading'} options={options} onOptionsChange={setOptions} onBusyChange={setBenchmarkBusy} />} /></Profiler>
  </>
}
