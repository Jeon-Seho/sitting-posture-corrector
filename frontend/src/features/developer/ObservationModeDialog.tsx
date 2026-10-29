import { useId, useState } from 'react'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { DEFAULT_GUIDE_PLAN, OBSERVATION_PROTOCOL, type GuideMode, type GuidePlan } from './observationProtocol'
import { boldNumbers } from './observationTypography'

export function ObservationModeDialog({ onCancel, onStart }: { onCancel: () => void; onStart: (mode: GuideMode, plan: GuidePlan) => void }) {
  const id = useId()
  const [selected, setSelected] = useState<GuideMode | null>('manual')
  const [plan, setPlan] = useState<GuidePlan>(DEFAULT_GUIDE_PLAN)
  return <div className="oc-mode-dialog">
    <ConfirmDialog title="측정 방식 선택" confirmLabel="카메라 켜고 시작" disabled={selected === null} onCancel={onCancel} onConfirm={() => { if (selected) onStart(selected, plan) }}>
      <p>{boldNumbers('카메라 연결 후 준비를 확인하면 기준 자세를 8초 등록합니다. 한 바퀴는 기준 → 이탈 자세 → 기준 → 앉은 채 스트레칭입니다.')}</p>
      <fieldset className="oc-mode-options"><legend>진행 모드</legend>
        <label><input type="radio" name={`${id}-mode`} value="auto" checked={selected === 'auto'} onChange={() => setSelected('auto')} /><span><strong>자동 측정</strong><small>{boldNumbers('준비 2초 → 측정(이탈 5초·스트레칭 8초) → 복귀 준비 5초를 자동으로 이어갑니다.')}</small></span></label>
        <label><input type="radio" name={`${id}-mode`} value="manual" checked={selected === 'manual'} onChange={() => setSelected('manual')} /><span><strong>수동 측정 · 권장</strong><small>동작을 준비한 뒤 직접 시작하고, 각 측정과 복귀가 끝나면 버튼으로 이어갑니다.</small></span></label>
      </fieldset>
      <fieldset className="oc-mode-options"><legend>바퀴 수</legend>
        {OBSERVATION_PROTOCOL.roundOptions.map(rounds => <label key={rounds}><input type="radio" name={`${id}-rounds`} value={rounds} checked={plan.rounds === rounds} onChange={() => setPlan(old => ({ ...old, rounds }))} /><span><strong>{boldNumbers(`${rounds}바퀴`)}</strong><small>{rounds === 1 ? '짧게 여러 번 측정할 때 · 권장. 실행마다 기준을 새로 등록합니다.' : '한 번에 길게 측정합니다.'}</small></span></label>)}
      </fieldset>
      <fieldset className="oc-mode-options"><legend>순서</legend>
        <label><input type="checkbox" name={`${id}-shuffle`} checked={plan.shuffle} onChange={event => setPlan(old => ({ ...old, shuffle: event.target.checked }))} /><span><strong>바퀴마다 이탈·스트레칭 순서 섞기</strong><small>같은 순서 반복으로 생기는 영향을 줄입니다.</small></span></label>
      </fieldset>
    </ConfirmDialog>
  </div>
}
