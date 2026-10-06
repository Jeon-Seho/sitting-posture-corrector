import { Card } from '../../components/ui'
import type { Draft } from '../storage/types'

type Props = {
  draft: Draft
  canWrite: boolean
  hasPendingResult: boolean
  saveMessage: string
  onRestore: () => void
  onFinish: () => void
  accountMode?: boolean
}

export function RecoveryNotice({
  draft,
  canWrite,
  hasPendingResult,
  saveMessage,
  onRestore: restore,
  onFinish,
  accountMode = false,
}: Props) {
  return (
    <Card title="중단된 측정이 있습니다">
      <p>
        {draft.server
          ? accountMode
            ? '내 계정의 서버 상태와 미확인 요청을 확인한 뒤 복구합니다. 확인하지 못한 시간은 측정 시간에 더하지 않습니다.'
            : '서버 상태와 미확인 요청을 확인한 뒤 복구합니다. 서버가 재시작되어 세션을 잃었다면 이어할 수 없습니다.'
          : `마지막 저장 지점${draft.savedAt ? ` (${new Date(draft.savedAt).toLocaleString()})` : ''}까지 복구합니다. 그 뒤 미저장 시간은 제외합니다.`}{' '}
        복구 후 직접 측정 재개를 눌러 주세요.
      </p>
      <button
        className="btn btn-primary"
        disabled={!canWrite || !!hasPendingResult}
        onClick={restore}
      >
        이어하기
      </button>
      <button className="btn" disabled={!canWrite} onClick={onFinish}>
        {draft.server ? '서버 종료 확인·저장' : '여기까지 종료·저장'}
      </button>
      {hasPendingResult && <p role="status">{saveMessage}</p>}
    </Card>
  )
}
