import { useState } from 'react'
import type { HistoryMode } from '../../lib/history'
import type { RecordItem } from '../../lib/serviceStore'

/** 실제 웹캠 / 합성 시연 filter, shared by 기록 and 달력. Only shown when demo records exist. */
export function useRecordMode(all: RecordItem[]) {
  const [mode, setMode] = useState<HistoryMode>('all')
  const hasDemo = all.some((r) => r.mode === 'demo')
  const records = all.filter((r) => mode === 'all' || r.mode === mode)
  const label = !hasDemo
    ? ''
    : mode === 'all'
      ? '실제 웹캠·합성 시연 합산 · '
      : mode === 'camera'
        ? '실제 웹캠 기록 · '
        : '합성 시연 기록 · '
  return { mode, setMode, hasDemo, records, label }
}

export function RecordModeChips({ mode, onMode }: { mode: HistoryMode; onMode: (mode: HistoryMode) => void }) {
  return (
    <div className="row" role="group" aria-label="기록 종류" style={{ flexWrap: 'wrap' }}>
      {(
        [
          ['all', '모든 기록'],
          ['camera', '실제 웹캠 기록'],
          ['demo', '합성 시연 기록'],
        ] as const
      ).map(([id, label]) => (
        <button key={id} className="chip" aria-pressed={mode === id} onClick={() => onMode(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}
