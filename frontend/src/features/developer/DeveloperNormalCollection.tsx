import { useRef, useState } from 'react'
import { Check, DownloadSimple, Play, Stop, Trash, UploadSimple } from '@phosphor-icons/react'
import type { DeveloperCollectionPurpose } from './normalCollection'
import type { NormalCollectionController } from './useNormalCollection'
import './normal-collection.css'

export default function DeveloperNormalCollection({ collection, cameraState, disabled = false, participantCodeDefault = '' }: {
  collection: NormalCollectionController
  cameraState: string
  disabled?: boolean
  participantCodeDefault?: string
}) {
  const [participantCode, setParticipantCode] = useState(participantCodeDefault)
  const [sessionCode, setSessionCode] = useState(() => `session-${new Date().toISOString().slice(0, 10)}`)
  const [purpose, setPurpose] = useState<DeveloperCollectionPurpose>('personal_calibration')
  const [reviewed, setReviewed] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const s = collection.snapshot
  const active = collection.connecting || s.phase === 'preparing' || s.phase === 'collecting'
  const locked = active || disabled
  const fieldsLocked = locked || s.phase !== 'idle'
  const currentPurpose = s.metadata?.purpose ?? purpose
  const evaluation = currentPurpose === 'forecast_evaluation'
  const progress = Math.min(100, s.validMs / s.targetMs * 100)
  const start = () => { setReviewed(false); void collection.start(s.metadata ?? { participantCode: participantCode.trim(), sessionCode: sessionCode.trim(), purpose }) }
  return <section className="dev-normal-collection" aria-label={evaluation ? '예측 모델 평가 데이터 수집' : '정상 자세 데이터 수집'}>
    <div className="dn-heading"><div><span className="dn-eyebrow">{evaluation ? '예측 모델 평가용 · 학습 제외' : '정상자세(수동)'}</span><h2>{evaluation ? '30초 동안 평가할 자세와 움직임을 촬영해요' : '30초 동안 정상 자세를 촬영해요'}</h2><p>{evaluation ? '현재 고정된 예측 모델을 비교할 독립 구간을 수집합니다. 평소 타이핑과 자세 변화를 담고, 촬영 뒤 평가 전용 용도를 확인합니다.' : '버튼을 누르고 유지하고 싶은 자세를 취해 주세요. 타이핑과 작은 움직임도 포함하고, 촬영 뒤 구간을 직접 확인합니다.'}</p></div><span className="dn-memory-label">이 탭의 메모리에만 보관</span></div>
    <div className="dn-layout"><div className="dn-capture">
      <div className="dn-fields"><label htmlFor="normal-participant">익명 참여자 코드<input id="normal-participant" autoComplete="off" placeholder="예: p01 · 같은 사람은 같은 코드" maxLength={48} value={s.metadata?.participantCode ?? participantCode} disabled={fieldsLocked} onChange={e => setParticipantCode(e.target.value)} /></label><label htmlFor="normal-session">촬영 세션 코드<input id="normal-session" autoComplete="off" maxLength={48} value={s.metadata?.sessionCode ?? sessionCode} disabled={fieldsLocked} onChange={e => setSessionCode(e.target.value)} /></label></div>
      <label className="dn-purpose" htmlFor="normal-purpose">이번 구간의 용도<select id="normal-purpose" value={currentPurpose} disabled={fieldsLocked} onChange={e => setPurpose(e.target.value as DeveloperCollectionPurpose)}><option value="personal_calibration">개인 기준 등록용</option><option value="training_normal">정상 모델 학습 자료용</option><option value="forecast_evaluation">예측 모델 평가용 · 학습 제외</option></select></label>
      <p className="dn-purpose-note">{evaluation ? '고정된 모델 비교에만 사용하는 평가 전용 파일입니다. 학습·개인 보정·모델 선택·임계값 조정에 사용하지 않습니다.' : currentPurpose === 'personal_calibration' ? '개인 보정 자료로 구분합니다. 시험 참여자는 이 구간만 개인화에 사용합니다.' : '학습 후보로 내보냅니다. 참여자 분할을 정한 뒤 학습에 사용하며, 시험 자료와 섞지 않습니다.'}</p>
      <div className={`dn-progress-panel dn-phase-${s.phase}`} aria-live="polite">
        <div className="dn-progress-title"><strong>{collection.connecting ? '카메라를 연결하고 있어요' : s.phase === 'preparing' ? `${Math.ceil(s.preparationRemainingMs / 1000)}초 뒤 수집 시작` : s.phase === 'collecting' ? s.quality === 'unmeasurable' ? '얼굴과 양어깨가 보이면 이어서 모아요' : evaluation ? '평소 자세와 움직임을 촬영해 주세요' : '자연스럽게 기준 자세를 유지해 주세요' : s.phase === 'review' ? evaluation ? '평가 전용 구간인지 확인해 주세요' : '모은 구간을 확인해 주세요' : s.phase === 'confirmed' ? evaluation ? '평가 자료를 준비했어요' : currentPurpose === 'personal_calibration' ? '개인 정상 범위를 맞췄어요' : '정상 학습 자료를 준비했어요' : evaluation ? '평가 구간 수집 준비' : '정상 구간 수집 준비'}</strong><span>{(s.validMs / 1000).toFixed(1)} / 30초</span></div>
        <progress max={100} value={progress} aria-label={evaluation ? '평가 구간 유효 수집 진행률' : '정상 자세 유효 수집 진행률'} />
        <div className="dn-progress-meta"><span>{s.samples}개 표본</span><span>관측 끊김 {s.gaps}회</span><span>{cameraState === 'on' ? '카메라 연결됨' : '시작하면 카메라 연결'}</span></div>
        <p>{s.reason || '준비 3초와 가림·누락 시간은 30초에 포함하지 않습니다. 최대 2분까지 관찰합니다.'}</p>
      </div>
      {s.phase === 'review' && <div className="dn-review"><label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={!s.canConfirm || disabled} /><span>{evaluation ? '이 구간은 고정된 예측 모델 비교용이며, 학습이나 개인 보정에 사용하지 않을 평가 자료임을 확인했어요.' : '이 구간에서 목표로 한 정상 자세를 유지했고, 큰 자세 이탈이 없었음을 확인했어요.'}</span></label><p>{evaluation ? '이 확인은 평가 전용 용도에 대한 확인입니다. 정상·이탈 정답 라벨을 붙이지 않으며, 잘못 모은 구간은 버리고 다시 수집해 주세요.' : '의학적 정상 판정이 아닌 사용자 확인입니다. 잘못 모은 구간은 버리고 다시 수집해 주세요.'}</p>{!s.canConfirm && <strong>{evaluation ? '유효 관측 30초를 채우지 못해 평가 자료를 내보낼 수 없습니다.' : '유효 관측 30초를 채우지 못해 적용·내보내기를 할 수 없습니다.'}</strong>}</div>}
      <div className="dn-actions">{active ? <button className="dn-secondary" onClick={() => collection.interrupt('직접 수집을 중단했습니다.')}><Stop size={16} />수집 중단</button> : s.phase === 'review' && s.canConfirm ? <button className="dn-primary" disabled={!reviewed || disabled} onClick={collection.confirmAndApply}><Check size={17} />{evaluation ? '확인하고 평가 자료 준비' : currentPurpose === 'personal_calibration' ? '확인하고 개인 범위 적용' : '확인하고 학습 자료 준비'}</button> : <button className="dn-primary" disabled={disabled || (!s.metadata && (!participantCode.trim() || !sessionCode.trim()))} onClick={start}><Play size={16} weight="fill" />{s.phase === 'idle' ? '30초 측정하기' : '30초 다시 측정하기'}</button>}
        {s.phase === 'confirmed' && <button className="dn-secondary" onClick={collection.downloadDataset}><DownloadSimple size={17} />{evaluation ? '평가 좌표 데이터 내보내기' : '좌표 데이터 내보내기'}</button>}
        {!active && s.phase !== 'idle' && <button className="dn-text-button" onClick={() => { collection.discard(); setReviewed(false) }}><Trash size={16} />수집 자료 비우기</button>}
      </div>
      {disabled && <p className="dn-notice">{evaluation ? '진행 중인 자세 측정을 종료하면 평가 구간을 수집할 수 있습니다.' : '진행 중인 자세 측정을 종료하면 정상 구간을 수집할 수 있습니다.'}</p>}
      {collection.error && <p className="dn-error" role="alert">{collection.error}</p>}
      <p className="dn-privacy">영상·음성은 저장하지 않습니다. 시작 후 얼굴·어깨의 원본 좌표와 시각을 모으며, 내보내기를 누른 경우에만 JSON 파일로 내려받습니다. 새로고침하면 자료가 사라집니다.</p>
    </div>{evaluation ? <aside className="dn-profile">
      <span className="dn-eyebrow">평가 파일의 용도</span><h3>고정된 예측 모델 비교</h3><p>독립적으로 촬영한 좌표 시계열로 현재 모델의 예측을 비교할 자료를 준비합니다.</p>
      <ol><li><span>1</span><div><strong>평가 구간을 별도로 촬영</strong><p>얼굴·어깨 좌표와 시각, 관측 끊김을 담습니다. 정상 자세라는 가정을 붙이지 않습니다.</p></div></li><li><span>2</span><div><strong>학습과 개인 보정에서 제외</strong><p>이 구간으로 모델을 학습하거나 개인 정상 범위를 계산하지 않습니다.</p></div></li><li><span>3</span><div><strong>고정된 모델로 예측 비교</strong><p>모델과 설정을 고정한 뒤 같은 평가 구간에서 예측을 비교합니다. 모델 선택이나 임계값 조정에는 사용하지 않습니다.</p></div></li></ol>
      <p className="dn-model-note">평가 전용 JSON · 사용자 용도 확인 후 내보내기<br />이 화면은 비교할 자료를 준비하며 모델 성능이나 자세 정답을 판정하지 않습니다.</p>
    </aside> : <aside className="dn-profile">
      <span className="dn-eyebrow">적용할 모델</span><h3>{collection.profile ? '내 정상 범위 준비됨' : '아직 개인 정상 범위가 없어요'}</h3><p>{collection.profile ? `${collection.profile.provenance.participantCode} · 확인한 정상 구간 ${Math.round(collection.profile.provenance.validMs / 1000)}초, ${collection.profile.provenance.frames}개 표본` : '확인한 구간에서 실제 변동 폭을 학습합니다. 별도 정상 모델이 없을 때는 기존 거리·시간 규칙을 사용합니다.'}</p>
      <ol><li><span>1</span><div><strong>30초 정상 범위 학습</strong><p>얼굴·귀·어깨의 중앙값과 자연스러운 변동 폭을 계산합니다.</p></div></li><li><span>2</span><div><strong>측정할 때 기준 다시 등록</strong><p>새 등록 자세를 수집한 정상 중심·허용 폭과 비교합니다. 범위를 벗어나면 등록하지 않습니다.</p></div></li><li><span>3</span><div><strong>범위 이탈과 지속시간 확인</strong><p>1배가 허용 범위 경계입니다. 건강 점수나 정확도가 아닙니다.</p></div></li></ol>
      <p className="dn-model-note">통계적 개인 범위 모델 · 실제 성능 검증 전<br />정상 범위와 지속시간이 알림 기준이며, LSTM 예측은 보조 비교입니다.</p>
      <div className="dn-model-actions"><input ref={file} type="file" accept="application/json,.json" aria-label="개인 정상 범위 JSON 선택" hidden onChange={e => { const selected = e.target.files?.[0]; if (selected) void collection.importProfile(selected); e.target.value = '' }} /><button className="dn-secondary" disabled={locked} onClick={() => file.current?.click()}><UploadSimple size={16} />개인 범위 불러오기</button>{collection.profile && <><button className="dn-secondary" disabled={locked} onClick={collection.downloadProfile}><DownloadSimple size={16} />개인 범위 저장</button><button className="dn-text-button" disabled={locked} onClick={collection.clearProfile}>개인 범위 적용 해제</button></>}</div><p className="dn-import-note">불러온 파일은 같은 참여자에게만 적용해 주세요. 측정 전 기준 등록은 다시 진행합니다.</p>
    </aside>}</div>
  </section>
}
