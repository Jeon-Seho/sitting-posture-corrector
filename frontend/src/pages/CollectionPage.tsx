import { useEffect } from 'react'
import { CameraStage } from '../components/CameraStage'
import { CollectionPanel } from '../components/CollectionPanel'
import { VisualControls } from '../components/VisualControls'
import type { CameraController } from '../hooks/useCamera'
import type { CollectionController } from '../hooks/useCollection'

export function CollectionPage({ camera, collection }: {
  camera: CameraController; collection: CollectionController
}) {
  useEffect(() => { collection.setPhase('running'); return () => collection.setPhase('inactive') }, [collection.setPhase])
  // 촬영에는 카메라와 5초 기준 자세가 필요하다. 측정 준비로 보내지 않고 이 화면에서 바로 켜고 등록한다.
  const calibrating = camera.progress !== null
  return <>
    <div className="page-head"><div><h1 className="page-title">자세 등록</h1>
      <p className="page-desc">바른 자세뿐 아니라 평소에 자주 하는 자세들을 짧게 찍어 두는 곳이에요. 이 화면에서는 점수나 교정 알림이 뜨지 않아요.</p></div>
      <div className="row">
        {camera.state === 'on'
          ? <button className="btn" disabled={collection.hasCapture} onClick={camera.stop}>카메라 끄기</button>
          : <button className="btn btn-primary" disabled={camera.state === 'loading'} onClick={() => void camera.connect()}>{camera.state === 'loading' ? '준비 중…' : '카메라 켜기'}</button>}
        <button className="btn" disabled={camera.state !== 'on' || !camera.quality || calibrating || collection.hasCapture} onClick={camera.calibrate}>
          {calibrating ? `기준 등록 중 ${Math.round((camera.progress ?? 0) * 100)}%` : camera.baseline ? '기준 자세 다시 등록' : '기준 자세 등록'}
        </button>
      </div></div>
    <section className="collection-intro" aria-label="자세 등록 안내">
      <div><h2>왜 등록하나요?</h2>
        <p>기울기, 숙이기, 타이핑처럼 여러 자세를 찍어 두면 PoseGood이 ‘나에게 바른 자세’와 ‘흐트러진 자세’를 더 잘 구별하도록 학습하는 자료가 됩니다. 지금은 찍은 결과를 파일(CSV)로 내려받아 연구팀에 전달하는 방식이에요.</p></div>
      <ol>
        <li><b>자세 고르기</b><span>‘자세 촬영하기’ 칸의 ‘찍을 자세’에서 골라요.</span></li>
        <li><b>5초 준비 후 촬영</b><span>안내대로 자세를 잡고 10초쯤 유지해요.</span></li>
        <li><b>확인 · 내려받기</b><span>실제로 한 자세를 고르고 파일로 저장해요.</span></li>
      </ol>
      <p className="fine">한 번에 한 자세씩, 목록 순서대로 찍으면 돼요. 무리한 자세는 하지 마세요.</p>
    </section>
    <div className="collection-layout">
      <div className="collection-preview"><div className="stage"><CameraStage camera={camera} />
        <div className="stage-overlay"><div className="stage-top"><span className="stage-tag">MediaPipe Lite</span>
          <span className="stage-tag">{camera.metrics.fps.toFixed(1)} FPS · {camera.metrics.inferenceMs.toFixed(0)}ms · {camera.metrics.delegate}</span></div></div></div>
        <VisualControls camera={camera} />
        <p className="capture-note">{camera.state !== 'on' ? '먼저 위의 카메라 켜기를 눌러 주세요.' : !camera.baseline && !calibrating ? '촬영하려면 편안하게 앉아 기준 자세 등록(5초)을 먼저 해 주세요.' : camera.quality ? '기존 특징 측정 가능 · 자세 정답은 촬영 후 직접 확인합니다.' : '기존 특징 측정 불가 · 가림/빈 자리 과제의 관측은 계속 기록합니다.'}</p>
        {camera.state === 'on' && camera.metrics.fps > 0 && camera.metrics.fps < 10 && <p className="capture-note">추적 속도가 10 FPS 미만입니다. Lite의 처리 시간과 기기 부하를 확인하세요. 부족한 프레임을 복제하지 않습니다.</p>}
      </div>
      <CollectionPanel collection={collection} />
    </div>
  </>
}
