import { useId, useState } from 'react'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { DEFAULT_GUIDE_PLAN, type GuideMode, type GuidePlan } from './observationProtocol'
import { PARTICIPANT_MAX_LENGTH } from './observationReplay'
import { ObservationScrollPanel } from './ObservationScrollPanel'
import { boldNumbers } from './observationTypography'

const PARTICIPANT_KEY = 'posture-lab-observation-participant-v1'
function savedParticipant() {
  try { return localStorage.getItem(PARTICIPANT_KEY)?.slice(0, PARTICIPANT_MAX_LENGTH) ?? '' }
  catch { return '' }
}

export function ObservationModeDialog({ onCancel, onStart }: { onCancel: () => void; onStart: (mode: GuideMode, plan: GuidePlan, participant: string) => void }) {
  const id = useId()
  const [selected, setSelected] = useState<GuideMode | null>('manual')
  const [plan, setPlan] = useState<GuidePlan>(DEFAULT_GUIDE_PLAN)
  const [count, setCount] = useState('1')
  const [participant, setParticipant] = useState(savedParticipant)
  const countValid = /^[1-5]$/.test(count)
  const name = participant.trim(), nameValid = name.length > 0
  function start() {
    if (!selected || !nameValid) return
    // Remembered on this computer only, so the next measurement starts with the same name.
    try { localStorage.setItem(PARTICIPANT_KEY, name) } catch { /* The measurement still carries the name. */ }
    onStart(selected, plan, name)
  }
  return <div className="oc-mode-dialog">
    <ConfirmDialog title="측정 방식 선택" confirmLabel="카메라 켜고 시작" disabled={selected === null || !countValid || !nameValid} contentWrapper={children => <ObservationScrollPanel role="region" label="측정 방식 선택 내용" className="oc-scroll-panel oc-mode-scroll">{children}</ObservationScrollPanel>} onCancel={onCancel} onConfirm={start}>
      <p>{boldNumbers('카메라 연결 후 준비를 확인하면 기준 자세를 8초 등록합니다. 한 사이클은 이탈 → 기준 → 이탈 → 기준이며, 각 이탈 뒤 편안한 기준 자세로 돌아와 기준 자세도 측정합니다. 측정은 매번 8~15초 중 1초 단위로 정해집니다.')}</p>
      <div className="oc-cycle-count oc-participant"><label htmlFor={`${id}-participant`}>측정자 이름</label><p id={`${id}-participant-help`}>전체 데이터 JSON과 파일 이름에 들어갑니다. 서버로 보내지 않습니다.</p><input className="oc-field-input" id={`${id}-participant`} aria-describedby={`${id}-participant-help`} type="text" autoComplete="off" maxLength={PARTICIPANT_MAX_LENGTH} value={participant} aria-invalid={!nameValid} onChange={event => setParticipant(event.target.value)} />{!nameValid && <span role="alert">측정자 이름을 입력해 주세요.</span>}</div>
      <fieldset className="oc-mode-options"><legend>진행 모드</legend>
        <label><input type="radio" name={`${id}-mode`} value="manual" checked={selected === 'manual'} onChange={() => setSelected('manual')} /><span><strong>수동 측정 · 권장</strong><small>동작을 준비한 뒤 직접 시작하고, 각 측정과 복귀가 끝나면 버튼으로 이어갑니다.</small></span></label>
        <label><input type="radio" name={`${id}-mode`} value="auto" checked={selected === 'auto'} onChange={() => setSelected('auto')} /><span><strong>자동 측정</strong><small>{boldNumbers('준비 2초 → 동작 측정 → 복귀 준비 3초 → 기준 측정을 자동으로 이어갑니다.')}</small></span></label>
      </fieldset>
      <div className="oc-cycle-count"><label htmlFor={`${id}-count`}>사이클 수</label><p id={`${id}-count-help`}>한 번에 진행할 사이클 수를 정해주세요. (1~5회)</p><div className="oc-count-input"><input className="oc-field-input" aria-describedby={`${id}-count-help${countValid ? '' : ` ${id}-count-error`}`} id={`${id}-count`} type="number" inputMode="numeric" min={1} max={5} step={1} value={count} aria-invalid={!countValid} onChange={event => { const value = event.target.value; setCount(value); if (/^[1-5]$/.test(value)) setPlan(old => ({ ...old, rounds: Number(value) as GuidePlan['rounds'] })) }} /><span aria-hidden="true">회</span></div>{!countValid && <span id={`${id}-count-error`} role="alert">1부터 5까지 입력해 주세요.</span>}</div>

    </ConfirmDialog>
  </div>
}
