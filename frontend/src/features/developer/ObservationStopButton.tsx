import { useState } from 'react'
import { Stop } from '@phosphor-icons/react'
import { ConfirmDialog } from '../dialog/ConfirmDialog'

export function ObservationStopButton({ onStop, className = 'oc-stop-guide' }: { onStop: () => void; className?: string }) {
  const [confirming, setConfirming] = useState(false)
  return <>
    <button className={className} onClick={() => setConfirming(true)}><Stop size={18} weight="fill" aria-hidden="true" />측정 종료</button>
    {confirming && <div className="oc-stop-dialog"><ConfirmDialog title="측정을 종료할까요?" confirmLabel="측정 종료" onCancel={() => setConfirming(false)} onConfirm={() => { onStop(); setConfirming(false) }}><p>카메라를 끄고 지금까지의 측정 자료를 보존합니다. CSV와 리플레이 JSON은 종료 후에도 내려받을 수 있어요.</p><p>확인 전까지 측정은 계속됩니다.</p></ConfirmDialog></div>}
  </>
}
