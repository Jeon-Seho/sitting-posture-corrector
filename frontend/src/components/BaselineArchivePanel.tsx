import { useEffect, useState } from 'react'
import { archiveError, listBaselines, subscribeArchive, type BaselineRecord } from '../features/camera/baselineArchive'

export function BaselineArchivePanel() {
  const [records, setRecords] = useState<BaselineRecord[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const next = await listBaselines()
      if (active) { setRecords(next); setError(archiveError()) }
    }
    void refresh()
    const unsubscribe = subscribeArchive(() => void refresh())
    return () => { active = false; unsubscribe() }
  }, [])
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'posture-baselines.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return <section className="collection-intro" aria-label="기준 자세 모음">
    <div><h2>기준 자세 모음 · {records.length}건</h2>
      <p>등록이 완료되면 얼굴·어깨 13개 점의 좌표를 이 기기에 따로 저장합니다. 영상은 저장하지 않습니다.
        ‘기준 자세’는 개발용 정상 가정이며 검증된 정답은 아닙니다. 참여자 번호는 내보낸 자료에 별도로 연결해 주세요.</p>
      {error && <p role="alert">{error}</p>}
      <button className="btn" disabled={!records.length} onClick={download}>기준 자료 내려받기 (JSON)</button>
    </div>
  </section>
}
