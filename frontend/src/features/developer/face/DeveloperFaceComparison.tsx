import type { FaceTrackingController } from './useFaceTracking'
import './face.css'

const number = (value: number | null | undefined, suffix: string) => value == null ? '—' : `${value.toFixed(1)}${suffix}`
export default function DeveloperFaceComparison({ face }: { face: FaceTrackingController }) {
  const difference = face.sample?.difference
  const vertical = difference?.verticalPixels
  return <section className="dc-face-panel" aria-label="얼굴 전용 추적과 Pose 비교">
    <div className="dc-face-heading"><h3>얼굴 추적 비교</h3><label><input type="checkbox" checked={face.enabled} onChange={e => face.setEnabled(e.target.checked)} />얼굴 전용 추적</label></div>
    <div className="dc-face-controls"><fieldset><legend>카메라에 표시할 점</legend>{([['face', 'Face'], ['pose', '기존 Pose'], ['both', '겹쳐 보기']] as const).map(([value, label]) => <label key={value}><input type="radio" name="dev-face-display" checked={face.mode === value} onChange={() => face.setMode(value)} />{label}</label>)}</fieldset><span>{face.delegate ? `Face Worker · ${face.delegate}` : 'Face Worker'}</span></div>
    <p className="dc-face-status" role="status">{!face.enabled ? '얼굴 전용 추적이 꺼져 있습니다.' : !face.active ? '카메라 측정을 시작하면 얼굴 전용 추적도 연결됩니다.' : face.status === 'ready' ? face.sample?.frame ? `얼굴 전용 ${face.sample.frame.landmarkCount}점 · 눈·코·입 윤곽 표시` : '얼굴 모델 준비됨 · 첫 관측 대기' : face.message}</p>
    <div className="dc-face-values"><div><span>Pose ↔ Face 평균 차이</span><strong>{number(difference?.meanPixels, 'px')}</strong></div><div><span>Pose의 수직 차이</span><strong>{vertical == null ? '—' : `${Math.abs(vertical).toFixed(1)}px ${vertical < 0 ? '위' : '아래'}`}</strong></div><div><span>Face 추론 / 왕복</span><strong>{number(face.sample?.inferenceMs, 'ms')} / {number(face.sample?.roundTripMs, 'ms')}</strong></div></div>
    <p className="dc-face-caption">{face.enabled && face.mode === 'face' ? '청록은 Face 얼굴과 Pose 어깨입니다. 보라 점선은 등록 당시 Pose 어깨입니다.' : face.enabled && face.mode === 'both' ? '청록은 Face 얼굴, 주황은 기존 Pose 점, 보라 점선은 등록 당시 Pose입니다.' : '현재 초록 점은 기존 Pose, 보라 점선은 등록 당시 Pose입니다.'} 동일 영상의 근사 눈 중심·코·입 위치 차이며 정확도 정답은 아닙니다.</p>
    <div className="dc-face-trial"><label><input type="checkbox" checked={face.glasses} disabled={face.trialProgress !== null} onChange={e => face.setGlasses(e.target.checked)} />안경 착용</label><button type="button" disabled={!face.active || face.status !== 'ready' || face.trialProgress !== null} onClick={face.startTrial}>{face.trialProgress === null ? '10초 정면 비교' : `비교 중 ${Math.ceil((1 - face.trialProgress) * 10)}초`}</button><span>같은 구도에서 정면을 유지하고, 안경 착용·미착용을 각각 비교하세요.</span></div>
    {!!face.trials.length && <div className="dc-face-table"><table><caption>얼굴 비교 결과 · 현재 탭 · 좌표 저장 없음</caption><thead><tr><th>조건</th><th>유효 Face / 요청</th><th>짝지은 관측</th><th>평균 차이</th><th>Face 추론</th></tr></thead><tbody>{face.trials.map(t => <tr key={t.id}><td>{t.glasses ? '안경 착용' : '미착용'} · {(t.elapsedMs / 1000).toFixed(1)}초</td><td>{t.detected} / {t.attempted}</td><td>{t.paired}</td><td>{number(t.meanDifferencePixels, 'px')}</td><td>{number(t.meanInferenceMs, 'ms')} · {t.delegate ?? '—'}</td></tr>)}</tbody></table></div>}
    <p className="dc-face-caption">얼굴 전용 좌표는 이 비교 화면에서만 사용합니다. 현재 알림과 정상 자료 수집·39차원 LSTM 입력은 Pose 원본입니다. Face 좌표로 만든 별도 수집·학습 계약은 후속이며 두 좌표계를 섞지 않습니다.</p>
  </section>
}
