import type { CollectionController } from '../hooks/useCollection'
import { TASKS } from '../lib/collectionProtocol'
import { SelectMenu } from './SelectMenu'

/** Keep the task and capture length visible before camera preparation, on every viewport. */
export function CollectionTaskPicker({ collection: c }: { collection: CollectionController }) {
  return (
    <section className="collection-picker" aria-labelledby="collection-picker-title">
      <h2 id="collection-picker-title">1. 찍을 자세 선택</h2>
      <div className="collection-fields">
        <div className="field">
          <label htmlFor="capture-task">찍을 자세</label>
          <SelectMenu id="capture-task" label="찍을 자세" value={c.options.taskId} disabled={c.hasCapture}
            options={TASKS.map((task) => ({ value: task.id, label: task.title }))}
            onChange={(taskId) => c.setOptions({ taskId, repetition: 1 })} />
        </div>
        <div className="field">
          <label htmlFor="capture-duration">촬영 길이</label>
          <SelectMenu id="capture-duration" label="촬영 길이" disabled={c.hasCapture} value={String(c.options.durationSeconds)}
            options={[10, 20, 30, 60].map((seconds) => ({ value: String(seconds), label: `${seconds}초` }))}
            onChange={(seconds) => c.setOptions({ durationSeconds: Number(seconds) })} />
        </div>
      </div>
      <p className="fine">자세를 고른 뒤 카메라를 켜고 자세를 등록하세요. 촬영 후 실제로 한 자세를 다시 확인합니다.</p>
    </section>
  )
}
