import { useState } from 'react'
import { POSTURES, PRESENCE, VIEWS, LAYOUTS, TASKS, taskFor, type Label, type Presence, type CaptureOptions } from '../lib/collectionProtocol'
import type { CollectionController } from '../hooks/useCollection'
import { Card } from './ui'

export function CollectionPanel({ collection: c }: { collection: CollectionController }) {
  const [confirmClear, setConfirmClear] = useState(false)
  const task = taskFor(c.options.taskId)!
  const reviewLocked = c.review !== 'pending'
  return <Card title="자세 촬영하기" note="영상과 소리는 저장하지 않아요. 몸의 관절 위치만 이 기기에 기록합니다.">
    <div className="collection-steps" aria-label="촬영 순서">
      {['자세 고르기', '5초 준비', '촬영', '확인 · 저장'].map((title, i) => <span key={title}
        className={i === (c.stage === 'idle' ? 0 : c.stage === 'countdown' ? 1 : c.stage === 'recording' ? 2 : 3) ? 'current' : ''}>{i + 1}. {title}</span>)}
    </div>
    <div className="collection-fields">
      <div className="field"><label htmlFor="participant-code">내 코드</label><input id="participant-code" className="input"
        value={c.participant} maxLength={5} disabled={c.hasCapture} onChange={e => c.setParticipant(e.target.value)} placeholder="P01" />
        <span className="fine">이름 대신 쓰는 번호예요. 매번 같은 코드를 입력해 주세요.</span></div>
      <div className="field"><label htmlFor="capture-task">찍을 자세</label><select id="capture-task" className="input"
        value={c.options.taskId} disabled={c.hasCapture} onChange={e => c.setOptions({ taskId: e.target.value, repetition: 1 })}>
        {TASKS.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select></div>
    </div>
    <details className="collection-env">
      <summary>카메라·책상 환경 <span className="fine">처음 한 번만 확인하면 돼요</span></summary>
      <div className="collection-fields collection-metadata">
        <div className="field"><label htmlFor="capture-duration">촬영 길이</label><select id="capture-duration" className="input" disabled={c.hasCapture}
          value={c.options.durationSeconds} onChange={e => c.setOptions({ durationSeconds: Number(e.target.value) })}>
          {[10, 20, 30, 60].map(n => <option key={n} value={n}>{n}초</option>)}</select></div>
        <div className="field"><label htmlFor="capture-repeat">몇 번째 촬영</label><input id="capture-repeat" className="input" type="number" min="1" max="999" disabled={c.hasCapture}
          value={c.options.repetition} onChange={e => c.setOptions({ repetition: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="camera-view">카메라 방향</label><select id="camera-view" className="input" disabled={c.hasCapture}
          value={c.options.cameraView} onChange={e => c.setOptions({ cameraView: e.target.value as CaptureOptions['cameraView'] })}>
          {Object.entries(VIEWS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
        <div className="field"><label htmlFor="camera-distance">카메라 거리 · cm</label><input id="camera-distance" className="input" type="number" min="20" max="300" disabled={c.hasCapture}
          value={c.options.distanceCm} onChange={e => c.setOptions({ distanceCm: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="camera-height">카메라 높이</label><select id="camera-height" className="input" disabled={c.hasCapture}
          value={c.options.cameraHeight} onChange={e => c.setOptions({ cameraHeight: e.target.value as CaptureOptions['cameraHeight'] })}>
          <option value="eye">눈높이</option><option value="above">눈높이보다 위</option><option value="below">눈높이보다 아래</option></select></div>
        <div className="field"><label htmlFor="desk-layout">책상 배치</label><select id="desk-layout" className="input" disabled={c.hasCapture}
          value={c.options.layout} onChange={e => c.setOptions({ layout: e.target.value as CaptureOptions['layout'] })}>
          {Object.entries(LAYOUTS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
      </div>
      <p className="fine">지금 앉은 자리에 맞게 골라 주세요. 카메라를 옮겼다면 측정 준비에서 기준 자세를 다시 등록한 뒤 촬영하세요.</p>
    </details>
    <div className={`collection-cue ${c.active ? 'is-active' : ''}`}>
      <div><span className="stat-label">{c.stage === 'countdown' ? '자세를 잡아 주세요 · 아직 기록 전' : c.stage === 'recording' ? '촬영 중 · 자세를 유지해 주세요' : c.stage === 'review' ? '촬영 끝' : '이렇게 해 주세요'}</span>
        <h3>{task.title}</h3><p>{task.instruction}</p></div>
      {c.active && <strong className="collection-countdown" role="timer" aria-label="남은 시간">{c.secondsLeft}<small>초</small></strong>}
    </div>
    <div className="controls">
      <span role="status">기록 {c.count.toLocaleString()}장 · 몸이 잘 보인 기록 {c.goodCount.toLocaleString()}장</span>
      {!c.hasCapture && <button className="btn btn-primary" disabled={!c.canStart} onClick={c.start}>준비됐어요 · 5초 뒤 촬영 시작</button>}
      {c.active && <button className="btn btn-danger" onClick={c.stop}>촬영 멈추기</button>}
    </div>
    {!c.canStart && !c.hasCapture && <p className="capture-note">먼저 ‘측정 준비’에서 카메라를 켜고 기준 자세를 등록해 주세요. 그다음 이 화면에서 촬영할 수 있어요.</p>}
    {c.stage === 'review' && <div className="collection-review">
      <h3>{c.review === 'accepted' ? '확인 완료! 파일로 내려받을 수 있어요' : c.review === 'excluded' ? '이번 촬영은 제외했어요' : '방금 어떤 자세였는지 알려주세요'}</h3>
      <p className="fine">촬영하는 동안 실제로 취한 자세를 골라 주세요. 중간에 자세가 바뀌었거나 잘 모르겠다면 ‘확인 불가’를 고르면 됩니다.
        안내한 자세와 실제 자세가 달라도 괜찮아요. 실제로 한 자세를 기준으로 골라 주세요.</p>
      <div className="collection-fields">
        <div className="field"><label htmlFor="presence-label">자리에 있었나요?</label><select id="presence-label" className="input" disabled={reviewLocked}
          value={c.presence} onChange={e => { c.setPresence(e.target.value as Presence); if (e.target.value !== 'seated') c.setLabel('unlabeled') }}>
          {Object.entries(PRESENCE).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
        <div className="field"><label htmlFor="manual-label">어떤 자세였나요?</label><select id="manual-label" className="input" disabled={reviewLocked}
          value={c.label} onChange={e => c.setLabel(e.target.value as Label)}>
          {Object.entries(POSTURES).filter(([key]) => c.presence === 'seated' || key === 'unlabeled' || key === 'transition')
            .map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
      </div>
      {c.stopReason !== 'completed' && <p className="capture-note">촬영이 중간에 멈췄어요. ‘잘못 찍었어요’를 누른 뒤 다시 찍어 주세요.</p>}
      <div className="row collection-actions">
        {!reviewLocked && <><button className="btn btn-primary" disabled={c.stopReason !== 'completed' || !c.count} onClick={() => c.confirm(true)}>맞아요 · 이대로 저장</button>
          <button className="btn" onClick={() => c.confirm(false)}>잘못 찍었어요 · 제외</button></>}
        <button className="btn" disabled={!c.count || !reviewLocked} onClick={c.download}>파일로 내려받기 (CSV)</button>
        <button className="btn" onClick={() => setConfirmClear(true)}>다음 자세 찍기</button>
      </div>
    </div>}
    {confirmClear && <div className="controls"><span>방금 찍은 기록을 지우고 다음 자세를 찍을까요? 필요하면 먼저 파일로 내려받아 주세요.</span>
      <button className="btn btn-danger" onClick={() => { c.clear(); setConfirmClear(false) }}>지우고 다음 자세 찍기</button>
      <button className="btn" onClick={() => setConfirmClear(false)}>취소</button></div>}
    <p className="fine">몸의 관절 위치(33개 점)를 1초에 최대 10번 기록합니다. 기기 성능에 따라 조금 적게 기록될 수 있어요.
      얼굴이 가려져도 촬영 시간은 계속 흘러요. 다른 화면·탭으로 이동하거나 카메라가 끊기면 촬영이 멈춥니다.
      내려받기 전에 새로고침하면 기록이 사라져요.</p>
    {c.message && <p role="status" className="capture-note">{c.message}</p>}
  </Card>
}
