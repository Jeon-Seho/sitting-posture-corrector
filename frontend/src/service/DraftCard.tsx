import { Card } from '../components/ui'

export function DraftCard({ onRestore, onSave }: { onRestore: () => void; onSave: () => void }) {
  return (
    <Card title="중단된 측정이 있습니다" className="service-draft">
      <p>마지막 저장 지점까지 복구합니다. 복구 후 직접 측정 재개를 눌러 주세요.</p>
      <div className="row">
        <button className="btn btn-primary" onClick={onRestore}>이어하기</button>
        <button className="btn" onClick={onSave}>여기까지 종료·저장</button>
      </div>
    </Card>
  )
}
