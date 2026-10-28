import { useId, useState } from 'react'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import type { GuideMode } from './observationProtocol'
import { boldNumbers } from './observationTypography'

export function ObservationModeDialog({ onCancel, onStart }: { onCancel: () => void; onStart: (mode: GuideMode) => void }) {
  const id = useId()
  const [selected, setSelected] = useState<GuideMode | null>('manual')
  return <div className="oc-mode-dialog">
    <ConfirmDialog title="측정 방식 선택" confirmLabel="카메라 켜고 시작" disabled={selected === null} onCancel={onCancel} onConfirm={() => { if (selected) onStart(selected) }}>
      <p>{boldNumbers('측정 방식을 선택하세요. 카메라 연결 후 준비를 확인하면 기준 자세를 8초 등록합니다.')}</p>
      <fieldset className="oc-mode-options"><legend>진행 모드</legend>
        <label><input type="radio" name={`${id}-mode`} value="auto" checked={selected === 'auto'} onChange={() => setSelected('auto')} /><span><strong>자동 측정</strong><small>{boldNumbers('준비 2초 → 측정 5초 → 복귀 준비 5초를 자동으로 이어갑니다.')}</small></span></label>
        <label><input type="radio" name={`${id}-mode`} value="manual" checked={selected === 'manual'} onChange={() => setSelected('manual')} /><span><strong>수동 측정 · 권장</strong><small>동작을 준비한 뒤 직접 시작하고, 각 측정과 복귀가 끝나면 버튼으로 이어갑니다.</small></span></label>
      </fieldset>
    </ConfirmDialog>
  </div>
}
