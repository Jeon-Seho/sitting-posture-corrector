import type { CameraController } from '../hooks/useCamera'

export function VisualControls({ camera }: { camera: CameraController }) {
  return <div className="visual-controls">
    <div className="row" role="group" aria-label="웹캠 표시 모드">
      <button className="chip" aria-pressed={camera.visual.mode === 'skeleton'} onClick={() => camera.setVisualMode('skeleton')}>전체 키포인트</button>
      <button className="chip" aria-pressed={camera.visual.mode === 'matrix'} onClick={() => camera.setVisualMode('matrix')}>매트릭스 효과</button>
      {camera.visual.mode === 'matrix' && <button className="chip" onClick={camera.reassemble} disabled={camera.visual.reducedMotion}>다시 모으기</button>}
    </div>
    {camera.visual.mode === 'matrix' && <label className="visual-motion"><input type="checkbox" checked={camera.visual.reducedMotion}
      onChange={e => camera.setReducedMotion(e.target.checked)} />애니메이션 줄이기</label>}
    <p className="fine">{camera.visual.mode === 'matrix' ? '점들이 모이는 장식용 효과입니다. 추가 측정점이나 실제 3D 체형이 아닙니다.' : '눈·입·귀·몸·팔·다리의 33개 후보 중 화면 안에서 충분히 보이는 점만 표시합니다. 턱 추적은 포함하지 않습니다.'}</p>
  </div>
}
