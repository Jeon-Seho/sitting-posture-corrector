import { useState, type ReactNode } from 'react'
import { ComboChart } from '../../components/ComboChart'
import { PreparationSteps } from '../../components/PreparationSteps'
import { tip } from '../../components/TipLayer'

export function DeveloperGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details className="dev-group"><summary>{title}</summary><div className="dev-group-body">{children}</div></details>
}

export function InteractionPreview() {
  const [step, setStep] = useState(0)
  return <div className="dev-interaction">
    <p className="fine">화면 확인용 예시예요. 카메라·측정 기록은 바뀌지 않아요.</p>
    <div className="row dev-actions">
      <button className="chip" {...tip('설명 표시 테스트', [['안내', 'Tab 선택은 즉시, 마우스는 0.5초 뒤 표시해요.']])}>설명 표시 확인</button>
      <button className="chip" onClick={() => setStep(value => (value + 1) % 3)}>준비 단계 넘기기</button>
    </div>
    <PreparationSteps step={step} labels={['카메라 연결', '얼굴·어깨 확인', '기준 자세 등록']} />
    <div className="records-stack dev-chart">
      <ComboChart bars={[{ label: '예시 1', value: .7 }, { label: '예시 2', value: .85 }, { label: '예시 3', value: .6 }]} barUnit="%" barMax={1} barName="바른 자세 유지율" />
    </div>
  </div>
}
