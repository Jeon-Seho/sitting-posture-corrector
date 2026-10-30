import { useId, useState } from 'react'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { DEFAULT_GUIDE_PLAN, type GuideMode, type GuidePlan } from './observationProtocol'
import { ObservationScrollPanel } from './ObservationScrollPanel'
import { boldNumbers } from './observationTypography'

export function ObservationModeDialog({ onCancel, onStart }: { onCancel: () => void; onStart: (mode: GuideMode, plan: GuidePlan) => void }) {
  const id = useId()
  const [selected, setSelected] = useState<GuideMode | null>('manual')
  const [plan, setPlan] = useState<GuidePlan>(DEFAULT_GUIDE_PLAN)
  const [count, setCount] = useState('1')
  const countValid = /^[1-5]$/.test(count)
  return <div className="oc-mode-dialog">
    <ConfirmDialog title="측정 방식 선택" confirmLabel="카메라 켜고 시작" disabled={selected === null || !countValid} contentWrapper={children => <ObservationScrollPanel role="region" label="측정 방식 선택 내용" className="oc-scroll-panel oc-mode-scroll">{children}</ObservationScrollPanel>} onCancel={onCancel} onConfirm={() => { if (selected) onStart(selected, plan) }}>
      <p>{boldNumbers('카메라 연결 후 준비를 확인하면 기준 자세를 8초 등록합니다. 각 동작 뒤 편안한 기준 자세로 돌아갑니다.')}</p>
      <fieldset className="oc-mode-options"><legend>측정 사이클</legend>
        <label><input type="radio" name={`${id}-cycle`} value="repeat" checked={plan.cycle === 'repeat'} onChange={() => setPlan(old => ({ ...old, cycle: 'repeat', stretchNote: '' }))} /><span><strong>기준·이탈 비교 · 기본</strong><small>기준 → 이탈 → 기준 → 이탈 → 기준 복귀</small></span></label>
        <label><input type="radio" name={`${id}-cycle`} value="stretch" checked={plan.cycle === 'stretch'} onChange={() => setPlan(old => ({ ...old, cycle: 'stretch' }))} /><span><strong>스트레칭 포함</strong><small>기준 → 이탈 → 기준 → 앉은 채 스트레칭 → 기준 복귀</small></span></label>

      </fieldset>
      <fieldset className="oc-mode-options"><legend>진행 모드</legend>
        <label><input type="radio" name={`${id}-mode`} value="manual" checked={selected === 'manual'} onChange={() => setSelected('manual')} /><span><strong>수동 측정 · 권장</strong><small>동작을 준비한 뒤 직접 시작하고, 각 측정과 복귀가 끝나면 버튼으로 이어갑니다.</small></span></label>
        <label><input type="radio" name={`${id}-mode`} value="auto" checked={selected === 'auto'} onChange={() => setSelected('auto')} /><span><strong>자동 측정</strong><small>{boldNumbers('준비 2초 → 측정(이탈 5초·스트레칭 8초) → 복귀 준비 5초를 자동으로 이어갑니다.')}</small></span></label>
      </fieldset>
      <div className="oc-cycle-count"><label htmlFor={`${id}-count`}>사이클 수</label><p id={`${id}-count-help`}>한 번에 진행할 사이클 수를 정해주세요. (1~5회)</p><div className="oc-count-input"><input className="oc-field-input" aria-describedby={`${id}-count-help${countValid ? '' : ` ${id}-count-error`}`} id={`${id}-count`} type="number" inputMode="numeric" min={1} max={5} step={1} value={count} aria-invalid={!countValid} onChange={event => { const value = event.target.value; setCount(value); if (/^[1-5]$/.test(value)) setPlan(old => ({ ...old, rounds: Number(value) as GuidePlan['rounds'] })) }} /><span aria-hidden="true">회</span></div>{!countValid && <span id={`${id}-count-error`} role="alert">1부터 5까지 입력해 주세요.</span>}</div>

    </ConfirmDialog>
  </div>
}
