import { useState } from 'react'
import { CameraFaultPreview, type FaultScenario, FAULT_SCENARIOS } from './CameraFaultPreview'

export function CameraFaultTests({ compact = false }: { compact?: boolean }) {
  const [selected, setSelected] = useState<FaultScenario>('fallback')
  const [scenario, setScenario] = useState<FaultScenario | null>(null)
  return <div>
    <p className="fine">카메라 준비부터 복구·오류 안내까지 사용자 화면으로 확인하세요. 실제 카메라와 측정 기록은 사용하지 않아요.</p>
    {compact ? <div className="dev-select-action">
      <label>복구 테스트 시나리오<select aria-label="복구 테스트 시나리오" value={selected} onChange={event => setSelected(event.target.value as FaultScenario)}>{Object.entries(FAULT_SCENARIOS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="btn btn-sm" onClick={() => setScenario(selected)}>선택한 흐름 재현</button>
    </div> : <div className="row" style={{ flexWrap: 'wrap' }}>{Object.entries(FAULT_SCENARIOS).map(([key, label]) =>
      <button className="chip" key={key} onClick={() => setScenario(key as FaultScenario)}>{label}</button>)}</div>}
    {scenario && <CameraFaultPreview scenario={scenario} onClose={() => setScenario(null)} />}
  </div>
}
