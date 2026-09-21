import { useState } from 'react'
import { POSTURES, PRESENCE, VIEWS, LAYOUTS, TASKS, taskFor, type Label, type Presence, type CaptureOptions } from '../lib/collectionProtocol'
import type { CollectionController } from '../hooks/useCollection'
import { Card } from './ui'

export function CollectionPanel({ collection: c }: { collection: CollectionController }) {
  const [confirmClear, setConfirmClear] = useState(false)
  const task = taskFor(c.options.taskId)!
  const reviewLocked = c.review !== 'pending'
  return <Card title="안내형 라벨 수집" note="좌표와 라벨만 기기에 저장합니다. 영상·음성은 저장하거나 서버로 보내지 않습니다.">
    <div className="collection-steps" aria-label="수집 순서">
      {['과제 선택', '5초 준비', '촬영', '확인 · 다운로드'].map((title, i) => <span key={title}
        className={i === (c.stage === 'idle' ? 0 : c.stage === 'countdown' ? 1 : c.stage === 'recording' ? 2 : 3) ? 'current' : ''}>{i + 1}. {title}</span>)}
    </div>
    <div className="collection-fields">
      <div className="field"><label htmlFor="participant-code">참여자 코드</label><input id="participant-code" className="input"
        value={c.participant} maxLength={5} disabled={c.hasCapture} onChange={e => c.setParticipant(e.target.value)} placeholder="P01" />
        <span className="fine">같은 사람은 항상 같은 코드로 입력하세요.</span></div>
      <div className="field"><label htmlFor="capture-task">촬영 과제</label><select id="capture-task" className="input"
        value={c.options.taskId} disabled={c.hasCapture} onChange={e => c.setOptions({ taskId: e.target.value, repetition: 1 })}>
        {TASKS.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select></div>
    </div>
    <div className="collection-fields collection-metadata">
      <div className="field"><label htmlFor="capture-duration">촬영 길이</label><select id="capture-duration" className="input" disabled={c.hasCapture}
        value={c.options.durationSeconds} onChange={e => c.setOptions({ durationSeconds: Number(e.target.value) })}>
        {[10, 20, 30, 60].map(n => <option key={n} value={n}>{n}초</option>)}</select></div>
      <div className="field"><label htmlFor="capture-repeat">반복 회차</label><input id="capture-repeat" className="input" type="number" min="1" max="999" disabled={c.hasCapture}
        value={c.options.repetition} onChange={e => c.setOptions({ repetition: Number(e.target.value) })} /></div>
      <div className="field"><label htmlFor="camera-view">촬영 방향</label><select id="camera-view" className="input" disabled={c.hasCapture}
        value={c.options.cameraView} onChange={e => c.setOptions({ cameraView: e.target.value as CaptureOptions['cameraView'] })}>
        {Object.entries(VIEWS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
      <div className="field"><label htmlFor="camera-distance">카메라 거리 · cm</label><input id="camera-distance" className="input" type="number" min="20" max="300" disabled={c.hasCapture}
        value={c.options.distanceCm} onChange={e => c.setOptions({ distanceCm: Number(e.target.value) })} /></div>
      <div className="field"><label htmlFor="camera-height">카메라 높이</label><select id="camera-height" className="input" disabled={c.hasCapture}
        value={c.options.cameraHeight} onChange={e => c.setOptions({ cameraHeight: e.target.value as CaptureOptions['cameraHeight'] })}>
        <option value="eye">눈높이</option><option value="above">눈높이보다 위</option><option value="below">눈높이보다 아래</option></select></div>
      <div className="field"><label htmlFor="desk-layout">작업 환경</label><select id="desk-layout" className="input" disabled={c.hasCapture}
        value={c.options.layout} onChange={e => c.setOptions({ layout: e.target.value as CaptureOptions['layout'] })}>
        {Object.entries(LAYOUTS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
    </div>
    <p className="fine">거리·높이·작업 환경은 실제 배치에 맞게 수정하세요. 카메라를 옮기면 기준을 다시 등록하고 새 촬영을 시작하세요.</p>
    <div className={`collection-cue ${c.active ? 'is-active' : ''}`}>
      <div><span className="stat-label">{c.stage === 'countdown' ? '자세를 준비하세요 · 아직 저장하지 않음' : c.stage === 'recording' ? '좌표 수집 중' : c.stage === 'review' ? '촬영 검토' : '이번 촬영 안내'}</span>
        <h3>{task.title}</h3><p>{task.instruction}</p></div>
      {c.active && <strong className="collection-countdown" role="timer" aria-label="남은 시간">{c.secondsLeft}<small>초</small></strong>}
    </div>
    <div className="controls">
      <span role="status">{c.count.toLocaleString()}행 · 특징 측정 가능 {c.goodCount.toLocaleString()}행</span>
      {!c.hasCapture && <button className="btn btn-primary" disabled={!c.canStart} onClick={c.start}>준비 완료 · 5초 후 촬영</button>}
      {c.active && <button className="btn btn-danger" onClick={c.stop}>촬영 중단</button>}
    </div>
    {!c.canStart && !c.hasCapture && <p className="capture-note">측정 준비에서 카메라를 켜고 기준을 등록한 뒤 라벨 수집 화면으로 오세요.</p>}
    {c.stage === 'review' && <div className="collection-review">
      <h3>{c.review === 'accepted' ? '수행 내용 확인 완료' : c.review === 'excluded' ? '학습에서 제외한 촬영' : '실제로 수행한 내용을 확인하세요'}</h3>
      <p className="fine">아래 라벨은 촬영 구간 전체에 적용됩니다. 여러 자세가 섞였거나 확신이 없으면 ‘확인 불가’를 선택하세요.
        과제 지시와 실제 자세는 다를 수 있습니다. 규칙 점수로 정답을 채우지 않습니다.</p>
      <div className="collection-fields">
        <div className="field"><label htmlFor="presence-label">실제 재석 상태</label><select id="presence-label" className="input" disabled={reviewLocked}
          value={c.presence} onChange={e => { c.setPresence(e.target.value as Presence); if (e.target.value !== 'seated') c.setLabel('unlabeled') }}>
          {Object.entries(PRESENCE).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
        <div className="field"><label htmlFor="manual-label">실제 자세 · 구간 전체에 동일할 때만 지정</label><select id="manual-label" className="input" disabled={reviewLocked}
          value={c.label} onChange={e => c.setLabel(e.target.value as Label)}>
          {Object.entries(POSTURES).filter(([key]) => c.presence === 'seated' || key === 'unlabeled' || key === 'transition')
            .map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
      </div>
      {c.stopReason !== 'completed' && <p className="capture-note">중단된 촬영입니다. 제외 후 다시 촬영하세요.</p>}
      <div className="row collection-actions">
        {!reviewLocked && <><button className="btn btn-primary" disabled={c.stopReason !== 'completed' || !c.count} onClick={() => c.confirm(true)}>과제를 수행했음 · 라벨 확인</button>
          <button className="btn" onClick={() => c.confirm(false)}>잘못 촬영함 · 제외</button></>}
        <button className="btn" disabled={!c.count || !reviewLocked} onClick={c.download}>CSV 다운로드</button>
        <button className="btn" onClick={() => setConfirmClear(true)}>다음 촬영 / 다시 찍기</button>
      </div>
    </div>}
    {confirmClear && <div className="controls"><span>현재 메모리 기록을 비우고 다음 촬영을 준비할까요? 필요한 CSV를 먼저 내려받으세요.</span>
      <button className="btn btn-danger" onClick={() => { c.clear(); setConfirmClear(false) }}>비우고 다음 촬영</button>
      <button className="btn" onClick={() => setConfirmClear(false)}>취소</button></div>}
    <p className="fine">33개 관절의 원본 추정 좌표·가시성과 개인 기준을 최대 초당 10행으로 저장합니다. 실제 저장 속도는 추론 속도에 따라 달라집니다.
      얼굴이 가려져도 과제 시간은 계속 흐릅니다. 화면 이동·탭 숨김·카메라 연결 해제 시 촬영을 중단합니다.
      다운로드 전 기록은 메모리에만 있으며 새로고침하면 사라집니다.</p>
    {c.message && <p role="status" className="capture-note">{c.message}</p>}
  </Card>
}
