import type { CollectionController } from '../hooks/useCollection'
import { TASKS } from '../lib/collectionProtocol'

/** Keep the task and capture length visible before camera preparation, on every viewport. */
export function CollectionTaskPicker({ collection: c }: { collection: CollectionController }) {
  return (
    <section className="collection-picker" aria-labelledby="collection-picker-title">
      <h2 id="collection-picker-title">1. 찍을 자세 선택</h2>
      <div className="collection-fields">
        <div className="field">
          <label htmlFor="capture-task">찍을 자세</label>
          <select id="capture-task" className="input" value={c.options.taskId} disabled={c.hasCapture}
            onChange={(e) => c.setOptions({ taskId: e.target.value, repetition: 1 })}>
            {TASKS.map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="capture-duration">촬영 길이</label>
          <select id="capture-duration" className="input" disabled={c.hasCapture} value={c.options.durationSeconds}
            onChange={(e) => c.setOptions({ durationSeconds: Number(e.target.value) })}>
            {[10, 20, 30, 60].map((seconds) => (
              <option key={seconds} value={seconds}>{seconds}초</option>
            ))}
          </select>
        </div>
      </div>
      <p className="fine">자세를 고른 뒤 카메라를 켜고 기준 자세를 등록하세요. 촬영 후 실제 자세를 다시 확인합니다.</p>
    </section>
  )
}
