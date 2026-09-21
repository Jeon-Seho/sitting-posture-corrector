import { useEffect } from 'react'
import { CameraStage } from '../components/CameraStage'
import { CollectionPanel } from '../components/CollectionPanel'
import { VisualControls } from '../components/VisualControls'
import type { CameraController } from '../hooks/useCamera'
import type { CollectionController } from '../hooks/useCollection'

export function CollectionPage({ camera, collection, onPrepare }: {
  camera: CameraController; collection: CollectionController; onPrepare: () => void
}) {
  useEffect(() => { collection.setPhase('running'); return () => collection.setPhase('inactive') }, [collection.setPhase])
  return <>
    <div className="page-head"><div><h1 className="page-title">라벨 수집</h1>
      <p className="page-desc">자세와 작업 상황을 따로 기록합니다. 이 화면에서는 자세 점수와 교정 알림을 표시하지 않습니다.</p></div>
      <button className="btn" onClick={onPrepare}>카메라 · 기준 다시 준비</button></div>
    <div className="collection-layout">
      <div className="collection-preview"><div className="stage"><CameraStage camera={camera} />
        <div className="stage-overlay"><div className="stage-top"><span className="stage-tag">MediaPipe Heavy</span>
          <span className="stage-tag">{camera.metrics.fps.toFixed(1)} FPS · {camera.metrics.inferenceMs.toFixed(0)}ms · {camera.metrics.delegate}</span></div></div></div>
        <VisualControls camera={camera} />
        <p className="capture-note">{camera.state !== 'on' ? '먼저 카메라를 연결해 주세요.' : camera.quality ? '기존 특징 측정 가능 · 자세 정답은 촬영 후 직접 확인합니다.' : '기존 특징 측정 불가 · 가림/빈 자리 과제의 관측은 계속 기록합니다.'}</p>
        {camera.state === 'on' && camera.metrics.fps > 0 && camera.metrics.fps < 10 && <p className="capture-note">추적 속도가 10 FPS 미만입니다. Heavy의 처리 시간과 기기 부하를 확인하세요. 부족한 프레임을 복제하지 않습니다.</p>}
      </div>
      <CollectionPanel collection={collection} />
    </div>
  </>
}
