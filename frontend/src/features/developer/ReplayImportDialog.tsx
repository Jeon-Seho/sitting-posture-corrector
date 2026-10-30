import { useEffect, useRef, useState, type DragEvent } from 'react'
import { UploadSimple } from '@phosphor-icons/react'
import { ConfirmDialog } from '../dialog/ConfirmDialog'
import { parseObservationReplay, REPLAY_FILE_LIMIT, type ObservationReplayData } from './observationReplay'
import { boldNumbers } from './observationTypography'

type Props = { onCancel: () => void; onLoad: (data: ObservationReplayData) => void }
export function ReplayImportDialog({ onCancel, onLoad }: Props) {
  const input = useRef<HTMLInputElement>(null), mounted = useRef(false)
  const [file, setFile] = useState<File | null>(null), [error, setError] = useState('')
  const [dragging, setDragging] = useState(false), [reading, setReading] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function select(files: FileList | File[] | null) {
    if (reading || !files?.length) return
    setError(''); setFile(null)
    if (files.length !== 1) { setError('JSON 파일 한 개를 선택해 주세요.'); return }
    const next = files[0]
    if (!next.name.toLowerCase().endsWith('.json')) { setError('JSON 파일을 선택해 주세요.'); return }
    if (next.size > REPLAY_FILE_LIMIT) { setError('파일은 64MB 이하만 불러올 수 있어요.'); return }
    setFile(next)
  }
  function drop(event: DragEvent) { event.preventDefault(); setDragging(false); select(event.dataTransfer.files) }
  async function load() {
    if (!file || reading) return
    setReading(true)
    try {
      const data = parseObservationReplay(await file.text())
      if (mounted.current) onLoad(data)
    } finally { if (mounted.current) setReading(false) }
  }
  return <div className="oc-replay-import-dialog"><ConfirmDialog title="리플레이 파일 불러오기" confirmLabel="불러오기" disabled={!file || reading} onCancel={onCancel} onConfirm={load} formatError={failure => failure instanceof Error ? failure.message : '파일을 읽지 못했어요.'}>
    <input ref={input} className="oc-sr-only" type="file" accept=".json,application/json" aria-label="리플레이 JSON 파일" tabIndex={-1} disabled={reading} onChange={event => { select(event.currentTarget.files); event.currentTarget.value = '' }} />
    <button type="button" className="oc-replay-dropzone" data-dragging={dragging} aria-label="리플레이 JSON 파일 선택" disabled={reading} onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); if (!reading) { event.dataTransfer.dropEffect = 'copy'; setDragging(true) } }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <UploadSimple size={34} weight="duotone" aria-hidden="true" /><span>JSON 파일을 여기에 놓으세요</span><span className="oc-replay-drop-pick">또는 파일 선택</span><small>{boldNumbers('파일 1개 · 최대 64MB')}</small>
    </button>
    {file && <p className="oc-replay-selected-file">{file.name}</p>}
    {error && <p role="alert">{error}</p>}
  </ConfirmDialog></div>
}
